import Foundation
import XCTest
@testable import FamilyCore

final class RecurringEventEditPlannerTests: XCTestCase {
    private let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
      }()

    private var wednesdayThursdays: EventRecurrence {
        EventRecurrence(
            frequency: .weekly,
            weekdays: [.wednesday, .thursday],
            endDate: isoDate(day: 31, month: 12, year: 2026),
         )
     }

    private func isoDate(day: Int, month: Int, year: Int) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day))!
      }

    private func series(
        id: UUID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!,
        title: String = "Soccer Practice",
        start: Date,
        recurrence: EventRecurrence,
        driverMemberID: KidID? = KidID(rawValue: "parent-1"),
        alert: EventAlertLeadTime? = .fifteenMinutes,
      ) -> FamilyEvent {
        FamilyEvent(
            id: id,
            title: title,
            kidID: KidID(rawValue: "kid-1"),
            participantIDs: [KidID(rawValue: "kid-1")],
            startTime: start,
            endTime: start.addingTimeInterval(60 * 60),
            location: "Field",
            driver: nil,
            driverMemberID: driverMemberID,
            source: .manual,
            status: .confirmed,
            alertLeadTime: alert,
            recurrence: recurrence,
         )
      }

    func testAllFutureReplacesTheSingleSeriesKeepingIdentityAndRecurrence() {
        let source = series(start: isoDate(day: 4, month: 9, year: 2026), recurrence: wednesdayThursdays)
        var edited = source
        edited.startTime = isoDate(day: 11, month: 9, year: 2026) // a Thursday
        edited.endTime = edited.startTime.addingTimeInterval(90 * 60)
        edited.alertLeadTime = .thirtyMinutes
        edited.driverMemberID = KidID(rawValue: "kid-2")

        let plan = RecurringEventEditPlanner.plan(
            edited: edited,
            source: source,
            scope: .allFuture,
            occurrenceStart: isoDate(day: 11, month: 9, year: 2026),
            calendar: calendar,
         )

       XCTAssertEqual(plan.deleteIDs, [source.id])
        XCTAssertEqual(plan.upserts.count, 1)
        let resulting = plan.upserts[0]
        XCTAssertEqual(resulting.id, source.id)
        XCTAssertEqual(resulting.recurrence?.weekdays, [.wednesday, .thursday])
        XCTAssertEqual(resulting.alertLeadTime, .thirtyMinutes)
        XCTAssertEqual(resulting.driverMemberID, KidID(rawValue: "kid-2"))
     }

    func testThisWeekdayAndFutureIsolatesOnlyTheAffectedWeekday() {
        let source = series(start: isoDate(day: 3, month: 9, year: 2026), recurrence: wednesdayThursdays)
        let thursday = isoDate(day: 10, month: 9, year: 2026)
        var edited = source
        edited.title = "Carpool"
        edited.startTime = thursday
        edited.endTime = thursday.addingTimeInterval(60 * 60)
        edited.alertLeadTime = .fortyFiveMinutes
        edited.driverMemberID = KidID(rawValue: "kid-2")

        let plan = RecurringEventEditPlanner.plan(
            edited: edited,
            source: source,
            scope: .thisWeekdayAndFuture,
            occurrenceStart: thursday,
            calendar: calendar,
         )

       XCTAssertEqual(Set(plan.deleteIDs), [source.id])
        XCTAssertEqual(plan.upserts.count, 2)

        let base = plan.upserts.first { $0.recurrence?.weekdays == [.wednesday] }
        let daySeries = plan.upserts.first { $0.recurrence?.weekdays == [.thursday] }!
        XCTAssertNotNil(base)
        XCTAssertEqual(daySeries.title, "Carpool")
        XCTAssertEqual(daySeries.driverMemberID, KidID(rawValue: "kid-2"))
        XCTAssertEqual(daySeries.alertLeadTime, .fortyFiveMinutes)
        XCTAssertEqual(daySeries.startTime, thursday)
        // The Wednesday row must retain the original schedule untouched.
        XCTAssertEqual(base?.title, "Soccer Practice")
        XCTAssertEqual(base?.driverMemberID, KidID(rawValue: "parent-1"))
        XCTAssertEqual(base?.alertLeadTime, .fifteenMinutes)
     }

    func testThisOccurrenceReplacesOnlyTheTappedDayAndContinuesTheWeekday() {
        let source = series(start: isoDate(day: 3, month: 9, year: 2026), recurrence: wednesdayThursdays)
        let thisThursday = isoDate(day: 10, month: 9, year: 2026)
        var edited = source
        edited.title = "Special"
        edited.startTime = thisThursday
        edited.endTime = thisThursday.addingTimeInterval(45 * 60)
        edited.alertLeadTime = .atStart
        edited.driverMemberID = KidID(rawValue: "kid-2")

        let plan = RecurringEventEditPlanner.plan(
            edited: edited,
            source: source,
            scope: .thisOccurrence,
            occurrenceStart: thisThursday,
            calendar: calendar,
         )

        let single = plan.upserts.first { $0.title == "Special" && $0.recurrence == nil }!
        XCTAssertEqual(single.startTime, thisThursday)
        XCTAssertEqual(single.endTime, thisThursday.addingTimeInterval(45 * 60))

        let continuation = plan.upserts.first {
            $0.recurrence?.weekdays == [.thursday] && $0.startTime > thisThursday
         }!
        XCTAssertEqual(continuation.title, "Soccer Practice")
        XCTAssertEqual(continuation.startTime, isoDate(day: 17, month: 9, year: 2026))

        let base = plan.upserts.first { $0.recurrence?.weekdays == [.wednesday] }!
        XCTAssertEqual(base.title, "Soccer Practice")
        // The single edited occurrence carries the change; future Thursdays revert.
        XCTAssertEqual(continuation.alertLeadTime, .fifteenMinutes)
        XCTAssertEqual(continuation.driverMemberID, KidID(rawValue: "parent-1"))
     }

    func testThisWeekdayAndFutureOnTheOnlyWeekdayDropsTheBaseRow() {
        let source = series(
            start: isoDate(day: 3, month: 9, year: 2026),
            recurrence: EventRecurrence(frequency: .weekly, weekdays: [.thursday], endDate: isoDate(day: 31, month: 12, year: 2026)),
         )
        var edited = source
        edited.startTime = isoDate(day: 10, month: 9, year: 2026)
        let plan = RecurringEventEditPlanner.plan(
            edited: edited, source: source, scope: .thisWeekdayAndFuture,
            occurrenceStart: isoDate(day: 10, month: 9, year: 2026), calendar: calendar,
         )
        XCTAssertEqual(plan.upserts.count, 1)
        XCTAssertEqual(plan.upserts[0].recurrence?.weekdays, [.thursday])
     }

    func testNonWeeklyRecurrenceFallsBackToInPlaceEdit() {
        let source = series(
            start: isoDate(day: 4, month: 9, year: 2026),
            recurrence: EventRecurrence(frequency: .daily, endDate: isoDate(day: 31, month: 12, year: 2026)),
         )
        var edited = source
        edited.title = "Renamed"
        let plan = RecurringEventEditPlanner.plan(
            edited: edited, source: source, scope: .thisWeekdayAndFuture,
            occurrenceStart: isoDate(day: 4, month: 9, year: 2026), calendar: calendar,
         )
        XCTAssertEqual(plan.upserts.count, 1)
        XCTAssertEqual(plan.upserts[0].id, source.id, "In-place edit preserves identity")
        XCTAssertEqual(plan.upserts[0].title, "Renamed")
        XCTAssertEqual(plan.upserts[0].recurrence?.frequency, .daily)
     }
}
