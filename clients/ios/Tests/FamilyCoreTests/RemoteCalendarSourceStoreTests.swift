import Foundation
import XCTest
@testable import FamilyCore

final class RemoteCalendarSourceStoreTests: XCTestCase {
    func testConnectsAndImportsAFamilySharedCalendar() async throws {
        let response = Data("""
        {
          "id":"00000000-0000-4000-8000-000000000301",
          "ownerMemberID":"parent-1",
          "visibility":"family",
          "name":"Emma TeamSnap",
          "participantIDs":["kid-1"],
          "status":"ready",
          "lastSyncedAt":null,
          "lastError":null
        }
        """.utf8)
        let transport = CalendarRecordingTransport(
            responses: [HTTPResponse(statusCode: 201, body: response)]
        )
        let store: any CalendarSourceStore = RemoteCalendarSourceStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let source = try await store.connect(
            name: "Emma TeamSnap",
            url: URL(string: "https://ical.example/secret.ics")!,
            participantIDs: [KidID(rawValue: "kid-1")],
            visibility: .family
        )

        XCTAssertEqual(source.name, "Emma TeamSnap")
        XCTAssertEqual(source.ownerMemberID, "parent-1")
        XCTAssertEqual(source.visibility, .family)
        XCTAssertEqual(source.status, .ready)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/v1/calendar-sources")
        let body = try XCTUnwrap(request.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["url"] as? String, "https://ical.example/secret.ics")
        XCTAssertEqual(json["participantIDs"] as? [String], ["kid-1"])
        XCTAssertEqual(json["visibility"] as? String, "family")
    }

    func testRenamesCalendarAndUpdatesVisibility() async throws {
        let sourceResponse = Data("""
        [{
          "id":"00000000-0000-4000-8000-000000000301",
          "ownerMemberID":"parent-1",
          "visibility":"family",
          "name":"Work",
          "participantIDs":["parent-1"],
          "status":"ready",
          "lastSyncedAt":null,
          "lastError":null
        }]
        """.utf8)
        let updatedResponse = Data("""
        {
          "id":"00000000-0000-4000-8000-000000000301",
          "ownerMemberID":"parent-1",
          "visibility":"personal",
          "name":"Corrected Work",
          "participantIDs":["parent-1"],
          "status":"ready",
          "lastSyncedAt":null,
          "lastError":null
        }
        """.utf8)
        let transport = CalendarRecordingTransport(responses: [
            HTTPResponse(statusCode: 200, body: sourceResponse),
            HTTPResponse(statusCode: 200, body: updatedResponse)
        ])
        let store: any CalendarSourceStore = RemoteCalendarSourceStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )
        let sources = try await store.sources()
        let source = try XCTUnwrap(sources.first)

        let updated = try await store.update(
            source,
            name: "Corrected Work",
            visibility: .personal
        )

        XCTAssertEqual(updated.name, "Corrected Work")
        XCTAssertEqual(updated.visibility, .personal)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.last)
        XCTAssertEqual(request.method, .patch)
        XCTAssertEqual(request.url.path, "/v1/calendar-sources/00000000-0000-4000-8000-000000000301")
        let body = try XCTUnwrap(request.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["name"] as? String, "Corrected Work")
        XCTAssertEqual(json["visibility"] as? String, "personal")
    }
}

private actor CalendarRecordingTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []

    init(responses: [HTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.removeFirst()
    }

    func recordedRequests() -> [HTTPRequest] {
        requests
    }
}
