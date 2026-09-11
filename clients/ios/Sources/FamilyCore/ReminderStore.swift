import Foundation

// MARK: - Reminder Status & Alert

public enum ReminderStatus: String, Codable, Sendable {
    case open
    case completed
}

public enum ReminderAlertLeadTime: Int, Codable, CaseIterable, Sendable {
    case atDueTime = 0
    case fiveMinutes = 5
    case fifteenMinutes = 15
    case oneHour = 60
    case oneDay = 1_440
}

// MARK: - ReminderRecurrence

public struct ReminderRecurrence: Codable, Equatable, Sendable {
    public enum Frequency: String, Codable, CaseIterable, Sendable {
        case weekly
        case biweekly
     }

    public enum Weekday: Int, Codable, CaseIterable, Comparable, Sendable {
        case monday = 1
        case tuesday
        case wednesday
        case thursday
        case friday
        case saturday
        case sunday

        public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
     }

    public let frequency: Frequency
    public let interval: Int
    public let weekdays: [Weekday]
    public let endDate: Date

    public init(
        frequency: Frequency = .weekly,
        interval: Int = 1,
        weekdays: [Weekday],
        endDate: Date
     ) {
        self.frequency = frequency
        self.interval = max(1, frequency == .biweekly ? interval * 2 : interval)
        self.weekdays = Array(Set(weekdays)).sorted()
        self.endDate = endDate
     }

     /// Effective interval in weeks (biweekly stores 2 in `interval`).
    public var effectiveInterval: Int { interval }
}

// MARK: - FamilyReminder

public struct FamilyReminder: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public var title: String
    public var assigneeIDs: [KidID]
    public var dueAt: Date
    public var status: ReminderStatus
    public var completedAt: Date?
    public var completedByMemberID: KidID?
    public var alertLeadTime: ReminderAlertLeadTime?

     /// Recurrence fields. When `recurrenceFrequency` is non-nil and
     /// `recurrenceWeekdays` is non-empty, this reminder is a series template.
    public var recurrenceFrequency: ReminderRecurrence.Frequency?
    public var recurrenceInterval: Int?
    public var recurrenceWeekdays: [ReminderRecurrence.Weekday]
    public var recurrenceEndDate: Date?

     /// For series linkage; set to `id` for series templates.
    public var recurrenceSeriesID: UUID?

    private enum CodingKeys: String, CodingKey {
        case id, title, assigneeIDs, dueAt, status, completedAt, completedByMemberID
        case alertLeadTime = "alertLeadTimeMinutes"
        case recurrenceFrequency, recurrenceInterval, recurrenceWeekdays, recurrenceEndDate
        case recurrenceSeriesID
     }

    public init(
        id: UUID = UUID(),
        title: String,
        assigneeIDs: [KidID],
        dueAt: Date,
        status: ReminderStatus = .open,
        completedAt: Date? = nil,
        completedByMemberID: KidID? = nil,
        alertLeadTime: ReminderAlertLeadTime? = nil,
        recurrenceFrequency: ReminderRecurrence.Frequency? = nil,
        recurrenceInterval: Int? = 1,
        recurrenceWeekdays: [ReminderRecurrence.Weekday] = [],
        recurrenceEndDate: Date? = nil,
        recurrenceSeriesID: UUID? = nil
    ) {
        self.id = id
        self.title = title
        self.assigneeIDs = assigneeIDs
        self.dueAt = dueAt
        self.status = status
        self.completedAt = completedAt
        self.completedByMemberID = completedByMemberID
        self.alertLeadTime = alertLeadTime
        self.recurrenceFrequency = recurrenceFrequency
        self.recurrenceInterval = recurrenceInterval
        self.recurrenceWeekdays = recurrenceWeekdays
        self.recurrenceEndDate = recurrenceEndDate
        self.recurrenceSeriesID = recurrenceSeriesID ?? (recurrenceFrequency != nil ? id : nil)
    }

      /// Convenience: build a series template from a `ReminderRecurrence`.
    public static func series(
        id: UUID = UUID(),
        title: String,
        assigneeIDs: [KidID],
        dueAt: Date,
        recurrence: ReminderRecurrence,
        alertLeadTime: ReminderAlertLeadTime? = nil
    ) -> FamilyReminder {
        FamilyReminder(
            id: id,
            title: title,
            assigneeIDs: assigneeIDs,
            dueAt: dueAt,
            alertLeadTime: alertLeadTime,
            recurrenceFrequency: recurrence.frequency,
            recurrenceInterval: recurrence.frequency == .biweekly ? recurrence.interval / 2 : recurrence.interval,
            recurrenceWeekdays: recurrence.weekdays,
            recurrenceEndDate: recurrence.endDate
        )
    }

      /// Non-nil when this reminder is a series template (has recurrence enabled).
    public var hasRecurrence: Bool {
        recurrenceFrequency != nil && !recurrenceWeekdays.isEmpty
    }

      /// Builds a `ReminderRecurrence` from this reminder's flat fields.
    public var recurrence: ReminderRecurrence? {
        guard let frequency = recurrenceFrequency,
           let endDate = recurrenceEndDate,
           !recurrenceWeekdays.isEmpty else { return nil }
        return ReminderRecurrence(
            frequency: frequency,
            interval: recurrenceInterval ?? 1,
            weekdays: recurrenceWeekdays,
            endDate: endDate
        )
    }
}

