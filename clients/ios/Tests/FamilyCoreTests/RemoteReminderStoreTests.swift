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
