import XCTest
@testable import FamilyCore

@available(iOS 18.2, macOS 15.2, *)
final class VoiceEventRecurrenceTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Pacific/Kiritimati")!
        return calendar
    }

    private var start: Date {
        calendar.date(from: DateComponents(year: 2027, month: 1, day: 4, hour: 1))!
    }

    func testRejectsExplicitMonthDaysRatherThanSilentlyChangingSchedule() {
        for frequency in [Calendar.RecurrenceRule.Frequency.daily, .weekly, .monthly] {
            let rule = Calendar.RecurrenceRule(
                calendar: calendar,
                frequency: frequency,
                end: .afterOccurrences(3),
                daysOfTheMonth: [4, 18]
            )
            XCTAssertThrowsError(try VoiceEventRecurrence.convert(rule, startDate: start))
        }
    }

    func testPreservesRuleTimeZoneAndImplicitWeeklyDay() throws {
        let rule = Calendar.RecurrenceRule(
            calendar: calendar, frequency: .weekly, end: .afterOccurrences(3)
        )
        let converted = try XCTUnwrap(VoiceEventRecurrence.convert(rule, startDate: start))
        XCTAssertEqual(converted.weekdays, [.monday])
        XCTAssertEqual(converted.timeZone, calendar.timeZone.identifier)
    }

    func testPreservesSupportedFrequencyIntervalAndOccurrenceCount() throws {
        for (frequency, expected) in [
            (Calendar.RecurrenceRule.Frequency.daily, EventRecurrence.Frequency.daily),
            (.weekly, .weekly),
            (.monthly, .monthly),
        ] {
            let rule = Calendar.RecurrenceRule(
                calendar: calendar, frequency: frequency, interval: 2, end: .afterOccurrences(3)
            )
            let converted = try XCTUnwrap(VoiceEventRecurrence.convert(rule, startDate: start))
            XCTAssertEqual(converted.frequency, expected)
            XCTAssertEqual(converted.interval, 2)
            XCTAssertEqual(converted.endDate, Array(rule.recurrences(of: start)).last)
        }
    }

    func testPreservesExplicitWeeklyDaysAndEndDate() throws {
        let end = calendar.date(byAdding: .month, value: 1, to: start)!
        let rule = Calendar.RecurrenceRule(
            calendar: calendar,
            frequency: .weekly,
            end: .afterDate(end),
            weekdays: [.every(.monday), .every(.wednesday)]
        )
        let converted = try XCTUnwrap(VoiceEventRecurrence.convert(rule, startDate: start))
        XCTAssertEqual(converted.weekdays, [.monday, .wednesday])
        XCTAssertEqual(converted.endDate, end)
    }

    func testRejectsUnsupportedFrequencyAndOrdinalWeekday() {
        let yearly = Calendar.RecurrenceRule(calendar: calendar, frequency: .yearly)
        XCTAssertThrowsError(try VoiceEventRecurrence.convert(yearly, startDate: start))
        let ordinal = Calendar.RecurrenceRule(
            calendar: calendar, frequency: .monthly, weekdays: [.nth(1, .monday)]
        )
        XCTAssertThrowsError(try VoiceEventRecurrence.convert(ordinal, startDate: start))
    }

    func testNoRepeatRuleRemainsNonRecurring() throws {
        XCTAssertNil(try VoiceEventRecurrence.convert(nil, startDate: start))
    }
}
