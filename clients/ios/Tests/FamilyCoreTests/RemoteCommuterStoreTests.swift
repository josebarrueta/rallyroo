import Foundation
import XCTest
@testable import FamilyCore

final class RemoteCommuterStoreTests: XCTestCase {
    func testLoadsPrivacyFilteredCommuterState() async throws {
        let response = Data("""
        {
          "installation":{"enabledByMemberID":"parent-1","status":"enabled"},
          "subscriptions":[{
            "id":"00000000-0000-4000-8000-000000000401",
            "ownerMemberID":"parent-1",
            "visibility":"personal",
            "agencyID":"CT",
            "routeID":"caltrain-local",
            "directionID":"northbound",
            "originStopID":"70171",
            "destinationStopID":"70011",
            "serviceWeekdays":[1,2,3,4,5],
            "windowStartMinutes":420,
            "windowEndMinutes":540,
            "alertKinds":["delay","cancellation"],
            "minimumDelayMinutes":15,
            "status":"active"
          }],
          "providerStatus":{
            "catalog":{"state":"healthy","lastSuccessAt":"2026-09-09T15:00:00Z","lastAttemptAt":"2026-09-09T15:00:00Z"},
            "realtime":{"state":"degraded","lastSuccessAt":"2026-09-09T15:00:00Z","lastAttemptAt":"2026-09-09T15:01:00Z"}
          }
        }
        """.utf8)
        let catalogResponse = Data("""
        {
          "status":{"state":"healthy","lastSuccessAt":"2026-09-09T15:00:00Z","lastAttemptAt":"2026-09-09T15:00:00Z"},
          "observedAt":"2026-09-09T14:59:00Z",
          "stops":[{
            "id":"70171","stationID":"palo_alto","stationName":"Palo Alto",
            "direction":"northbound","latitude":37.443,"longitude":-122.1649,
            "validFrom":"2026-01-31T08:00:00Z","validUntil":"2027-02-01T07:59:00Z"
          }]
        }
        """.utf8)
        let transport = CommuterRecordingTransport(responses: [
            HTTPResponse(statusCode: 200, body: response),
            HTTPResponse(statusCode: 200, body: catalogResponse)
        ])
        let store: any CommuterStore = RemoteCommuterStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let state = try await store.state()

        XCTAssertEqual(state.installation?.enabledByMemberID, "parent-1")
        XCTAssertEqual(state.subscriptions.first?.originStopID, "70171")
        XCTAssertEqual(state.providerStatus.catalog.state, .healthy)
        XCTAssertEqual(state.providerStatus.realtime.state, .degraded)
        let catalog = try await store.catalog()
        XCTAssertEqual(catalog.stops.first?.stationName, "Palo Alto")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get, .get])
        XCTAssertEqual(requests.map(\.url.path), [
            "/v1/modules/commuter",
            "/v1/modules/commuter/catalog"
        ])
    }

    func testSearchesScheduledJourneysWithoutPuttingCommuteDataInTheURL() async throws {
        let response = Data("""
        {
          "scheduleVersion":"v1",
          "observedAt":"2026-09-10T00:00:00Z",
          "validUntil":"2026-12-31",
          "status":{"state":"healthy","lastSuccessAt":"2026-09-10T00:00:00Z","lastAttemptAt":"2026-09-10T00:00:00Z"},
          "options":[{
            "id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "directionID":"northbound",
            "originStopID":"70171",
            "destinationStopID":"70011",
            "departureMinutes":451,
            "arrivalMinutes":484,
            "operatingWeekdays":[1,2,3,4,5]
          }]
        }
        """.utf8)
        let transport = CommuterRecordingTransport(responses: [
            HTTPResponse(statusCode: 200, body: response)
        ])
        let store = RemoteCommuterStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let result = try await store.searchJourneys(CaltrainJourneySearch(
            originStationID: "palo_alto",
            destinationStationID: "san_francisco",
            serviceWeekdays: [1, 4, 5]
        ))

        XCTAssertEqual(result.options.first?.departureMinutes, 451)
        XCTAssertEqual(result.options.first?.arrivalMinutes, 484)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/v1/modules/commuter/journeys/search")
        XCTAssertNil(request.url.query)
        let body = try XCTUnwrap(request.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["serviceWeekdays"] as? [Int], [1, 4, 5])
    }

    func testUpdatesACommuterSubscriptionWithAFullPutPayload() async throws {
        let response = Data("""
        {
          "id":"00000000-0000-4000-8000-000000000401",
          "ownerMemberID":"parent-1","visibility":"personal","agencyID":"CT",
          "routeID":"*","directionID":"northbound","originStopID":"70171",
          "destinationStopID":"70011","serviceWeekdays":[1,4,5],
          "windowStartMinutes":451,"windowEndMinutes":452,
          "alertKinds":["cancellation"],"minimumDelayMinutes":30,"status":"paused",
          "scheduleOptionID":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "scheduledDepartureMinutes":451,"scheduledArrivalMinutes":484,"scheduleVersion":"v1"
        }
        """.utf8)
        let transport = CommuterRecordingTransport(responses: [HTTPResponse(statusCode: 200, body: response)])
        let store = RemoteCommuterStore(
            baseURL: URL(string: "https://api.example.com")!, transport: transport
        )
        let subscription = try JSONDecoder().decode(CommuteSubscription.self, from: response)
        let draft = CommuteSubscriptionDraft(
            visibility: .personal, routeID: "*", directionID: "northbound",
            originStopID: "70171", destinationStopID: "70011", serviceWeekdays: [1, 4, 5],
            windowStartMinutes: 451, windowEndMinutes: 452, alertKinds: [.cancellation],
            minimumDelayMinutes: 30,
            scheduleOptionID: String(repeating: "a", count: 64),
            scheduledDepartureMinutes: 451, scheduledArrivalMinutes: 484, scheduleVersion: "v1"
        )

        let updated = try await store.updateSubscription(draft, for: subscription)

        XCTAssertEqual(updated.id, subscription.id)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .put)
        XCTAssertEqual(request.url.path, "/v1/modules/commuter/subscriptions/00000000-0000-4000-8000-000000000401")
        let body = try XCTUnwrap(request.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["minimumDelayMinutes"] as? Int, 30)
        XCTAssertNil(json["ownerMemberID"])
        XCTAssertNil(json["status"])
    }

    func testDisablesWithoutRemovingAndExplicitlyRemovesTheModule() async throws {
        let transport = CommuterRecordingTransport(responses: [
            HTTPResponse(statusCode: 204, body: Data()),
            HTTPResponse(statusCode: 204, body: Data())
        ])
        let store: any CommuterStore = RemoteCommuterStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        try await store.disable()
        try await store.removeModule()

        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.patch, .delete])
        let body = try XCTUnwrap(requests.first?.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(json["status"], "disabled")
    }

    func testEnablesAndCreatesACommuterSubscription() async throws {
        let installation = Data(#"{"enabledByMemberID":"parent-1","status":"enabled"}"#.utf8)
        let subscriptionResponse = Data("""
        {
          "id":"00000000-0000-4000-8000-000000000401",
          "ownerMemberID":"parent-1",
          "visibility":"family",
          "agencyID":"CT",
          "routeID":"caltrain-local",
          "directionID":"northbound",
          "originStopID":"70171",
          "destinationStopID":"70011",
          "serviceWeekdays":[1,2,3,4,5],
          "windowStartMinutes":420,
          "windowEndMinutes":540,
          "alertKinds":["delay"],
          "minimumDelayMinutes":15,
          "status":"active"
        }
        """.utf8)
        let transport = CommuterRecordingTransport(responses: [
            HTTPResponse(statusCode: 200, body: installation),
            HTTPResponse(statusCode: 201, body: subscriptionResponse)
        ])
        let store: any CommuterStore = RemoteCommuterStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )
        let draft = CommuteSubscriptionDraft(
            visibility: .family,
            routeID: "caltrain-local",
            directionID: "northbound",
            originStopID: "70171",
            destinationStopID: "70011",
            serviceWeekdays: [1, 2, 3, 4, 5],
            windowStartMinutes: 420,
            windowEndMinutes: 540,
            alertKinds: [.delay],
            minimumDelayMinutes: 15
        )

        _ = try await store.enable()
        let subscription = try await store.createSubscription(draft)

        XCTAssertEqual(subscription.visibility, .family)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.put, .post])
        let body = try XCTUnwrap(requests.last?.body)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["agencyID"] as? String, "CT")
        XCTAssertEqual(json["originStopID"] as? String, "70171")
        XCTAssertNil(json["ownerMemberID"])
        XCTAssertNil(json["status"])
    }
}

private actor CommuterRecordingTransport: HTTPTransport {
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
