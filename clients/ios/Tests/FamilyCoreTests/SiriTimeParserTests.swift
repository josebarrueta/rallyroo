import XCTest
@testable import FamilyCore

final class SiriTimeParserTests: XCTestCase {

        // MARK: - parseDay

    func testTodayReturnsTodayStart() {
        guard let parsed = SiriTimeParser.parseDay(from: "today") else {
            XCTFail("today should parse")
            return
          }
        XCTAssertEqual(parsed, Calendar.current.startOfDay(for: .now))
         }

    func testTomorrowReturnsTomorrowStart() {
        guard let parsed = SiriTimeParser.parseDay(from: "tomorrow") else {
            XCTFail("tomorrow should parse")
            return
         }
        let expected = Calendar.current.date(
               byAdding: .day, value: 1,
            to: Calendar.current.startOfDay(for: .now))
        XCTAssertEqual(parsed, expected)
          }

    func testNamedWeekdaysReturnDates() {
        for day in [
                "monday", "tuesday", "wednesday", "thursday",
                 "friday", "saturday", "sunday"
                 ] {
            XCTAssertNotNil(SiriTimeParser.parseDay(from: day),
                   "\(day) should parse")
             }
         }

    func testUnrecognizedDaysReturnNil() {
        XCTAssertNil(SiriTimeParser.parseDay(from: "noon"))
        XCTAssertNil(SiriTimeParser.parseDay(from: "12345"))
        XCTAssertNil(SiriTimeParser.parseDay(from: ""))
          }

        // MARK: - parseHour

    func testParses12HourFormat() {
         XCTAssertEqual(SiriTimeParser.parseHour(from: "5pm"), 17)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "5 pm"), 17)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "5am"), 5)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "12am"), 0)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "12pm"), 12)
          }

    func testParsesNamedPeriods() {
         XCTAssertEqual(SiriTimeParser.parseHour(from: "morning"), 9)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "noon"), 12)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "midday"), 12)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "afternoon"), 15)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "evening"), 19)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "night"), 22)
           }

    func testParses24HourFormat() {
         XCTAssertEqual(SiriTimeParser.parseHour(from: "18"), 18)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "6"), 6)
         XCTAssertEqual(SiriTimeParser.parseHour(from: "0"), 0)
            }

    func testInvalidInputReturnsNil() {
         XCTAssertNil(SiriTimeParser.parseHour(from: "banana"))
         XCTAssertNil(SiriTimeParser.parseHour(from: ""))
          }
}
