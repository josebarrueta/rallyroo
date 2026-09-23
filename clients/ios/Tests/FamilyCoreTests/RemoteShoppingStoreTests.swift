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
