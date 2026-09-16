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

    func testExpandsWeeklyEventUsingSeriesTimeZoneInsteadOfViewerTimeZone() throws {
        let sourceStart = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-10T00:30:00Z"))
        let rangeEnd = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-24T00:31:00Z"))
        let event = FamilyEvent(
            title: "Practice",
            kidID: KidID(rawValue: "kid-1"),
            startTime: sourceStart,
            endTime: sourceStart.addingTimeInterval(3600),
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                weekdays: [.wednesday],
                endDate: rangeEnd,
                timeZone: "America/Los_Angeles"
            )
        )
        var viewerCalendar = Calendar(identifier: .gregorian)
        viewerCalendar.timeZone = TimeZone(secondsFromGMT: 0)!

        let starts = EventOccurrenceExpander.occurrences(
            of: [event],
            in: DateInterval(start: sourceStart, end: rangeEnd),
            calendar: viewerCalendar
        ).map(\.event.startTime)

        XCTAssertEqual(starts, [
            sourceStart,
            sourceStart.addingTimeInterval(7 * 24 * 3600),
            sourceStart.addingTimeInterval(14 * 24 * 3600),
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
