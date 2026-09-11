import Foundation
import XCTest
@testable import FamilyCore

final class RemoteReminderStoreTests: XCTestCase {
    func testUsesTheReminderLifecycleAPI() async throws {
        let reminder = FamilyReminder(
            id: UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC101")!,
            title: "Bring the permission slip",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: Date(timeIntervalSince1970: 1_800_000_000),
            alertLeadTime: .atDueTime
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let transport = ReminderHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: try encoder.encode(reminder)),
            HTTPResponse(statusCode: 200, body: try encoder.encode([reminder])),
            HTTPResponse(statusCode: 200, body: try encoder.encode(reminder)),
            HTTPResponse(statusCode: 200, body: try encoder.encode(reminder)),
            HTTPResponse(statusCode: 204),
        ])
        let store: any ReminderStore = RemoteReminderStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        try await store.save(reminder)
        _ = try await store.reminders()
        try await store.complete(reminder, by: KidID(rawValue: "kid-1"))
        try await store.reopen(reminder)
        try await store.delete(reminder)

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.put, .get, .post, .post, .delete])
        XCTAssertEqual(requests.map(\.url.path), [
            "/v1/reminders/ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC101",
            "/v1/reminders",
            "/v1/reminders/ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC101/complete",
            "/v1/reminders/ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC101/reopen",
            "/v1/reminders/ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC101",
        ])
        let savedBody = try XCTUnwrap(requests.first?.body)
        let savedJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: savedBody) as? [String: Any])
        XCTAssertEqual(savedJSON["alertLeadTimeMinutes"] as? Int, 0)
      }

    func testSavesAndListsRecurringSeriesTemplate() async throws {
        let reminder = FamilyReminder(
            id: UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC201")!,
            title: "Pack sports bag",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: Date(timeIntervalSince1970: 1_800_000_000),
            alertLeadTime: .oneHour,
            recurrenceFrequency: .weekly,
            recurrenceInterval: 1,
            recurrenceWeekdays: [.monday, .wednesday],
            recurrenceEndDate: Date(timeIntervalSince1970: 1_820_000_000)
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let transport = ReminderHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: try encoder.encode(reminder)),
            HTTPResponse(statusCode: 200, body: try encoder.encode([reminder])),
        ])
        let store: any ReminderStore = RemoteReminderStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        try await store.save(reminder)
        let results = try await store.reminders()

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].recurrenceFrequency, .weekly)
        XCTAssertEqual(results[0].recurrenceWeekdays, [ReminderRecurrence.Weekday.monday, .wednesday])
        XCTAssertNotNil(results[0].recurrenceEndDate)
        XCTAssertTrue(results[0].hasRecurrence)

        let requests = await transport.recordedRequests()
        let savedBody = try XCTUnwrap(requests.first?.body)
        let savedJSON = try XCTUnwrap(JSONSerialization.jsonObject(with: savedBody) as? [String: Any])
        XCTAssertEqual(savedJSON["recurrenceFrequency"] as? String, "weekly")
      }

    func testOccurrencesExpandsSeriesLocally() async throws {
        let series = FamilyReminder(
            id: UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC202")!,
            title: "Water plants",
            assigneeIDs: [KidID(rawValue: "kid-1")],
            dueAt: Date(timeIntervalSince1970: 1_800_000_000),
            recurrenceFrequency: .weekly,
            recurrenceWeekdays: [.monday],
            recurrenceEndDate: Date(timeIntervalSince1970: 1_809_628_800)
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let transport = ReminderHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: try encoder.encode([series])),
        ])
        let store: any ReminderStore = RemoteReminderStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

         // Fetch the series
        let allReminders = try await store.reminders()
        XCTAssertEqual(allReminders.count, 1)
        XCTAssertTrue(allReminders[0].hasRecurrence)

         // Expand occurrences within a one-week range
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let weekRange = DateInterval(
            start: allReminders[0].dueAt.addingTimeInterval(-1000),
            end: allReminders[0].dueAt.addingTimeInterval(7*24*3600)
        )
        let expanded = try await store.occurrences(allReminders, in: weekRange)
        XCTAssertFalse(expanded.isEmpty, "Should produce at least one occurrence in range")
         // All expanded occurrences must have recurrence == nil (concrete)
        XCTAssertTrue(expanded.allSatisfy { !$0.hasRecurrence }, "Expanded occurrences must be concrete")
        XCTAssertTrue(expanded.allSatisfy { $0.recurrenceSeriesID == series.id },
             "All occurrences must belong to the same series")
      }
}

private actor ReminderHTTPTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []

    init(responses: [HTTPResponse]) {
        self.responses = responses
      }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.removeFirst()
      }

    func recordedRequests() -> [HTTPRequest] { requests }
}
