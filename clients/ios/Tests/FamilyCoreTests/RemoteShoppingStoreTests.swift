import Foundation
import XCTest

@testable import FamilyCore

final class RemoteShoppingStoreTests: XCTestCase {
  func testLoadsCatalogAndDecodesProtectedShoppingDetails() async throws {
    let transport = ShoppingRecordingTransport(responses: [
      HTTPResponse(statusCode: 200, body: Data(
        """
        {
          "routines":[{
            "id":"10000000-0000-4000-8000-000000000001",
            "familyID":"family-1",
            "storeName":"Neighborhood Market",
            "intervalWeeks":1,
            "preferredWeekday":6,
            "createdByMemberID":"parent-1",
            "createdAt":"2026-10-01T12:00:00.000Z",
            "updatedAt":"2026-10-01T12:00:00.000Z"
          }],
          "items":[{
            "id":"20000000-0000-4000-8000-000000000001",
            "familyID":"family-1",
            "name":"Oat milk",
            "category":"Dairy alternatives",
            "unit":"cartons",
            "critical":true,
            "expectedDurationDays":7,
            "minimumQuantity":1,
            "targetQuantity":2,
            "routineIDs":["10000000-0000-4000-8000-000000000001"],
            "createdByMemberID":"parent-1",
            "createdAt":"2026-10-01T12:00:00.000Z",
            "updatedAt":"2026-10-01T12:00:00.000Z"
          }]
        }
        """.utf8))
    ])
    let store = RemoteShoppingStore(
      baseURL: URL(string: "https://api.example.com")!,
      transport: transport
    )

    let catalog = try await store.catalog()

    XCTAssertEqual(catalog.routines.first?.storeName, "Neighborhood Market")
    XCTAssertEqual(catalog.items.first?.name, "Oat milk")
    XCTAssertEqual(catalog.items.first?.routineIDs, [
      UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    ])
    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.url.path), ["/v1/shopping/catalog"])
  }

  func testSavesRoutineAndPantryItemWithClientGeneratedResourceIDs() async throws {
    let routineID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    let itemID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
    let transport = ShoppingRecordingTransport(responses: [
      HTTPResponse(statusCode: 200, body: routineJSON(id: routineID)),
      HTTPResponse(statusCode: 200, body: itemJSON(id: itemID, routineID: routineID)),
    ])
    let store = RemoteShoppingStore(
      baseURL: URL(string: "https://api.example.com")!,
      transport: transport
    )

    _ = try await store.saveRoutine(
      id: routineID,
      draft: ShoppingRoutineDraft(
        storeName: "Neighborhood Market", intervalWeeks: 1, preferredWeekday: 6
      ))
    _ = try await store.savePantryItem(
      id: itemID,
      draft: PantryItemDraft(
        name: "Oat milk", category: "Dairy alternatives", unit: "cartons",
        critical: true, expectedDurationDays: 7, minimumQuantity: 1,
        targetQuantity: 2, routineIDs: [routineID]
      ))

    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.method), [.put, .put])
    XCTAssertEqual(requests.map(\.url.path), [
      "/v1/shopping/routines/\(routineID.uuidString.lowercased())",
      "/v1/shopping/pantry-items/\(itemID.uuidString.lowercased())",
    ])
  }

  func testLoadsRequestsAndLatestStockObservations() async throws {
    let transport = ShoppingRecordingTransport(responses: [
      HTTPResponse(statusCode: 200, body: Data(
        """
        {
          "openRequests":[{
            "id":"30000000-0000-4000-8000-000000000001",
            "familyID":"family-1",
            "itemID":"20000000-0000-4000-8000-000000000001",
            "requestedByMemberID":"kid-1",
            "quantity":2,
            "note":"For breakfast",
            "status":"open",
            "requestedAt":"2026-10-02T12:00:00.000Z",
            "resolvedAt":null,
            "resolvedByMemberID":null
          }],
          "latestObservations":[{
            "id":"40000000-0000-4000-8000-000000000001",
            "familyID":"family-1",
            "itemID":"20000000-0000-4000-8000-000000000001",
            "observedByMemberID":"kid-1",
            "level":"low",
            "quantity":0.5,
            "note":null,
            "observedAt":"2026-10-02T12:00:00.000Z"
          }]
        }
        """.utf8))
    ])
    let store = RemoteShoppingStore(
      baseURL: URL(string: "https://api.example.com")!, transport: transport
    )

    let evidence = try await store.evidence()

    XCTAssertEqual(evidence.openRequests.first?.note, "For breakfast")
    XCTAssertEqual(evidence.latestObservations.first?.level, StockLevel.low)
    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.first?.url.path, "/v1/shopping/evidence")
  }

  func testRequestsItemsObservesStockAndClosesRequestsWithResourceIDs() async throws {
    let itemID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
    let requestID = UUID(uuidString: "30000000-0000-4000-8000-000000000001")!
    let observationID = UUID(uuidString: "40000000-0000-4000-8000-000000000001")!
    let requestBody = Data(
      """
      {"id":"\(requestID)","familyID":"family-1","itemID":"\(itemID)","requestedByMemberID":"kid-1","quantity":2,"note":null,"status":"open","requestedAt":"2026-10-02T12:00:00.000Z","resolvedAt":null,"resolvedByMemberID":null}
      """.utf8)
    let observationBody = Data(
      """
      {"id":"\(observationID)","familyID":"family-1","itemID":"\(itemID)","observedByMemberID":"kid-1","level":"out","quantity":0,"note":null,"observedAt":"2026-10-02T12:00:00.000Z"}
      """.utf8)
    let resolvedBody = Data(
      """
      {"id":"\(requestID)","familyID":"family-1","itemID":"\(itemID)","requestedByMemberID":"kid-1","quantity":2,"note":null,"status":"resolved","requestedAt":"2026-10-02T12:00:00.000Z","resolvedAt":"2026-10-02T13:00:00.000Z","resolvedByMemberID":"parent-1"}
      """.utf8)
    let transport = ShoppingRecordingTransport(responses: [
      HTTPResponse(statusCode: 200, body: requestBody),
      HTTPResponse(statusCode: 200, body: observationBody),
      HTTPResponse(statusCode: 200, body: resolvedBody),
    ])
    let store = RemoteShoppingStore(
      baseURL: URL(string: "https://api.example.com")!, transport: transport
    )

    _ = try await store.requestItem(
      id: requestID,
      draft: ShoppingItemRequestDraft(itemID: itemID, quantity: 2, note: nil)
    )
    _ = try await store.observeStock(
      id: observationID,
      itemID: itemID,
      input: StockObservationInput(level: .out, quantity: 0, note: nil)
    )
    _ = try await store.closeRequest(id: requestID, status: .resolved)

    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.method), [.put, .put, .patch])
    XCTAssertEqual(requests.map(\.url.path), [
      "/v1/shopping/requests/\(requestID.uuidString.lowercased())",
      "/v1/shopping/stock-observations/\(observationID.uuidString.lowercased())",
      "/v1/shopping/requests/\(requestID.uuidString.lowercased())",
    ])
    XCTAssertEqual(try bodyObject(requests[0])["itemID"] as? String, itemID.uuidString)
    XCTAssertEqual(try bodyObject(requests[0])["quantity"] as? Double, 2)
    XCTAssertEqual(try bodyObject(requests[1])["level"] as? String, "out")
    XCTAssertEqual(try bodyObject(requests[2])["status"] as? String, "resolved")
  }

  func testPreparesReviewsFinalizesAndListsShoppingTrips() async throws {
    let tripID = UUID(uuidString: "50000000-0000-4000-8000-000000000001")!
    let routineID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    let itemID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
    func tripJSON(status: String, version: Int) -> Data {
      Data("""
      {"id":"\(tripID)","familyID":"family-1","routineID":"\(routineID)","plannedFor":"2026-10-11","status":"\(status)","version":\(version),"entries":[{"itemID":"\(itemID)","decision":"buy","reason":"Parent decision.","requestIDs":[],"observationID":null}],"outcomes":[],"createdByMemberID":"parent-1","createdAt":"2026-10-10T12:00:00.000Z","updatedAt":"2026-10-10T12:00:00.000Z","finalizedAt":null,"finalizedByMemberID":null,"completedAt":null,"completedByMemberID":null}
      """.utf8)
    }
    let transport = ShoppingRecordingTransport(responses: [
      HTTPResponse(statusCode: 200, body: tripJSON(status: "draft", version: 1)),
      HTTPResponse(statusCode: 200, body: tripJSON(status: "draft", version: 2)),
      HTTPResponse(statusCode: 200, body: tripJSON(status: "finalized", version: 3)),
      HTTPResponse(statusCode: 200, body: Data("[\(String(decoding: tripJSON(status: "finalized", version: 3), as: UTF8.self))]".utf8)),
    ])
    let store = RemoteShoppingStore(baseURL: URL(string: "https://api.example.com")!, transport: transport)
    let draft = try await store.prepareTrip(id: tripID, routineID: routineID, plannedFor: "2026-10-11")
    XCTAssertEqual(draft.entries.first?.decision, .buy)
    _ = try await store.reviewTrip(id: tripID, expectedVersion: 1,
      entries: [ShoppingTripDecisionInput(itemID: itemID, decision: .checkAtHome)])
    _ = try await store.finalizeTrip(id: tripID, expectedVersion: 2)
    let trips = try await store.trips()
    XCTAssertEqual(trips.first?.status, .finalized)
    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.method), [.put, .patch, .post, .get])
    XCTAssertEqual(requests.map(\.url.path), [
      "/v1/shopping/trips/\(tripID.uuidString.lowercased())",
      "/v1/shopping/trips/\(tripID.uuidString.lowercased())",
      "/v1/shopping/trips/\(tripID.uuidString.lowercased())/finalize",
      "/v1/shopping/trips",
    ])
    XCTAssertEqual(try bodyObject(requests[0])["plannedFor"] as? String, "2026-10-11")
    XCTAssertEqual(try bodyObject(requests[1])["expectedVersion"] as? Int, 1)
    XCTAssertEqual(try bodyObject(requests[2])["expectedVersion"] as? Int, 2)
  }

  func testCompletesTripAndReadsPurchaseHistory() async throws {
    let tripID = UUID(uuidString: "50000000-0000-4000-8000-000000000081")!
    let itemID = UUID(uuidString: "20000000-0000-4000-8000-000000000081")!
    let purchase = """
    {"familyID":"family-1","tripID":"\(tripID)","itemID":"\(itemID)","purchasedAt":"2026-10-11T12:00:00.000Z","quantity":2,"price":8.5}
    """
    let trip = """
    {"id":"\(tripID)","familyID":"family-1","routineID":"10000000-0000-4000-8000-000000000081","plannedFor":"2026-10-11","status":"completed","version":3,"entries":[{"itemID":"\(itemID)","decision":"buy","reason":"Parent decision.","requestIDs":[],"observationID":null}],"outcomes":[{"itemID":"\(itemID)","status":"purchased","quantity":2,"price":8.5}],"createdByMemberID":"parent-1","createdAt":"2026-10-10T12:00:00.000Z","updatedAt":"2026-10-11T12:00:00.000Z","finalizedAt":"2026-10-10T13:00:00.000Z","finalizedByMemberID":"parent-1","completedAt":"2026-10-11T12:00:00.000Z","completedByMemberID":"parent-1"}
    """
    let transport = ShoppingRecordingTransport(responses: [
      HTTPResponse(statusCode: 200, body: Data(trip.utf8)),
      HTTPResponse(statusCode: 200, body: Data("[\(purchase)]".utf8)),
    ])
    let store = RemoteShoppingStore(baseURL: URL(string: "https://api.example.com")!, transport: transport)
    let completed = try await store.completeTrip(id: tripID, expectedVersion: 2, outcomes: [
      ShoppingOutcomeInput(itemID: itemID, status: .purchased, quantity: 2, price: 8.5),
    ])
    XCTAssertEqual(completed.status, .completed)
    XCTAssertEqual(completed.outcomes.first?.status, .purchased)
    let purchases = try await store.purchases()
    XCTAssertEqual(purchases.first?.quantity, 2)
    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.url.path), [
      "/v1/shopping/trips/\(tripID.uuidString.lowercased())/complete", "/v1/shopping/purchases",
    ])
    XCTAssertEqual(try bodyObject(requests[0])["expectedVersion"] as? Int, 2)
  }

  func testDeletesRoutineAndPantryItemAtResourcePaths() async throws {
    let routineID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    let itemID = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
    let transport = ShoppingRecordingTransport(responses: [
      HTTPResponse(statusCode: 204, body: Data()),
      HTTPResponse(statusCode: 204, body: Data()),
    ])
    let store = RemoteShoppingStore(
      baseURL: URL(string: "https://api.example.com")!,
      transport: transport
    )

    try await store.deleteRoutine(id: routineID)
    try await store.deletePantryItem(id: itemID)

    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.method), [.delete, .delete])
    XCTAssertEqual(requests.map(\.url.path), [
      "/v1/shopping/routines/\(routineID.uuidString.lowercased())",
      "/v1/shopping/pantry-items/\(itemID.uuidString.lowercased())",
    ])
  }

  private func bodyObject(_ request: HTTPRequest) throws -> [String: Any] {
    let body = try XCTUnwrap(request.body)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
  }

  private func routineJSON(id: UUID) -> Data {
    Data(
      """
      {"id":"\(id.uuidString)","familyID":"family-1","storeName":"Neighborhood Market","intervalWeeks":1,"preferredWeekday":6,"createdByMemberID":"parent-1","createdAt":"2026-10-01T12:00:00.000Z","updatedAt":"2026-10-01T12:00:00.000Z"}
      """.utf8)
  }

  private func itemJSON(id: UUID, routineID: UUID) -> Data {
    Data(
      """
      {"id":"\(id.uuidString)","familyID":"family-1","name":"Oat milk","category":"Dairy alternatives","unit":"cartons","critical":true,"expectedDurationDays":7,"minimumQuantity":1,"targetQuantity":2,"routineIDs":["\(routineID.uuidString)"],"createdByMemberID":"parent-1","createdAt":"2026-10-01T12:00:00.000Z","updatedAt":"2026-10-01T12:00:00.000Z"}
      """.utf8)
  }
}

private actor ShoppingRecordingTransport: HTTPTransport {
  private var responses: [HTTPResponse]
  private var requests: [HTTPRequest] = []

  init(responses: [HTTPResponse]) { self.responses = responses }

  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    requests.append(request)
    return responses.removeFirst()
  }

  func recordedRequests() -> [HTTPRequest] { requests }
}
