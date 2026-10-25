import Foundation
import XCTest
@testable import FamilyCore

final class NotificationInboxPageTests: XCTestCase {
    private func item() -> InboxNotification {
        InboxNotification(id: UUID(), kind: .scheduleUpdate, title: "Update", body: "Review",
                          destination: .init(kind: .event, id: "event"), occurredAt: Date(timeIntervalSince1970: 100), readAt: nil)
    }
    private func response(_ items: [InboxNotification], cursor: String? = nil) throws -> HTTPResponse {
        struct Payload: Encodable { let items: [InboxNotification]; let nextCursor: String? }
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return HTTPResponse(statusCode: 200, body: try encoder.encode(Payload(items: items, nextCursor: cursor)))
    }

    func testRemotePageReportsLiveAndCachedFreshnessWithoutInventingANewRefreshTime() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = PageTransport([try response([item()], cursor: "opaque-cursor")])
        let cache = directory.appendingPathComponent("inbox")
        let store = RemoteNotificationInboxStore(baseURL: URL(string: "https://example.com")!, transport: transport,
                                                cacheURL: cache, accountID: { "one" })
        let live = try await store.page(filter: .unread)
        XCTAssertEqual(live.freshness, .live)
        XCTAssertEqual(live.nextCursor, "opaque-cursor")
        let cached = try await store.page(filter: .unread)
        XCTAssertEqual(cached.freshness, .cached)
        XCTAssertNil(cached.nextCursor) // Cached first page is not the full inbox.
        XCTAssertEqual(cached.items, live.items)
        XCTAssertEqual(cached.refreshedAt!.timeIntervalSince1970, live.refreshedAt!.timeIntervalSince1970, accuracy: 1)
        let requests = await transport.requests
        XCTAssertEqual(requests[0].url.path, "/v1/notifications/page")
        XCTAssertEqual(URLComponents(url: requests[0].url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "unread")
        let other = RemoteNotificationInboxStore(baseURL: URL(string: "https://example.com")!, transport: PageTransport([]),
                                                cacheURL: cache, accountID: { "two" })
        do { _ = try await other.page(filter: .unread); XCTFail("Other account must not see the page") } catch {}
        do { _ = try await store.page(filter: .all); XCTFail("Filters must not reuse each other's cache") } catch {}
        do { _ = try await store.page(filter: .unread, cursor: "opaque-cursor"); XCTFail("Failed load-more must not return page one") } catch {}
    }

    func testUnauthorizedPageDoesNotUseCacheAndSuccessfulDeletionInvalidatesIt() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport = PageTransport([try response([item()]), HTTPResponse(statusCode: 401), HTTPResponse(statusCode: 204)])
        let store = RemoteNotificationInboxStore(baseURL: URL(string: "https://example.com")!, transport: transport,
                                                cacheURL: directory.appendingPathComponent("inbox"), accountID: { "one" })
        _ = try await store.page(filter: .all)
        do { _ = try await store.page(filter: .all); XCTFail("401 must not be disguised as offline") } catch {}
        try await store.deleteAll()
        do { _ = try await store.page(filter: .all); XCTFail("Deleted records must not reappear offline") } catch {}
    }

    func testDefaultStorePagesAndFiltersMoreThanAHundredRecords() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalNotificationInboxStore(storageURL: directory.appendingPathComponent("inbox"))
        for _ in 0..<121 { try await store.ingest(item()) }
        let first = try await store.page(filter: .all)
        let second = try await store.page(filter: .all, cursor: first.nextCursor)
        let third = try await store.page(filter: .all, cursor: second.nextCursor)
        XCTAssertEqual(Set((first.items + second.items + third.items).map(\.id)).count, 121)
        XCTAssertNil(third.nextCursor)
        try await store.markAllRead()
        let unread = try await store.page(filter: .unread)
        XCTAssertEqual(unread.items, [])
    }
}

private actor PageTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private(set) var requests: [HTTPRequest] = []
    init(_ responses: [HTTPResponse]) { self.responses = responses }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw URLError(.notConnectedToInternet) }
        return responses.removeFirst()
    }
}
