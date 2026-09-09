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
          }]
        }
        """.utf8)
        let transport = CommuterRecordingTransport(responses: [
            HTTPResponse(statusCode: 200, body: response)
        ])
        let store: any CommuterStore = RemoteCommuterStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let state = try await store.state()

        XCTAssertEqual(state.installation?.enabledByMemberID, "parent-1")
        XCTAssertEqual(state.subscriptions.first?.originStopID, "70171")
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .get)
        XCTAssertEqual(request.url.path, "/v1/modules/commuter")
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
