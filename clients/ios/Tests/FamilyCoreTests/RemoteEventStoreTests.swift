import Foundation
import XCTest
@testable import FamilyCore

final class RemoteEventStoreTests: XCTestCase {
    func testListsEventsFromTheRemoteAPI() async throws {
        let event = sampleEvent()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let transport = RecordingHTTPTransport(
            responses: [HTTPResponse(statusCode: 200, body: try encoder.encode([event]))]
        )
        let store: any EventStore = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let events = try await store.events()

        XCTAssertEqual(events, [event])
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.first?.method, .get)
        XCTAssertEqual(requests.first?.url.absoluteString, "https://api.example.com/v1/events")
    }

    func testDecodesReadOnlyImportedCalendarProvenance() async throws {
        let payload = Data("""
        [{
          "id":"00000000-0000-5000-8000-000000000102",
          "title":"Team practice",
          "kidID":null,
          "participantIDs":["kid-1"],
          "startTime":"2026-09-15T18:00:00Z",
          "endTime":"2026-09-15T19:00:00Z",
          "location":"Lincoln Field",
          "driver":null,
          "source":"calendar",
          "status":"confirmed",
          "readOnly":true,
          "provenance":[{
            "sourceID":"00000000-0000-4000-8000-000000000201",
            "sourceName":"TeamSnap",
            "externalUID":"practice@example"
          }]
        }]
        """.utf8)
        let store: any EventStore = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: RecordingHTTPTransport(responses: [HTTPResponse(statusCode: 200, body: payload)])
        )

        let events = try await store.events()
        let event = try XCTUnwrap(events.first)

        XCTAssertEqual(event.source, .calendar)
        XCTAssertTrue(event.isReadOnly)
        XCTAssertEqual(event.provenance.first?.sourceName, "TeamSnap")
        XCTAssertNil(event.alertLeadTime)
    }

    func testReturnsTheLastSuccessfulAccountScopedScheduleWhenOffline() async throws {
        let cacheURL = temporaryCacheURL()
        let event = sampleEvent()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let online = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: RecordingHTTPTransport(
                responses: [HTTPResponse(statusCode: 200, body: try encoder.encode([event]))]
            ),
            cacheURL: cacheURL,
            accountID: { "account-1" }
        )
        let onlineSnapshot = try await online.loadEvents()
        XCTAssertEqual(onlineSnapshot.freshness, .fresh)
        let offline = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: FailingHTTPTransport(),
            cacheURL: cacheURL,
            accountID: { "account-1" }
        )

        let snapshot = try await offline.loadEvents()

        XCTAssertEqual(snapshot.events, [event])
        XCTAssertEqual(snapshot.freshness, .cached)
    }

    func testClearsTheCachedScheduleAtSessionEnd() async throws {
        let cacheURL = temporaryCacheURL()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let online = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: RecordingHTTPTransport(
                responses: [HTTPResponse(statusCode: 200, body: try encoder.encode([sampleEvent()]))]
            ),
            cacheURL: cacheURL,
            accountID: { "account-1" }
        )
        _ = try await online.loadEvents()

        try await online.clearCache()

        XCTAssertFalse(FileManager.default.fileExists(atPath: cacheURL.path))
    }

    func testDoesNotExposeAnotherAccountsCachedSchedule() async throws {
        let cacheURL = temporaryCacheURL()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let online = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: RecordingHTTPTransport(
                responses: [HTTPResponse(statusCode: 200, body: try encoder.encode([sampleEvent()]))]
            ),
            cacheURL: cacheURL,
            accountID: { "account-1" }
        )
        _ = try await online.loadEvents()
        let otherAccount = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: FailingHTTPTransport(),
            cacheURL: cacheURL,
            accountID: { "account-2" }
        )

        do {
            _ = try await otherAccount.loadEvents()
            XCTFail("Expected the offline load to reject another account's cache")
        } catch {
            XCTAssertTrue(error is TestTransportError)
        }
    }

    func testSavesAnEventWithoutRequestingAnImmediateUpdateNotification() async throws {
        let transport = RecordingHTTPTransport(
            responses: [HTTPResponse(statusCode: 200, body: Data("{\"conflicts\":[]}".utf8))]
        )
        let store: any EventStore = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        _ = try await store.save(sampleEvent(), notifyParticipants: false)

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(
            URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems,
            [URLQueryItem(name: "notifyParticipants", value: "false")]
        )
        XCTAssertEqual(request.timeoutInterval, 60)
    }

    func testSavesAnEventThroughTheRemoteAPI() async throws {
        let transport = RecordingHTTPTransport(
            responses: [HTTPResponse(statusCode: 200, body: Data("{\"conflicts\":[]}".utf8))]
        )
        let store: any EventStore = RemoteEventStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let conflicts = try await store.save(sampleEvent())

        XCTAssertEqual(conflicts, [])
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.first?.method, .put)
        XCTAssertTrue(requests.first?.url.path.hasPrefix("/v1/events/") == true)
        let body = try XCTUnwrap(requests.first?.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["participantIDs"] as? [String], ["parent-1"])
        XCTAssertEqual(json["alertLeadTimeMinutes"] as? Int, 0)
    }

    private func temporaryCacheURL() -> URL {
        FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appending(path: "events-cache.json")
    }

    private func sampleEvent() -> FamilyEvent {
        FamilyEvent(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000101")!,
            title: "Family dinner",
            kidID: nil,
            participantIDs: [KidID(rawValue: "parent-1")],
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )
    }
}

private struct TestTransportError: Error {}

private actor FailingHTTPTransport: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw TestTransportError()
    }
}

private actor RecordingHTTPTransport: HTTPTransport {
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
