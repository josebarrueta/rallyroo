import FamilyCore
import XCTest

final class ReminderOccurrenceExpanderTests: XCTestCase {
    private func fixedCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return calendar
       }

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 9) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.timeZone = TimeZone(identifier: "America/Los_Angeles")
        return fixedCalendar().date(from: components)!
       }

     // Sep 7, 2026 is a Monday.

    func testOneTimeReminderReturnsSingleOccurrence() throws {
        let reminder = FamilyReminder(
            title: "Feed the dog",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 18)
          )
        let range = DateInterval(start: date(2026, 9, 1, 0), end: date(2026, 9, 30, 0))
        let occurrences = ReminderOccurrenceExpander.occurrences(of: [reminder], in: range, calendar: fixedCalendar())
        XCTAssertEqual(occurrences.count, 1)
        XCTAssertEqual(occurrences[0].occurrenceDueAt, date(2026, 9, 7, 18))
        XCTAssertNil(occurrences[0].reminder.recurrence)
       }

    func testOneTimeReminderOutsideRangeReturnsEmpty() throws {
        let reminder = FamilyReminder(
            title: "Feed the dog",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 10, 1, 18)
          )
        let range = DateInterval(start: date(2026, 9, 1, 0), end: date(2026, 9, 30, 0))
        let occurrences = ReminderOccurrenceExpander.occurrences(of: [reminder], in: range, calendar: fixedCalendar())
        XCTAssertTrue(occurrences.isEmpty)
       }

    func testWeeklyReminderExpandsToSelectedWeekdays() throws {
        let series = FamilyReminder(
            title: "Pack sports bag",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 18),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday, .wednesday],
            recurrenceEndDate: date(2026, 9, 30, 23)
          )
        let range = DateInterval(start: date(2026, 9, 7, 0), end: date(2026, 9, 20, 0))
        let occurrences = ReminderOccurrenceExpander.occurrences(of: [series], in: range, calendar: fixedCalendar())

          // Week 1: Sep 7 (Mon), Sep 9 (Wed); Week 2: Sep 14 (Mon), Sep 16 (Wed)
        XCTAssertEqual(occurrences.count, 4, "Two weeks of Mon+Wed should produce 4 occurrences")
        XCTAssertTrue(occurrences.allSatisfy { $0.reminder.title == "Pack sports bag" })
        XCTAssertNil(occurrences.first?.reminder.recurrence,
             "expanded occurrences must not carry recurrence config")
        XCTAssertTrue(Set(occurrences.map { $0.id }).count == occurrences.count, "IDs must be unique")
        XCTAssertTrue(occurrences.allSatisfy { $0.reminder.recurrenceSeriesID == series.id })
       }

    func testBiweeklyReminderSkipsAlternateWeeks() throws {
        let series = FamilyReminder(
            title: "Trash day",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 18),
            recurrenceFrequency: .biweekly,
            recurrenceInterval: 1,
            recurrenceWeekdays: [.monday],
            recurrenceEndDate: date(2026, 10, 15, 23)
          )
        let range = DateInterval(start: date(2026, 9, 1, 0), end: date(2026, 10, 15, 0))
        let occurrences = ReminderOccurrenceExpander.occurrences(of: [series], in: range, calendar: fixedCalendar())

          // Biweekly means Sep 7, Sep 21, Oct 5
        XCTAssertEqual(occurrences.count, 3, "Biweekly Monday Sep 7 through Oct 15 should produce 3")
        for occ in occurrences {
            let weekday = fixedCalendar().component(.weekday, from: occ.occurrenceDueAt)
            XCTAssertEqual(weekday, 2, "All biweekly occurrences must be Mondays")
           }
       }

    func testEndDateIsRespected() throws {
        let series = FamilyReminder(
            title: "Homework",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 18),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday, .wednesday, .friday],
            recurrenceEndDate: date(2026, 9, 15, 23)
          )
        let range = DateInterval(start: date(2026, 9, 1, 0), end: date(2026, 10, 1, 0))
        let occurrences = ReminderOccurrenceExpander.occurrences(of: [series], in: range, calendar: fixedCalendar())

         // Latest occurrence must be <= endDate
        let latest = occurrences.last!.occurrenceDueAt
        XCTAssertLessThanOrEqual(latest, date(2026, 9, 15, 23), "No occurrence past endDate")
       }

    func testMultipleSeriesProduceIndependentOccurrences() throws {
        let series1 = FamilyReminder(
            title: "Dog walk",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 18),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday],
            recurrenceEndDate: date(2026, 9, 14, 23)
          )
        let series2 = FamilyReminder(
            title: "Feed cat",
            assigneeIDs: [KidID(rawValue: "kid-2")],
            dueAt: date(2026, 9, 7, 8),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday],
            recurrenceEndDate: date(2026, 9, 14, 23)
          )

        let range = DateInterval(start: date(2026, 9, 1, 0), end: date(2026, 9, 30, 0))
        let occurrences = ReminderOccurrenceExpander.occurrences(of: [series1, series2], in: range, calendar: fixedCalendar())

        let s1 = occurrences.filter { $0.sourceReminder.id == series1.id }
        let s2 = occurrences.filter { $0.sourceReminder.id == series2.id }
        XCTAssertFalse(s1.isEmpty)
        XCTAssertFalse(s2.isEmpty)
       }

    func testOccurrencesAreDeterministic() throws {
        let series = FamilyReminder(
            title: "Water plants",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 18),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday, .wednesday],
            recurrenceEndDate: date(2026, 9, 30, 23)
          )
        let range = DateInterval(start: date(2026, 9, 7, 0), end: date(2026, 9, 15, 0))
        let first = ReminderOccurrenceExpander.occurrences(of: [series], in: range, calendar: fixedCalendar())
        let second = ReminderOccurrenceExpander.occurrences(of: [series], in: range, calendar: fixedCalendar())
        XCTAssertEqual(first.map(\ .id), second.map(\ .id))
        XCTAssertEqual(first, second)
       }

    func testDeletedSeriesRemovesRelatedOccurrences() async throws {
        let url = FileManager.default
            .temporaryDirectory
            .appendingPathComponent(UUID().uuidString + ".json")
        defer { try? FileManager.default.removeItem(at: url) }

        let store = LocalReminderStore(storageURL: url)
        let series = FamilyReminder(
            title: "Bins out",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 18),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday],
            recurrenceEndDate: date(2026, 9, 21, 23)
          )

        try await store.save(series)
        let range = DateInterval(start: date(2026, 9, 1, 0), end: date(2026, 10, 1, 0))
        let before = try await store.occurrences([series], in: range)
        XCTAssertFalse(before.isEmpty)

        try await store.delete(series)
        let after = try await store.reminders()
        XCTAssert(after.isEmpty, "Deleting a series must remove all related rows")
       }

    func testCompletionOfOneOccurrenceDoesNotAffectSeriesTemplate() async throws {
        let url = FileManager.default
            .temporaryDirectory
            .appendingPathComponent(UUID().uuidString + ".json")
        defer { try? FileManager.default.removeItem(at: url) }

        let store = LocalReminderStore(storageURL: url)
        let series = FamilyReminder(
            title: "Water plants",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: date(2026, 9, 7, 10),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday],
            recurrenceEndDate: date(2026, 9, 14, 23)
          )
        try await store.save(series)

        // Expand the first occurrence and complete it
        let range = DateInterval(start: date(2026, 9, 1, 0), end: date(2026, 9, 15, 0))
        let occurrences = try await store.occurrences([series], in: range)
        XCTAssertFalse(occurrences.isEmpty)
        let first = occurrences[0]

         // Complete the first occurrence
        try await store.complete(first, by: KidID(rawValue: "kid-1"))
        let saved = try await store.reminders()
        // The series template is still stored
        XCTAssertFalse(saved.isEmpty)
         // Find the completed one
        let completed = saved.first { $0.id == first.id }
        XCTAssertEqual(completed?.status, .completed)
       }
}
