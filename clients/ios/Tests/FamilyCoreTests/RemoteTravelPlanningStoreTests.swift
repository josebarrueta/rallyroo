import Foundation
import XCTest
@testable import FamilyCore

final class RemoteTravelPlanningStoreTests: XCTestCase {
    // MARK: Fixed identifiers and samples

    private let eventID = UUID(uuidString: "00000000-0000-4000-8000-000000000101")!
    private let placeID = UUID(uuidString: "00000000-0000-4000-8000-000000000401")!
    private let waypointPlaceID = "ChIJ-123"

    private func makeStore(_ transport: any HTTPTransport) -> any TravelPlanningStore {
        RemoteTravelPlanningStore(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )
    }

    private func validEventTravelPlanJSON() -> Data {
        Data("""
        {
          "eventID":"00000000-0000-4000-8000-000000000101",
          "revision":2,
          "origin":{"kind":"saved_place","savedPlaceID":"00000000-0000-4000-8000-000000000401"},
          "preparationMinutes":30,
          "trafficPreference":"best_guess",
          "recipientMemberIDs":["member-kid","member-parent"],
          "leaveAlertEnabled":true,
          "createdByMemberID":"parent-1",
          "createdAt":"2026-08-01T10:00:00.000Z",
          "updatedAt":"2026-08-01T10:05:30.250Z"
        }
        """.utf8)
    }

    private func validSavedPlaceJSON() -> Data {
        Data("""
        {
          "id":"00000000-0000-4000-8000-000000000401",
          "ownerMemberID":null,
          "visibility":"family",
          "label":"Home",
          "waypoint":{"address":"123 Field St, Palo Alto, CA"},
          "createdAt":"2026-08-01T10:00:00.000Z",
          "updatedAt":"2026-08-01T10:05:30.250Z"
        }
        """.utf8)
    }

    private func savedPlacesArrayJSON() -> Data {
        Data("[\(String(decoding: validSavedPlaceJSON(), as: UTF8.self))]".utf8)
    }

    private func previewJSON() -> Data {
        Data("""
        {
          "leaveTime":"2026-08-01T11:04:28.000Z",
          "durationSeconds":1800,
          "distanceMeters":48200.5,
          "estimatedAt":"2026-08-01T10:00:00.000Z",
          "leaveNow":false,
          "provider":"google_routes",
          "attribution":"Google Maps"
        }
        """.utf8)
    }

    private func savedPlaceDraft() -> SavedPlaceDraft {
        SavedPlaceDraft(
            visibility: .family,
            label: "Home",
            waypoint: try! TravelWaypoint(address: "123 Field St, Palo Alto, CA")
        )
    }

    private func travelPlanDraft() -> TravelPlanDraft {
        TravelPlanDraft(
            origin: .savedPlace(placeID),
            preparationMinutes: 30,
            trafficPreference: .bestGuess,
            recipientMemberIDs: ["member-kid"],
            leaveAlertEnabled: false
        )
    }

    // MARK: Saved places

