import XCTest
@testable import FamilyCore

final class EventOccurrenceTests: XCTestCase {
    private func makeCalendar() -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return cal
       }

    private func makeEvent(
        seriesID: String = "00000000-0000-4000-8000-000000000001",
        occurrenceStates: [ScheduleOccurrenceState]? = nil
       ) -> FamilyEvent {
        FamilyEvent(
            id: UUID(uuidString: seriesID) ?? UUID(),
            title: "Soccer",
            kidID: nil,
            participantIDs: [],
            startTime: Date(timeIntervalSince1970: 0), // will be set by recurrence
            endTime: Date(timeIntervalSince1970: 0),
            source: .manual,
            status: .confirmed,
            recurrenceSeriesID: UUID(uuidString: seriesID),
            occurrenceStates: occurrenceStates
           )
       }

    func testDeletedOccurrencesAreFiltered() {
        // Create a daily recurring event starting on a specific date
        let calendar = makeCalendar()
        var event = makeEvent()
        event.recurrence = EventRecurrence(
            frequency: .daily,
            interval: 1,
            endDate: calendar.date(byAdding: .day, value: 3, to: Date(timeIntervalSince1970: 0))!
           )
        // Mark the second occurrence as deleted
        let deletedState = ScheduleOccurrenceState(
            familyID: "family-1",
            reference: ScheduleOccurrenceReference(
                kind: .event,
                seriesID: event.recurrenceSeriesID!,
                scheduledAt: Date(timeIntervalSince1970: 86400)
               ),
            disposition: .deleted,
            acknowledgedMemberIDs: [],
            overrideEntityID: nil,
            completedAt: nil,
            completedByMemberID: nil
           )
        event.occurrenceStates = [deletedState]

        // Expand events across a range that includes 3 occurrences
        let range = DateInterval(
            start: Date(timeIntervalSince1970: -1 * 86400),
            duration: 4 * 86400
           )
        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event], in: range, calendar: calendar
           )
        // Only 2 of 3 should come back (deleted one is filtered out)
        XCTAssertEqual(occurrences.count, 2)
        XCTAssertFalse(occurrences.contains { $0.disposition == .deleted })
       }

    func testSkippedOccurrencesAreIncludedWithDisposition() {
        let calendar = makeCalendar()
        var event = makeEvent()
        event.recurrence = EventRecurrence(
            frequency: .daily,
            interval: 1,
            endDate: calendar.date(byAdding: .day, value: 2, to: Date(timeIntervalSince1970: 0))!
           )
        let skippedState = ScheduleOccurrenceState(
            familyID: "family-1",
            reference: ScheduleOccurrenceReference(
                kind: .event,
                seriesID: event.recurrenceSeriesID!,
                scheduledAt: Date(timeIntervalSince1970: 0)
               ),
            disposition: .skipped,
            acknowledgedMemberIDs: ["parent-1"],
            overrideEntityID: nil,
            completedAt: nil,
            completedByMemberID: nil
           )
        event.occurrenceStates = [skippedState]

        let range = DateInterval(
            start: Date(timeIntervalSince1970: -1 * 86400),
            duration: 4 * 86400
           )
        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event], in: range, calendar: calendar
           )
        // All 3 should be included but first should be marked skipped
        XCTAssertEqual(occurrences.count, 3)
        let first = occurrences.first { $0.event.startTime == Date(timeIntervalSince1970: 0) }
        XCTAssertNotNil(first)
        XCTAssertEqual(first?.disposition, .skipped)
       }

    func testDefaultDispositionIsScheduled() {
        let calendar = makeCalendar()
        var event = makeEvent()
        event.recurrence = EventRecurrence(
            frequency: .daily,
            interval: 1,
            endDate: calendar.date(byAdding: .day, value: 1, to: Date(timeIntervalSince1970: 0))!
           )

        let range = DateInterval(
            start: Date(timeIntervalSince1970: -1 * 86400),
            duration: 2 * 86400
           )
        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event], in: range, calendar: calendar
           )
        XCTAssertFalse(occurrences.isEmpty)
        XCTAssertTrue(occurrences.allSatisfy { $0.disposition == .scheduled })
       }

    func testIsAcknowledgedReturnsTrueForMatchingMember() {
        let calendar = makeCalendar()
        var event = makeEvent()
        event.recurrence = EventRecurrence(
            frequency: .daily,
            interval: 1,
            endDate: calendar.date(byAdding: .day, value: 1, to: Date(timeIntervalSince1970: 0))!
           )
        let state = ScheduleOccurrenceState(
            familyID: "family-1",
            reference: ScheduleOccurrenceReference(
                kind: .event,
                seriesID: event.recurrenceSeriesID!,
                scheduledAt: Date(timeIntervalSince1970: 0)
               ),
            disposition: .scheduled,
            acknowledgedMemberIDs: ["kid-1"],
            overrideEntityID: nil,
            completedAt: nil,
            completedByMemberID: nil
           )
        event.occurrenceStates = [state]

        XCTAssertTrue(EventOccurrenceExpander.isAcknowledged(
            in: event, for: "kid-1", at: Date(timeIntervalSince1970: 0)
           ))
        XCTAssertFalse(EventOccurrenceExpander.isAcknowledged(
            in: event, for: "parent-1", at: Date(timeIntervalSince1970: 0)
           ))
       }
}
