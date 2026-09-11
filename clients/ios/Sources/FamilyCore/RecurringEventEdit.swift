import Foundation

/// How a parent intends a recurring Event edit (time, alert, driver, …) to reach
/// the series. The scope is resolved into concrete persisted rows so that a
/// multi-day weekly series (for example Carpooling Wed/Thu) can change a single
/// weekday without disturbing the others.
public enum EventEditScope: String, Codable, Equatable, Sendable {
    case thisOccurrence
    case thisWeekdayAndFuture
    case allFuture
}

/// The source rows to remove and the rows to persist for a scoped edit.
/// Past occurrences are never rewritten.
public struct RecurringEventEditPlan: Equatable, Sendable {
    public let deleteIDs: Set<UUID>
    public let upserts: [FamilyEvent]

    public init(deleteIDs: Set<UUID>, upserts: [FamilyEvent]) {
        self.deleteIDs = deleteIDs
        self.upserts = upserts
    }
}

public enum RecurringEventEditPlanner {
    public static func plan(
        edited: FamilyEvent,
        source: FamilyEvent,
        scope: EventEditScope,
        occurrenceStart: Date,
        calendar: Calendar = .autoupdatingCurrent,
    ) -> RecurringEventEditPlan {
        let recurrence = source.recurrence
        let isSplittableWeekly = recurrence?.frequency == .weekly && recurrence?.interval == 1

        guard isSplittableWeekly, let affectedWeekday = isoWeekday(occurrenceStart, calendar) else {
            return RecurringEventEditPlan(deleteIDs: [source.id], upserts: [
                editInPlace(edited, source),
            ])
        }

        let sourceWeekdays = recurrence!.weekdays ?? [affectedWeekday]
        let otherWeekdays = Set(sourceWeekdays).subtracting([affectedWeekday])
        let endDate = recurrence!.endDate

        let base: FamilyEvent? = otherWeekdays.isEmpty
            ? nil
            : source.filteredToWeekdays(otherWeekdays.sorted())

        switch scope {
        case .allFuture:
            return RecurringEventEditPlan(deleteIDs: [source.id], upserts: [
                editInPlace(edited, source),
            ])

        case .thisWeekdayAndFuture:
            let daySeries = edited
                .filteredToWeekdays([affectedWeekday])
                .withTimeRange(start: occurrenceStart, endDate: endDate)
            return RecurringEventEditPlan(
                deleteIDs: [source.id],
                upserts: compacted([base, daySeries]),
            )

        case .thisOccurrence:
            let single = edited
                .withTimeRange(start: occurrenceStart, endDate: occurrenceStart)
                .withoutRecurrence()
            let nextStart = nextWeeklyStart(after: occurrenceStart, weekday: affectedWeekday, calendar: calendar)
            let continuation: FamilyEvent? = nextStart.map { next in
                source
                    .filteredToWeekdays([affectedWeekday])
                    .withTimeRange(start: next, endDate: endDate)
            }
            return RecurringEventEditPlan(
                deleteIDs: [source.id],
                upserts: compacted([base, single, continuation]),
            )
        }
    }

    private static func editInPlace(_ edited: FamilyEvent, _ source: FamilyEvent) -> FamilyEvent {
        var event = source
        event.title = edited.title
        event.kidID = edited.kidID
        event.participantIDs = edited.participantIDs
        event.location = edited.location
        event.driver = edited.driver
        event.driverMemberID = edited.driverMemberID
        event.alertLeadTime = edited.alertLeadTime
        let duration = edited.endTime.timeIntervalSince(edited.startTime)
        event.endTime = event.startTime.addingTimeInterval(duration)
        return event
    }

    private static func compacted(_ rows: [FamilyEvent?]) -> [FamilyEvent] {
        rows.compactMap { $0 }
    }

    private static func isoWeekday(_ date: Date, _ calendar: Calendar) -> EventRecurrence.Weekday? {
        let value = calendar.component(.weekday, from: date)
        return EventRecurrence.Weekday(rawValue: value == 1 ? 7 : value - 1)
    }

    private static func nextWeeklyStart(
        after date: Date,
        weekday: EventRecurrence.Weekday,
        calendar: Calendar,
    ) -> Date? {
        guard let following = calendar.date(byAdding: .day, value: 7, to: date) else { return nil }
        var candidate = following
        for _ in 0..<7 {
            if isoWeekday(candidate, calendar) == weekday { return candidate }
            guard let next = calendar.date(byAdding: .day, value: 1, to: candidate) else { return nil }
            candidate = next
        }
        return nil
    }
}

private extension FamilyEvent {
    func filteredToWeekdays(_ weekdays: [EventRecurrence.Weekday]) -> FamilyEvent {
        guard var recurrence else { return self }
        recurrence = EventRecurrence(
            frequency: recurrence.frequency,
            interval: recurrence.interval,
            weekdays: weekdays,
            endDate: recurrence.endDate,
        )
        var row = self
        row.recurrence = recurrence
        return row
    }

    func withTimeRange(start: Date, endDate: Date) -> FamilyEvent {
        var row = self
        row.startTime = start
        let duration = endTime.timeIntervalSince(startTime)
        row.endTime = start.addingTimeInterval(duration)
        if var recurrence = row.recurrence {
            recurrence = EventRecurrence(
                frequency: recurrence.frequency,
                interval: recurrence.interval,
                weekdays: recurrence.weekdays,
                endDate: endDate,
            )
            row.recurrence = recurrence
        }
        return row
    }

    func withoutRecurrence() -> FamilyEvent {
        var row = self
        row.recurrence = nil
        return row
    }
}