// MARK: - ReminderOccurrence

public struct ReminderOccurrence: Identifiable, Equatable, Sendable {
    public let id: String
    public let reminder: FamilyReminder    // concrete occurrence: recurrence == nil, dueAt = concrete time
    public let sourceReminder: FamilyReminder

     /// The concrete `dueAt` instant for this occurrence.
    public var occurrenceDueAt: Date { reminder.dueAt }
}

// MARK: - ReminderOccurrenceExpander

public enum ReminderOccurrenceExpander {
    public static func occurrences(
        of reminders: [FamilyReminder],
        in range: DateInterval,
        calendar: Calendar = .autoupdatingCurrent
     ) -> [ReminderOccurrence] {
        reminders
             .flatMap { occurrences(of: $0, in: range, calendar: calendar) }
             .sorted { $0.occurrenceDueAt < $1.occurrenceDueAt }
     }

    public static func occurrences(
        of source: FamilyReminder,
        in range: DateInterval,
        calendar: Calendar = .autoupdatingCurrent
     ) -> [ReminderOccurrence] {
        guard source.recurrence != nil else {
            guard range.contains(source.dueAt) else { return [] }
            return [occurrence(source: source, dueAt: source.dueAt)]
          }

        let dueTimes = weeklyDueTimes(from: source, through: range.end, calendar: calendar)
        return dueTimes
             .filter { $0 >= range.start && $0 < range.end }
             .map { occurrence(source: source, dueAt: $0) }
     }

    static func occurrence(source: FamilyReminder, dueAt: Date) -> ReminderOccurrence {
        var concrete = source
        concrete.dueAt = dueAt
        concrete.recurrenceFrequency = nil
        concrete.recurrenceWeekdays = []
        concrete.recurrenceEndDate = nil
        concrete.recurrenceSeriesID = source.recurrenceSeriesID ?? source.id
        concrete.status = .open
        concrete.completedAt = nil
        concrete.completedByMemberID = nil
        return ReminderOccurrence(
            id: "\(source.recurrenceSeriesID?.uuidString ?? source.id.uuidString)-\(Int(dueAt.timeIntervalSince1970))",
            reminder: concrete,
            sourceReminder: source
         )
     }

