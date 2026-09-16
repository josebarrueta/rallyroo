import Foundation

public struct EventRecurrence: Codable, Equatable, Sendable {
    public enum Frequency: String, Codable, CaseIterable, Sendable {
        case daily
        case weekly
        case monthly
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
    public let weekdays: [Weekday]?
    public let endDate: Date
    public let timeZone: String?

    public init(
        frequency: Frequency,
        interval: Int = 1,
        weekdays: [Weekday]? = nil,
        endDate: Date,
        timeZone: String? = nil
      ) {
        self.frequency = frequency
        self.interval = max(1, interval)
        self.weekdays = weekdays.map { Array(Set($0)).sorted() }
        self.endDate = endDate
        self.timeZone = timeZone
      }
}

public struct EventOccurrence: Identifiable, Equatable, Sendable {
    public let id: String
    public let event: FamilyEvent
    public let sourceEvent: FamilyEvent
    public let disposition: ScheduleOccurrenceDisposition

    public init(
        id: String,
        event: FamilyEvent,
        sourceEvent: FamilyEvent,
        disposition: ScheduleOccurrenceDisposition = .scheduled
      ) {
        self.id = id
        self.event = event
        self.sourceEvent = sourceEvent
        self.disposition = disposition
      }
}

public enum EventOccurrenceExpander {
    public static func occurrences(
        of events: [FamilyEvent],
        in range: DateInterval,
        calendar: Calendar = .autoupdatingCurrent
      ) -> [EventOccurrence] {
        events.flatMap { occurrences(of: $0, in: range, calendar: calendar) }
              .sorted { $0.event.startTime < $1.event.startTime }
      }

    private static func occurrences(
        of source: FamilyEvent,
        in range: DateInterval,
        calendar: Calendar
      ) -> [EventOccurrence] {
         // Build a lookup of occurrence states by scheduled time for this series.
        var statesByTime: [TimeInterval: ScheduleOccurrenceState] = [:]
        for state in source.occurrenceStates ?? [] {
            if state.reference.kind == .event,
               state.reference.seriesID == (source.recurrenceSeriesID ?? source.id) {
                statesByTime[state.reference.scheduledAt.timeIntervalSince1970] = state
               }
           }

        guard let recurrence = source.recurrence else {
            guard range.contains(source.startTime) else { return [] }
            return [occurrence(source: source, startTime: source.startTime, statesByTime: statesByTime)]
                     .filter { $0.disposition != .deleted }
           }

        var recurrenceCalendar = calendar
        if let identifier = recurrence.timeZone, let tz = TimeZone(identifier: identifier) {
            recurrenceCalendar.timeZone = tz
           }
        let startTimes = recurrence.frequency == .weekly && recurrence.weekdays?.isEmpty == false
                 ? weeklyStartTimes(from: source.startTime, recurrence: recurrence, through: range.end, calendar: recurrenceCalendar)
                 : regularStartTimes(from: source.startTime, recurrence: recurrence, through: range.end, calendar: recurrenceCalendar)
        return startTimes
                 .filter { $0 >= range.start && $0 < range.end && $0 <= recurrence.endDate }
                 .map { occurrence(source: source, startTime: $0, statesByTime: statesByTime) }
                 .filter { $0.disposition != .deleted }
      }

    private static func occurrence(
        source: FamilyEvent,
        startTime: Date,
        statesByTime: [TimeInterval: ScheduleOccurrenceState]
      ) -> EventOccurrence {
        var event = source
        event.startTime = startTime
        event.endTime = startTime.addingTimeInterval(source.endTime.timeIntervalSince(source.startTime))
        let startDelta = startTime.timeIntervalSince(source.startTime)
        event.arrivalTime = source.arrivalTime.map { $0.addingTimeInterval(startDelta) }

        let disposition: ScheduleOccurrenceDisposition
        if let state = statesByTime[startTime.timeIntervalSince1970] {
            disposition = state.disposition
            // Acknowledgement per-Member is handled by the view layer
            // (see EventOccurrenceExpander.acknowledgedBy).
           } else {
            disposition = .scheduled
          }

        return EventOccurrence(
            id: "\(source.id.uuidString)-\(Int(startTime.timeIntervalSince1970))",
            event: event,
            sourceEvent: source,
            disposition: disposition
           )
      }

    /// Returns true if any occurrence state acknowledges `memberID` for this event reference.
    public static func isAcknowledged(
        in event: FamilyEvent,
        for memberID: String,
        at startTime: Date
      ) -> Bool {
        for state in event.occurrenceStates ?? [] {
            if state.reference.kind == .event,
               state.reference.scheduledAt.timeIntervalSince1970 == startTime.timeIntervalSince1970,
               state.acknowledgedMemberIDs.contains(memberID) {
                return true
               }
           }
        return false
      }

    private static func regularStartTimes(
        from first: Date,
        recurrence: EventRecurrence,
        through: Date,
        calendar: Calendar
      ) -> [Date] {
        var result: [Date] = []
        var current = first
        while current <= recurrence.endDate && current <= through {
            result.append(current)
            guard let next = nextDate(after: current, recurrence: recurrence, calendar: calendar),
                  next > current else { break }
            current = next
           }
        return result
      }

    private static func weeklyStartTimes(
        from first: Date,
        recurrence: EventRecurrence,
        through: Date,
        calendar: Calendar
      ) -> [Date] {
        guard let weekdays = recurrence.weekdays, !weekdays.isEmpty,
              let anchorWeek = calendar.dateInterval(of: .weekOfYear, for: first)?.start else { return [] }
        let selected = Set(weekdays)
        var result: [Date] = []
        var candidate = first
        while candidate <= recurrence.endDate && candidate <= through {
            let calendarWeekday = calendar.component(.weekday, from: candidate)
            let isoWeekday = EventRecurrence.Weekday(rawValue: calendarWeekday == 1 ? 7 : calendarWeekday - 1)
            let candidateWeek = calendar.dateInterval(of: .weekOfYear, for: candidate)?.start
            let elapsedWeeks = candidateWeek.flatMap {
                calendar.dateComponents([.day], from: anchorWeek, to: $0).day.map { $0 / 7 }
              } ?? 0
            if elapsedWeeks.isMultiple(of: recurrence.interval),
               isoWeekday.map(selected.contains) == true {
                result.append(candidate)
              }
            guard let next = calendar.date(byAdding: .day, value: 1, to: candidate), next > candidate else { break }
            candidate = next
           }
        return result
      }

    private static func nextDate(
        after date: Date,
        recurrence: EventRecurrence,
        calendar: Calendar
      ) -> Date? {
        switch recurrence.frequency {
        case .daily:
            calendar.date(byAdding: .day, value: recurrence.interval, to: date)
        case .weekly:
            calendar.date(byAdding: .day, value: recurrence.interval * 7, to: date)
        case .monthly:
            calendar.date(byAdding: .month, value: recurrence.interval, to: date)
           }
      }
}