    func testListsSavedPlacesWithExactPath() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: savedPlacesArrayJSON())
        ])
        let store = makeStore(transport)

        let places = try await store.savedPlaces()

        XCTAssertEqual(places.count, 1)
        XCTAssertEqual(places.first?.id, placeID)
        XCTAssertEqual(places.first?.ownerMemberID, nil)
        XCTAssertEqual(places.first?.visibility, .family)
        XCTAssertEqual(places.first?.label, "Home")
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get])
        XCTAssertEqual(requests.first?.url.path, "/v1/saved-places")
        XCTAssertNil(requests.first?.body)
        XCTAssertNil(requests.first?.headers["Content-Type"])
    }

    func testCreatesASavedPlacePostingTheRequestBody() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 201, body: validSavedPlaceJSON())
        ])
        let store = makeStore(transport)

        _ = try await store.createSavedPlace(savedPlaceDraft())

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/v1/saved-places")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        let json = try bodyObject(request)
        XCTAssertEqual(json["visibility"] as? String, "family")
        XCTAssertEqual(json["label"] as? String, "Home")
        let waypoint = try XCTUnwrap(json["waypoint"] as? [String: Any])
        XCTAssertEqual(waypoint["address"] as? String, "123 Field St, Palo Alto, CA")
        XCTAssertNil(waypoint["placeID"])
        // A create request carries no server-assigned metadata.
        XCTAssertNil(json["id"])
        XCTAssertNil(json["ownerMemberID"])
        XCTAssertNil(json["createdAt"])
    }

    func testUpdatesASavedPlaceAtIDScopedPath() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: validSavedPlaceJSON())
        ])
        let store = makeStore(transport)

        _ = try await store.updateSavedPlace(savedPlaceDraft(), id: placeID)

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .put)
        XCTAssertEqual(request.url.path, "/v1/saved-places/\(placeID.uuidString)")
        let json = try bodyObject(request)
        XCTAssertNil(json["id"])
        XCTAssertNil(json["familyID"])
    }

    func testDeletesASavedPlaceWithoutABody() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 204, body: Data())
        ])
        let store = makeStore(transport)

        try await store.deleteSavedPlace(id: placeID)

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .delete)
        XCTAssertEqual(request.url.path, "/v1/saved-places/\(placeID.uuidString)")
        XCTAssertNil(request.body)
        XCTAssertNil(request.headers["Content-Type"])
    }

    // MARK: Travel plans

    func testReadsATravelPlanWithExactPathAndDecodesISO8601Dates() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: validEventTravelPlanJSON())
        ])
        let store = makeStore(transport)

        let plan = try await store.travelPlan(for: eventID)

        let decoded = try XCTUnwrap(plan)
        XCTAssertEqual(decoded.eventID, eventID)
        XCTAssertEqual(decoded.revision, 2)
        guard case let .savedPlace(id) = decoded.origin else {
            XCTFail("Expected a saved place origin")
            return
        }
        XCTAssertEqual(id, placeID)
        XCTAssertEqual(decoded.trafficPreference, .bestGuess)
        XCTAssertEqual(decoded.recipientMemberIDs, ["member-kid", "member-parent"])
        XCTAssertTrue(decoded.leaveAlertEnabled)
        // Fractional ISO8601 timestamps must decode correctly.
        XCTAssertEqual(decoded.createdAt, Date(timeIntervalSince1970: 1_785_578_400))
        XCTAssertEqual(decoded.updatedAt, Date(timeIntervalSince1970: 1_785_578_730.25))
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.get])
        XCTAssertEqual(requests.first?.url.path, "/v1/events/\(eventID.uuidString)/travel-plan")
    }

    func testReturnsNilForA404TravelPlan() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(
                statusCode: 404,
                body: Data(#"{"error":"travel_plan_not_found"}"#.utf8)
            )
        ])
        let store = makeStore(transport)

        let plan = try await store.travelPlan(for: eventID)

        XCTAssertNil(plan)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.first?.url.path, "/v1/events/\(eventID.uuidString)/travel-plan")
    }

    func testPropagatesNonSuccessTravelPlanStatuses() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 403, body: Data())
        ])
        let store = makeStore(transport)

        do {
            _ = try await store.travelPlan(for: eventID)
            XCTFail("Expected a non-2xx status to fail")
        } catch let error as RemoteStoreError {
            XCTAssertEqual(error, .requestFailed(statusCode: 403))
        }
    }

    func testSavesATravelPlanWithTaggedOriginAndSnakeCaseEnums() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: validEventTravelPlanJSON())
        ])
        let store = makeStore(transport)

        let oneTimeDraft = TravelPlanDraft(
            origin: .oneTime(try! TravelWaypoint(placeID: waypointPlaceID)),
            preparationMinutes: 15,
            trafficPreference: .pessimistic,
            recipientMemberIDs: ["member-kid"],
            leaveAlertEnabled: true
        )
        _ = try await store.saveTravelPlan(oneTimeDraft, for: eventID)

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .put)
        XCTAssertEqual(request.url.path, "/v1/events/\(eventID.uuidString)/travel-plan")
        let json = try bodyObject(request)
        XCTAssertEqual(json["preparationMinutes"] as? Int, 15)
        XCTAssertEqual(json["trafficPreference"] as? String, "pessimistic")
        XCTAssertEqual(json["recipientMemberIDs"] as? [String], ["member-kid"])
        XCTAssertEqual(json["leaveAlertEnabled"] as? Bool, true)
        let origin = try XCTUnwrap(json["origin"] as? [String: Any])
        XCTAssertEqual(origin["kind"] as? String, "one_time")
        let waypoint = try XCTUnwrap(origin["waypoint"] as? [String: Any])
        XCTAssertEqual(waypoint["placeID"] as? String, waypointPlaceID)
        XCTAssertNil(waypoint["address"])
        // A draft request carries no server metadata.
        XCTAssertNil(json["eventID"])
        XCTAssertNil(json["revision"])
        XCTAssertNil(json["createdByMemberID"])
    }

    func testDecodesSavedPlaceOriginTaggedUnion() throws {
        let json = Data(
            #"{"kind":"saved_place","savedPlaceID":"00000000-0000-4000-8000-000000000401"}"#.utf8
        )
        let origin = try JSONDecoder().decode(TravelPlanOrigin.self, from: json)
        guard case let .savedPlace(id) = origin else {
            XCTFail("Expected a saved place origin")
            return
        }
        XCTAssertEqual(id, placeID)
    }

    func testDeletesATravelPlanWithoutABody() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 204, body: Data())
        ])
        let store = makeStore(transport)

        try await store.deleteTravelPlan(for: eventID)

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .delete)
        XCTAssertEqual(request.url.path, "/v1/events/\(eventID.uuidString)/travel-plan")
        XCTAssertNil(request.body)
        XCTAssertNil(request.headers["Content-Type"])
    }

    // MARK: Previews

    func testPreviewsAnExistingPlanWithNoBodyOrContentType() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: previewJSON())
        ])
        let store = makeStore(transport)

        let preview = try await store.previewTravelPlan(for: eventID)

        XCTAssertEqual(preview.durationSeconds, 1_800)
        XCTAssertEqual(preview.distanceMeters, 48_200.5)
        XCTAssertEqual(preview.leaveNow, false)
        XCTAssertEqual(preview.provider, "google_routes")
        XCTAssertEqual(preview.attribution, "Google Maps")
        XCTAssertEqual(preview.estimatedAt, Date(timeIntervalSince1970: 1_785_578_400))
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/v1/events/\(eventID.uuidString)/travel-plan/preview")
        XCTAssertNil(request.body)
        XCTAssertNil(request.headers["Content-Type"])
    }

    func testPreviewsADraftPostingAJSONBody() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: previewJSON())
        ])
        let store = makeStore(transport)

        _ = try await store.previewTravelPlan(travelPlanDraft(), for: eventID)

        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/v1/events/\(eventID.uuidString)/travel-plan/preview")
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        let json = try bodyObject(request)
        XCTAssertEqual(json["preparationMinutes"] as? Int, 30)
        let origin = try XCTUnwrap(json["origin"] as? [String: Any])
        XCTAssertEqual(origin["kind"] as? String, "saved_place")
        XCTAssertEqual(origin["savedPlaceID"] as? String, placeID.uuidString)
        XCTAssertNil(origin["waypoint"])
    }

    func testPreviewsFailOnErrorStatuses() async throws {
        let transport = RecordingHTTPTransport(responses: [
            HTTPResponse(
                statusCode: 503,
                body: Data(#"{"error":"routing_unavailable"}"#.utf8)
            )
        ])
        let store = makeStore(transport)

        do {
            _ = try await store.previewTravelPlan(for: eventID)
            XCTFail("Expected the routing-unavailable preview to fail")
        } catch let error as RemoteStoreError {
            XCTAssertEqual(error, .requestFailed(statusCode: 503))
        }
    }

    // MARK: Local validation runs before transport

    func testRejectsImpossibleWaypointsWithoutTouchingTransport() async throws {
        let transport = RecordingHTTPTransport(responses: [])
        do {
            _ = try TravelWaypoint(placeID: nil, address: nil)
            XCTFail("Expected both-nil waypoint to be rejected")
        } catch {
            XCTAssertEqual(error as? TravelPlanningError, .invalidWaypoint)
        }
        do {
            _ = try TravelWaypoint(placeID: "a", address: "b")
            XCTFail("Expected both-set waypoint to be rejected")
        } catch {
            XCTAssertEqual(error as? TravelPlanningError, .invalidWaypoint)
        }
        // A blank waypoint is also impossible.
        XCTAssertNil(try? TravelWaypoint(placeID: "    ", address: nil))

        // Local saved-place validation still runs before any request.
        let store = makeStore(transport)
        let badDraft = SavedPlaceDraft(
            visibility: .personal,
            label: "   ",
            waypoint: try! TravelWaypoint(placeID: "p")
        )
        do {
            _ = try await store.createSavedPlace(badDraft)
            XCTFail("Expected an invalid label to be rejected before transport")
        } catch {
            XCTAssertEqual(error as? TravelPlanningError, .invalidSavedPlace)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testRejectsPreparationOutOfRangeBeforeTransport() async throws {
        let transport = RecordingHTTPTransport(responses: [])
        let store = makeStore(transport)
        let draft = TravelPlanDraft(
            origin: .savedPlace(placeID),
            preparationMinutes: 181,
            trafficPreference: .bestGuess,
            recipientMemberIDs: ["member-kid"],
            leaveAlertEnabled: false
        )

        do {
            _ = try await store.saveTravelPlan(draft, for: eventID)
            XCTFail("Expected out-of-range preparation to be rejected")
        } catch {
            XCTAssertEqual(error as? TravelPlanningError, .invalidPreparationMinutes)
        }
        let requests = await transport.recordedRequests()
        XCTAssertTrue(requests.isEmpty)
    }

    func testRejectsEmptyAndDuplicateRecipientsBeforeTransport() async throws {
        let emptyTransport = RecordingHTTPTransport(responses: [])
        let duplicateTransport = RecordingHTTPTransport(responses: [])
        let store = makeStore(emptyTransport)
        let draftStore = makeStore(duplicateTransport)

        let emptyDraft = TravelPlanDraft(
            origin: .savedPlace(placeID),
            preparationMinutes: 30,
            trafficPreference: .bestGuess,
            recipientMemberIDs: [],
            leaveAlertEnabled: true
        )
        do {
            _ = try await store.saveTravelPlan(emptyDraft, for: eventID)
            XCTFail("Expected empty recipients to be rejected")
        } catch {
            XCTAssertEqual(error as? TravelPlanningError, .invalidRecipients)
        }

        let duplicateDraft = TravelPlanDraft(
            origin: .savedPlace(placeID),
            preparationMinutes: 30,
            trafficPreference: .bestGuess,
            recipientMemberIDs: ["member-kid", "member-kid"],
            leaveAlertEnabled: false
        )
        do {
            _ = try await draftStore.saveTravelPlan(duplicateDraft, for: eventID)
            XCTFail("Expected duplicate recipients to be rejected")
        } catch {
            XCTAssertEqual(error as? TravelPlanningError, .invalidRecipients)
        }

        let emptyRequests = await emptyTransport.recordedRequests()
        let duplicateRequests = await duplicateTransport.recordedRequests()
        XCTAssertTrue(emptyRequests.isEmpty)
        XCTAssertTrue(duplicateRequests.isEmpty)
    }

    // MARK: Helpers

    private func bodyObject(_ request: HTTPRequest) throws -> [String: Any] {
        let body = try XCTUnwrap(request.body, "Expected a request body")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
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
        if responses.isEmpty {
            throw TransportExhaustedError()
        }
        return responses.removeFirst()
    }

    func recordedRequests() -> [HTTPRequest] {
        requests
    }
}

private struct TransportExhaustedError: Error {}