     /// Generates concrete due times for selected weekdays in each matching week.
    static func weeklyDueTimes(
        from source: FamilyReminder,
        through: Date,
        calendar: Calendar
     ) -> [Date] {
        guard let recurrence = source.recurrence else { return [] }
        guard let anchorWeek = calendar.dateInterval(of: .weekOfYear, for: source.dueAt)?.start else { return [] }
        let selected = Set(recurrence.weekdays)
        var result: [Date] = []
        var candidate = source.dueAt
        while candidate <= recurrence.endDate && candidate <= through {
              // Calendar weekday: 1=Sunday..7=Saturday; ISO: 1=Monday..7=Sunday
            let iso = calendar.component(.weekday, from: candidate) == 1
                 ? 7
                 : calendar.component(.weekday, from: candidate) - 1
            if let weekday = ReminderRecurrence.Weekday(rawValue: iso), selected.contains(weekday) {
                let weekStart = calendar.dateInterval(of: .weekOfYear, for: candidate)?.start
                let elapsedWeeks = weekStart.flatMap {
                    calendar.dateComponents([.day], from: anchorWeek, to: $0).day.map { $0 / 7 }
                 } ?? 0
                if elapsedWeeks.isMultiple(of: recurrence.effectiveInterval) {
                    result.append(candidate)
                 }
              }
            guard let next = calendar.date(byAdding: .day, value: 1, to: candidate), next > candidate else { break }
            candidate = next
          }
        return result
     }
}

// MARK: - ReminderStoreError & Protocols

public enum ReminderStoreError: Error, Equatable, Sendable {
    case titleRequired
    case assigneeRequired
    case reminderNotFound
}

public protocol ReminderAlertScheduler: Sendable {
    func schedule(_ reminder: FamilyReminder) async throws
    func cancel(_ reminder: FamilyReminder) async
}

public protocol ReminderStore: Sendable {
    func reminders() async throws -> [FamilyReminder]
    func save(_ reminder: FamilyReminder) async throws
    func delete(_ reminder: FamilyReminder) async throws
    func complete(_ reminder: FamilyReminder, by memberID: KidID) async throws
    func reopen(_ reminder: FamilyReminder) async throws
     /// Returns concrete occurrence reminders expanded from series within the given range.
    func occurrences(_ series: [FamilyReminder], in range: DateInterval) async throws -> [FamilyReminder]
}

// MARK: - LocalReminderStore

public actor LocalReminderStore: ReminderStore {
    private let storageURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(storageURL: URL) {
        self.storageURL = storageURL
        encoder = JSONEncoder()
        decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    public func reminders() async throws -> [FamilyReminder] {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return [] }
        let data = try Data(contentsOf: storageURL)
        return try decoder.decode([FamilyReminder].self, from: data)
             .sorted(by: { $0.dueAt < $1.dueAt })
     }

    public func save(_ reminder: FamilyReminder) async throws {
        guard !reminder.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ReminderStoreError.titleRequired
        }
        guard !reminder.assigneeIDs.isEmpty else {
            throw ReminderStoreError.assigneeRequired
        }
        var saved = try await reminders()
        saved.removeAll { $0.id == reminder.id }
        saved.append(reminder)
        try write(saved)
    }

    public func delete(_ reminder: FamilyReminder) async throws {
        var saved = try await reminders()
        let seriesID = reminder.recurrenceSeriesID ?? reminder.id
        saved.removeAll { $0.id == reminder.id || ($0.recurrenceSeriesID == seriesID && $0.id != reminder.id) }
        try write(saved)
    }

    public func complete(_ reminder: FamilyReminder, by memberID: KidID) async throws {
        var saved = try await reminders()
        guard let index = saved.firstIndex(where: { $0.id == reminder.id }) else {
            throw ReminderStoreError.reminderNotFound
        }
        saved[index].status = .completed
        saved[index].completedAt = .now
        saved[index].completedByMemberID = memberID
        try write(saved)
    }

    public func reopen(_ reminder: FamilyReminder) async throws {
        var saved = try await reminders()
        guard let index = saved.firstIndex(where: { $0.id == reminder.id }) else {
            throw ReminderStoreError.reminderNotFound
        }
        saved[index].status = .open
        saved[index].completedAt = nil
        saved[index].completedByMemberID = nil
        try write(saved)
    }

    public func occurrences(_ series: [FamilyReminder], in range: DateInterval) async throws -> [FamilyReminder] {
        ReminderOccurrenceExpander.occurrences(of: series, in: range).map(\.reminder)
    }

    private func write(_ reminders: [FamilyReminder]) throws {
        try FileManager.default.createDirectory(
            at: storageURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try encoder.encode(reminders).write(to: storageURL, options: .atomic)
    }
}
