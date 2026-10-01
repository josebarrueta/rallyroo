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
        case monthly
        case yearly
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
    public let endDate: Date?
    public let timeZone: String?

    public init(
        frequency: Frequency = .weekly,
        interval: Int = 1,
        weekdays: [Weekday] = [],
        endDate: Date? = nil,
        timeZone: String? = nil
     ) {
        self.frequency = frequency
        self.interval = max(1, frequency == .biweekly ? interval * 2 : interval)
        self.weekdays = Array(Set(weekdays)).sorted()
        self.endDate = endDate
        self.timeZone = timeZone
     }

     /// Effective interval in the selected frequency's calendar unit.
     /// Biweekly stores two weeks in `interval`.
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

     /// Recurrence fields. Weekly frequencies also require at least one weekday;
     /// monthly and yearly frequencies derive their calendar anchor from `dueAt`.
    public var recurrenceFrequency: ReminderRecurrence.Frequency?
    public var recurrenceInterval: Int?
    public var recurrenceWeekdays: [ReminderRecurrence.Weekday]
    public var recurrenceEndDate: Date?
    public var recurrenceTimeZone: String?

     /// For series linkage; set to `id` for series templates.
    public var recurrenceSeriesID: UUID?

    private enum CodingKeys: String, CodingKey {
        case id, title, assigneeIDs, dueAt, status, completedAt, completedByMemberID
        case alertLeadTime = "alertLeadTimeMinutes"
        case recurrenceFrequency, recurrenceInterval, recurrenceWeekdays, recurrenceEndDate
        case recurrenceTimeZone
        case recurrenceSeriesID
     }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        assigneeIDs = try container.decode([KidID].self, forKey: .assigneeIDs)
        dueAt = try container.decode(Date.self, forKey: .dueAt)
        status = try container.decode(ReminderStatus.self, forKey: .status)
        completedAt = try container.decodeIfPresent(Date.self, forKey: .completedAt)
        completedByMemberID = try container.decodeIfPresent(KidID.self, forKey: .completedByMemberID)
        alertLeadTime = try container.decodeIfPresent(ReminderAlertLeadTime.self, forKey: .alertLeadTime)
        recurrenceFrequency = try container.decodeIfPresent(
            ReminderRecurrence.Frequency.self,
            forKey: .recurrenceFrequency
        )
        recurrenceInterval = try container.decodeIfPresent(Int.self, forKey: .recurrenceInterval)
        recurrenceWeekdays = try container.decodeIfPresent(
            [ReminderRecurrence.Weekday].self,
            forKey: .recurrenceWeekdays
        ) ?? []
        recurrenceEndDate = try container.decodeIfPresent(Date.self, forKey: .recurrenceEndDate)
        recurrenceTimeZone = try container.decodeIfPresent(String.self, forKey: .recurrenceTimeZone)
        recurrenceSeriesID = try container.decodeIfPresent(UUID.self, forKey: .recurrenceSeriesID)
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
        recurrenceTimeZone: String? = nil,
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
        self.recurrenceTimeZone = recurrenceTimeZone
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
            recurrenceEndDate: recurrence.endDate,
            recurrenceTimeZone: recurrence.timeZone
        )
    }

      /// Non-nil when this reminder is a series template (has recurrence enabled).
    public var hasRecurrence: Bool {
        guard let frequency = recurrenceFrequency else { return false }
        switch frequency {
        case .weekly, .biweekly: return !recurrenceWeekdays.isEmpty
        case .monthly, .yearly: return true
        }
    }

      /// Builds a `ReminderRecurrence` from this reminder's flat fields.
    public var recurrence: ReminderRecurrence? {
        guard let frequency = recurrenceFrequency, hasRecurrence else { return nil }
        return ReminderRecurrence(
            frequency: frequency,
            interval: recurrenceInterval ?? 1,
            weekdays: recurrenceWeekdays,
            endDate: recurrenceEndDate,
            timeZone: recurrenceTimeZone
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

        let dueTimes = recurringDueTimes(from: source, through: range.end, calendar: calendar)
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
        concrete.recurrenceTimeZone = nil
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

    static func recurringDueTimes(
        from source: FamilyReminder,
        through: Date,
        calendar: Calendar
    ) -> [Date] {
        guard let recurrence = source.recurrence else { return [] }
        var recurrenceCalendar = calendar
        if let identifier = recurrence.timeZone, let timeZone = TimeZone(identifier: identifier) {
            recurrenceCalendar.timeZone = timeZone
        }
        switch recurrence.frequency {
        case .weekly, .biweekly:
            return weeklyDueTimes(from: source, through: through, calendar: recurrenceCalendar)
        case .monthly:
            return calendarDueTimes(from: source, through: through, component: .month, calendar: recurrenceCalendar)
        case .yearly:
            return calendarDueTimes(from: source, through: through, component: .year, calendar: recurrenceCalendar)
        }
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
        while candidate <= (recurrence.endDate ?? through) && candidate <= through {
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

    private static func calendarDueTimes(
        from source: FamilyReminder,
        through: Date,
        component: Calendar.Component,
        calendar: Calendar
    ) -> [Date] {
        guard let recurrence = source.recurrence else { return [] }
        let anchor = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second, .nanosecond],
            from: source.dueAt
        )
        guard let anchorDay = anchor.day, let anchorMonth = anchor.month,
              let anchorYear = anchor.year else { return [] }

        var result: [Date] = []
        var offset = 0
        let limit = min(recurrence.endDate ?? through, through)
        while true {
            let targetYear = component == .year ? anchorYear + offset : nil
            let targetMonth = component == .year ? anchorMonth : nil
            let monthBase: Date?
            if component == .month {
                monthBase = calendar.date(byAdding: .month, value: offset, to: calendar.date(
                    from: DateComponents(year: anchorYear, month: anchorMonth, day: 1)
                )!)
            } else {
                monthBase = calendar.date(from: DateComponents(year: targetYear, month: targetMonth, day: 1))
            }
            guard let monthBase,
                  let days = calendar.range(of: .day, in: .month, for: monthBase)?.count else { break }
            var target = calendar.dateComponents([.year, .month], from: monthBase)
            target.day = min(anchorDay, days)
            target.hour = anchor.hour
            target.minute = anchor.minute
            target.second = anchor.second
            target.nanosecond = anchor.nanosecond
            guard let candidate = calendar.date(from: target), candidate <= limit else { break }
            if candidate >= source.dueAt { result.append(candidate) }
            offset += max(1, recurrence.interval)
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
