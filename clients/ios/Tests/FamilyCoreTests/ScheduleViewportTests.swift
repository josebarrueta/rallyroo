import Foundation
import XCTest
@testable import FamilyCore

final class ScheduleViewportTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        calendar.firstWeekday = 1
        return calendar
    }

    func testTodayRestoresTheSevenDayPageAfterMovingForward() throws {
        let today = try date(2026, 9, 20)
        var viewport = ScheduleViewport(mode: .week, anchorDate: today, calendar: calendar)
        viewport.move(by: 2)

        viewport.goToToday(today)

        XCTAssertEqual(viewport.visibleDates, (20...26).map { try! date(2026, 9, $0) })
        XCTAssertEqual(viewport.selectedDate, today)
    }

    func testWeekPagesMoveSevenDaysOnDemand() throws {
        let today = try date(2026, 9, 20)
        var viewport = ScheduleViewport(mode: .week, anchorDate: today, calendar: calendar)

        viewport.move(by: 1)

        XCTAssertEqual(viewport.visibleDates.first, try date(2026, 9, 27))
        XCTAssertEqual(viewport.visibleDates.last, try date(2026, 10, 3))
    }

    func testMonthPageIncludesCompleteCalendarWeeks() throws {
        let today = try date(2026, 9, 20)
        let viewport = ScheduleViewport(mode: .month, anchorDate: today, calendar: calendar)

        XCTAssertEqual(viewport.visibleDates.first, try date(2026, 8, 30))
        XCTAssertEqual(viewport.visibleDates.last, try date(2026, 10, 3))
        XCTAssertEqual(viewport.visibleDates.count, 35)
        XCTAssertEqual(viewport.selectedDate, today)
    }

    func testMonthPagesMoveByCalendarMonthAndKeepASelectedDay() throws {
        let today = try date(2026, 9, 20)
        var viewport = ScheduleViewport(mode: .month, anchorDate: today, calendar: calendar)

        viewport.move(by: 1)
        viewport.select(try date(2026, 10, 12))

        XCTAssertEqual(viewport.monthInterval?.start, try date(2026, 10, 1))
        XCTAssertEqual(viewport.selectedDate, try date(2026, 10, 12))
    }

    func testChangingModeKeepsTheSelectedDateInView() throws {
        let today = try date(2026, 9, 20)
        var viewport = ScheduleViewport(mode: .month, anchorDate: today, calendar: calendar)
        viewport.select(try date(2026, 9, 23))

        viewport.setMode(.week)

        XCTAssertEqual(viewport.visibleDates.first, try date(2026, 9, 23))
        XCTAssertEqual(viewport.visibleDates.last, try date(2026, 9, 29))
    }

    private func date(_ year: Int, _ month: Int, _ day: Int) throws -> Date {
        try XCTUnwrap(calendar.date(from: DateComponents(year: year, month: month, day: day)))
    }
}
