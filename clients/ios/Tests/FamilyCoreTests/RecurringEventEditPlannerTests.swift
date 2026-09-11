import Foundation
import XCTest
@testable import FamilyCore

final class RecurringEventEditPlannerTests: XCTestCase {
    private let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.firstWeekday = 1
        return calendar
    }()

    func testAllFuturePreservesPastOccurrencesAndEditsEveryFutureWeekday() throws {
        let source = series()
        let occurrenceStart = date(2026, 9, 10, 16)
        let edited = editedOccurrence(from: source, start: occurrenceStart)

        let plan = try RecurringEventEditPlanner.plan(
            edited: edited,
            source: source,
            scope: .allFuture,
            occurrenceStart: occurrenceStart,
            calendar: calendar,
            makeID: idSequence()
        )

        assertUniqueIDs(plan)
        XCTAssertEqual(plan.affectedEvents.count, 1)
        assertOccurrence(plan.upserts, at: date(2026, 9, 9, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: occurrenceStart, title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
        assertOccurrence(plan.upserts, at: date(2026, 9, 16, 16), title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
        assertOccurrence(plan.upserts, at: date(2026, 9, 17, 16), title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
    }

    func testWeekdayFuturePreservesPastAndChangesOnlySelectedWeekday() throws {
        let source = series()
        let occurrenceStart = date(2026, 9, 10, 16)
        let edited = editedOccurrence(from: source, start: occurrenceStart)

        let plan = try RecurringEventEditPlanner.plan(
            edited: edited,
            source: source,
            scope: .thisWeekdayAndFuture,
            occurrenceStart: occurrenceStart,
            calendar: calendar,
            makeID: idSequence()
        )

        assertUniqueIDs(plan)
        assertOccurrence(plan.upserts, at: date(2026, 9, 3, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: date(2026, 9, 9, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: occurrenceStart, title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
        assertOccurrence(plan.upserts, at: date(2026, 9, 16, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: date(2026, 9, 17, 16), title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
    }

    func testThisOccurrencePreservesPastAndFutureOccurrences() throws {
        let source = series()
        let occurrenceStart = date(2026, 9, 10, 16)
        let edited = editedOccurrence(from: source, start: occurrenceStart)

        let plan = try RecurringEventEditPlanner.plan(
            edited: edited,
            source: source,
            scope: .thisOccurrence,
            occurrenceStart: occurrenceStart,
            calendar: calendar,
            makeID: idSequence()
        )

        assertUniqueIDs(plan)
        XCTAssertEqual(plan.affectedEvents.count, 1)
        assertOccurrence(plan.upserts, at: date(2026, 9, 9, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: occurrenceStart, title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
        assertOccurrence(plan.upserts, at: date(2026, 9, 16, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: date(2026, 9, 17, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
    }

    func testWeekdayFutureSupportsBiweeklySeries() throws {
        let source = series(recurrence: EventRecurrence(
            frequency: .weekly,
            interval: 2,
            weekdays: [.wednesday, .thursday],
            endDate: date(2026, 12, 31, 16)
        ))
        let occurrenceStart = date(2026, 9, 17, 16)
        let plan = try RecurringEventEditPlanner.plan(
            edited: editedOccurrence(from: source, start: occurrenceStart),
            source: source,
            scope: .thisWeekdayAndFuture,
            occurrenceStart: occurrenceStart,
            calendar: calendar,
            makeID: idSequence()
        )

        assertOccurrence(plan.upserts, at: date(2026, 9, 16, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: date(2026, 9, 17, 16), title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
        assertOccurrence(plan.upserts, at: date(2026, 9, 30, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: date(2026, 10, 1, 16), title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
    }

    func testBiweeklyWeekdaySplitPreservesParityAcrossAWeekBoundary() throws {
        let source = series(recurrence: EventRecurrence(
            frequency: .weekly,
            interval: 2,
            weekdays: [.monday, .saturday],
            endDate: date(2026, 12, 31, 16)
        ))
        let occurrenceStart = date(2026, 9, 19, 16)
        let plan = try RecurringEventEditPlanner.plan(
            edited: editedOccurrence(from: source, start: occurrenceStart),
            source: source,
            scope: .thisWeekdayAndFuture,
            occurrenceStart: occurrenceStart,
            calendar: calendar,
            makeID: idSequence()
        )

        let starts = EventOccurrenceExpander.occurrences(
            of: plan.upserts,
            in: DateInterval(start: date(2026, 9, 19), end: date(2026, 10, 10)),
            calendar: calendar
        ).map(\.event.startTime)
        XCTAssertFalse(starts.contains(date(2026, 9, 21, 16)))
        assertOccurrence(plan.upserts, at: date(2026, 9, 28, 16), title: "Practice", alert: .fifteenMinutes, driver: "parent-1")
        assertOccurrence(plan.upserts, at: date(2026, 10, 3, 16), title: "Carpool", alert: .fortyFiveMinutes, driver: "parent-2")
    }

    func testWeekdayFutureRejectsNonWeeklyRecurrence() {
        let source = series(recurrence: EventRecurrence(
            frequency: .daily,
            endDate: date(2026, 12, 31, 16)
        ))
        let occurrenceStart = date(2026, 9, 3, 16)

        XCTAssertThrowsError(try RecurringEventEditPlanner.plan(
            edited: editedOccurrence(from: source, start: occurrenceStart),
            source: source,
            scope: .thisWeekdayAndFuture,
            occurrenceStart: occurrenceStart,
            calendar: calendar,
            makeID: idSequence()
        )) { error in
            XCTAssertEqual(error as? RecurringEventEditError, .weekdayScopeRequiresWeeklyRecurrence)
        }
    }

    private func series(recurrence: EventRecurrence? = nil) -> FamilyEvent {
        let start = date(2026, 9, 2, 16)
        return FamilyEvent(
            id: UUID(uuidString: "10000000-0000-4000-8000-000000000001")!,
            title: "Practice",
            kidID: KidID(rawValue: "kid-1"),
            participantIDs: [KidID(rawValue: "kid-1")],
            startTime: start,
            endTime: start.addingTimeInterval(60 * 60),
            location: "Field",
            driverMemberID: KidID(rawValue: "parent-1"),
            source: .manual,
            status: .confirmed,
            alertLeadTime: .fifteenMinutes,
            recurrence: recurrence ?? EventRecurrence(
                frequency: .weekly,
                weekdays: [.wednesday, .thursday],
                endDate: date(2026, 12, 31, 16)
            )
        )
    }

    private func editedOccurrence(from source: FamilyEvent, start: Date) -> FamilyEvent {
        FamilyEvent(
            id: source.id,
            title: "Carpool",
            kidID: source.kidID,
            participantIDs: source.participantIDs,
            startTime: start,
            endTime: start.addingTimeInterval(45 * 60),
            location: "New field",
            driverMemberID: KidID(rawValue: "parent-2"),
            source: source.source,
            status: source.status,
            alertLeadTime: .fortyFiveMinutes,
            recurrence: source.recurrence
        )
    }

    private func assertUniqueIDs(_ plan: RecurringEventEditPlan, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(Set(plan.upserts.map(\.id)).count, plan.upserts.count, file: file, line: line)
        XCTAssertTrue(plan.upserts.contains { $0.id == UUID(uuidString: "10000000-0000-4000-8000-000000000001")! }, file: file, line: line)
    }

    private func assertOccurrence(
        _ events: [FamilyEvent],
        at start: Date,
        title: String,
        alert: EventAlertLeadTime,
        driver: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let range = DateInterval(start: date(2026, 9, 1), end: date(2026, 10, 31, 23))
        let occurrence = EventOccurrenceExpander.occurrences(of: events, in: range, calendar: calendar)
            .first { $0.event.startTime == start }
        XCTAssertEqual(occurrence?.event.title, title, file: file, line: line)
        XCTAssertEqual(occurrence?.event.alertLeadTime, alert, file: file, line: line)
        XCTAssertEqual(occurrence?.event.driverMemberID, KidID(rawValue: driver), file: file, line: line)
    }

    private func idSequence() -> () -> UUID {
        var value = 10
        return {
            defer { value += 1 }
            return UUID(uuidString: "20000000-0000-4000-8000-0000000000\(value)")!
        }
    }

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour))!
    }
}
