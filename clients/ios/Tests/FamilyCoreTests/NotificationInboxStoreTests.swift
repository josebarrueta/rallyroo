import Foundation
import XCTest
@testable import FamilyCore

final class NotificationInboxStoreTests: XCTestCase {
    func testRemoteStoreListsAndMarksMemberNotificationRead() async throws {
        let id = UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABC120")!
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let body = try encoder.encode([InboxNotification(
            id: id,
            kind: .driverAssignment,
            title: "Driver assigned",
            body: "You are driving.",
            destination: InboxNotificationDestination(kind: .event, id: "event-1"),
            occurredAt: Date(timeIntervalSince1970: 1_915_291_200),
            readAt: nil
        )])
        let transport = NotificationHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: body), HTTPResponse(statusCode: 204),
        ])
        let store: any NotificationInboxStore = RemoteNotificationInboxStore(
            baseURL: URL(string: "https://api.example.com")!, transport: transport
        )

        let notifications = try await store.notifications()
        XCTAssertEqual(notifications.first?.kind, .driverAssignment)
        try await store.markRead(id: id)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .patch])
        XCTAssertEqual(requests.last?.url.path, "/v1/notifications/\(id.uuidString)/read")
    }
}

private actor NotificationHTTPTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []
    init(responses: [HTTPResponse]) { self.responses = responses }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request); return responses.removeFirst()
    }
    func recordedRequests() -> [HTTPRequest] { requests }
}
