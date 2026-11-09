import XCTest
@testable import FamilyCore

final class CalendarConnectionStoreTests: XCTestCase {
    func testListsCreatesAndRevokesWithoutPersistingOneTimePassword() async throws {
        let id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        let created = "2027-01-01T12:00:00.000Z"
        let transport = CalendarAccountTransport(responses: [
            HTTPResponse(statusCode: 200, body: Data("{\"serverURL\":\"https://calendar.example/dav/\",\"connections\":[{\"id\":\"\(id)\",\"username\":\"\(id)\",\"createdAt\":\"\(created)\"}]}".utf8)),
            HTTPResponse(statusCode: 201, body: Data("{\"serverURL\":\"https://calendar.example/dav/\",\"id\":\"\(id)\",\"username\":\"\(id)\",\"createdAt\":\"\(created)\",\"password\":\"synthetic-one-time-password\"}".utf8)),
            HTTPResponse(statusCode: 204),
        ])
        let store = RemoteCalendarConnectionStore(baseURL: URL(string: "https://api.example")!, transport: transport,
            calendarTimeZone: TimeZone(identifier: "America/Los_Angeles")!)
        let listing = try await store.connections()
        XCTAssertEqual(listing.connections.first?.id, UUID(uuidString: id))
        let credentials = try await store.create()
        XCTAssertEqual(credentials.password, "synthetic-one-time-password")
        try await store.revoke(id: credentials.id)
        let requests = await transport.recorded()
        XCTAssertEqual(requests.map(\.method), [.get, .post, .delete])
        XCTAssertEqual(requests.last?.url.path, "/v1/calendar-connections/\(id)")
        XCTAssertNil(requests[0].body)
        XCTAssertNil(requests[2].body)
        let body = try XCTUnwrap(requests[1].body)
        XCTAssertEqual(try JSONDecoder().decode([String: String].self, from: body), ["timeZone": "America/Los_Angeles"])
        XCTAssertFalse(String(decoding: body, as: UTF8.self).contains("synthetic-one-time-password"))
    }

    func testDisabledOrUnenrolledPreviewIsUnavailableForListingAndCreation() async {
        for status in [403, 404] {
            let store = RemoteCalendarConnectionStore(baseURL: URL(string: "https://api.example")!,
                transport: CalendarAccountTransport(responses: [HTTPResponse(statusCode: status), HTTPResponse(statusCode: status)]))
            do {
                _ = try await store.connections()
                XCTFail("Expected unavailable preview")
            } catch { XCTAssertEqual(error as? CalendarConnectionError, .unavailable) }
            do {
                _ = try await store.create()
                XCTFail("Expected unavailable preview")
            } catch { XCTAssertEqual(error as? CalendarConnectionError, .unavailable) }
        }
    }
}

private actor CalendarAccountTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []
    init(responses: [HTTPResponse]) { self.responses = responses }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.removeFirst()
    }
    func recorded() -> [HTTPRequest] { requests }
}
