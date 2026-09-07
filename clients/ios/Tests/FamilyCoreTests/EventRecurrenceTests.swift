import Foundation
import XCTest
@testable import FamilyCore

final class EventRecurrenceTests: XCTestCase {
    func testExpandsWeeklyEventOnMondayAndWednesday() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        calendar.firstWeekday = 2
        let monday = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 1, day: 5, hour: 16
        )))
        let event = FamilyEvent(
            title: "Practice",
            kidID: KidID(rawValue: "kid-1"),
            startTime: monday,
            endTime: monday.addingTimeInterval(3600),
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                weekdays: [.monday, .wednesday],
                endDate: calendar.date(byAdding: .day, value: 9, to: monday)!
            )
        )
        let range = DateInterval(
            start: monday,
            end: calendar.date(byAdding: .day, value: 10, to: monday)!
        )

        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event],
            in: range,
            calendar: calendar
        )

        XCTAssertEqual(occurrences.map(\.event.startTime), [
            monday,
            calendar.date(byAdding: .day, value: 2, to: monday)!,
            calendar.date(byAdding: .day, value: 7, to: monday)!,
            calendar.date(byAdding: .day, value: 9, to: monday)!,
        ])
    }

    func testExpandsEveryTwoWeeksWithinVisibleRange() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let start = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 1, day: 5, hour: 16
        )))
        let event = FamilyEvent(
            title: "Chess Class",
            kidID: KidID(rawValue: "kid-1"),
            startTime: start,
            endTime: start.addingTimeInterval(3600),
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                interval: 2,
                endDate: calendar.date(byAdding: .month, value: 2, to: start)!
            )
        )
        let range = DateInterval(
            start: start,
            end: calendar.date(byAdding: .month, value: 1, to: start)!
        )

        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event],
            in: range,
            calendar: calendar
        )

        XCTAssertEqual(occurrences.map(\.event.startTime), [
            start,
            calendar.date(byAdding: .day, value: 14, to: start)!,
            calendar.date(byAdding: .day, value: 28, to: start)!,
        ])
        XCTAssertEqual(Set(occurrences.map(\.id)).count, 3)
        XCTAssertEqual(occurrences.last?.sourceEvent.id, event.id)
    }
}
