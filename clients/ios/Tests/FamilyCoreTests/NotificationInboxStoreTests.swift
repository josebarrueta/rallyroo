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

    func testOfflineCacheIsScopedToTheSignedInAccount() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let cacheURL = directory.appendingPathComponent("inbox.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let record = InboxNotification(
            id: UUID(), kind: .scheduleUpdate, title: "Updated", body: "Review it.",
            destination: .init(kind: .event, id: "event-1"),
            occurredAt: Date(timeIntervalSince1970: 1_915_291_200), readAt: nil
        )
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let online = RemoteNotificationInboxStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: NotificationHTTPTransport(responses: [HTTPResponse(statusCode: 200, body: try encoder.encode([record]))]),
            cacheURL: cacheURL, accountID: { "member-1" }
        )
        _ = try await online.notifications()
        let offline = RemoteNotificationInboxStore(
            baseURL: URL(string: "https://api.example.com")!, transport: FailingNotificationHTTPTransport(),
            cacheURL: cacheURL, accountID: { "member-1" }
        )
        let cachedRecords = try await offline.notifications()
        XCTAssertEqual(cachedRecords, [record])
        let otherAccount = RemoteNotificationInboxStore(
            baseURL: URL(string: "https://api.example.com")!, transport: FailingNotificationHTTPTransport(),
            cacheURL: cacheURL, accountID: { "member-2" }
        )
        do {
            _ = try await otherAccount.notifications()
            XCTFail("another account must not read the cached inbox")
        } catch {}
    }
}

private struct FailingNotificationHTTPTransport: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse { throw URLError(.notConnectedToInternet) }
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
