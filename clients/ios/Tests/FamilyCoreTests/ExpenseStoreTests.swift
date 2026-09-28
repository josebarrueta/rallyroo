import Foundation
import XCTest
@testable import FamilyCore

final class ExpenseStoreTests: XCTestCase {
  func testSaveFailureFeedbackDistinguishesValidationFromPantryAndDoesNotEchoDetails() {
    let rejected = ExpenseSaveFeedback.message(for: RemoteStoreError.requestFailed(statusCode: 400),
      expenseSaved: false)
    XCTAssertTrue(rejected.contains("rejected"))
    XCTAssertTrue(rejected.contains("not saved"))
    let server = ExpenseSaveFeedback.message(for: RemoteStoreError.requestFailed(statusCode: 500),
      expenseSaved: false)
    XCTAssertTrue(server.contains("server"))
    XCTAssertTrue(server.contains("could not confirm"))
    XCTAssertFalse(server.contains("was not saved"))
    let pantry = ExpenseSaveFeedback.message(for: RemoteStoreError.requestFailed(statusCode: 409),
      expenseSaved: true)
    XCTAssertTrue(pantry.contains("Expense was saved"))
    XCTAssertTrue(pantry.contains("Pantry"))
    XCTAssertFalse(pantry.contains("secret"))
  }

  func testMoneyParsingDoesNotRoundOrAcceptAmbiguousAmounts() {
    XCTAssertEqual(ExpenseAmount.usdMinorUnits("12.34"), 1234)
    XCTAssertEqual(ExpenseAmount.usdMinorUnits("12.3"), 1230)
    XCTAssertEqual(ExpenseAmount.usdMinorUnits("12"), 1200)
    for input in ["", "0", "0.00", "-1", "1.234", "1,234.00", "NaN", "10000000000"] {
      XCTAssertNil(ExpenseAmount.usdMinorUnits(input), input)
    }
  }

  func testRemoteStoreSendsIdempotentResourceIDAndExactMinorUnits() async throws {
    let id = UUID(uuidString: "90000000-0000-4000-8000-000000000001")!
    let body = Data("""
      {"id":"\(id.uuidString.lowercased())","familyID":"family-test","createdByMemberID":"parent-test",
       "spentOn":"2026-09-26","amountMinor":1234,"currency":"USD","category":"Groceries",
       "merchant":"Market","note":null,"version":1,
       "createdAt":"2026-09-27T00:00:00.000Z","updatedAt":"2026-09-27T00:00:00.000Z"}
      """.utf8)
    let transport = ExpenseRecordingTransport(responses: [HTTPResponse(statusCode: 201, body: body)])
    let store = RemoteExpenseStore(baseURL: URL(string: "https://api.example.com")!, transport: transport)
    let draft = ExpenseDraft(spentOn: "2026-09-26", amountMinor: 1234, currency: "USD",
                             category: "Groceries", merchant: "Market", note: nil)
    let saved = try await store.create(id: id, draft: draft)
    XCTAssertEqual(saved.amountMinor, 1234)
    XCTAssertEqual(saved.id, id)
    let requests = await transport.requests()
    XCTAssertEqual(requests.first?.method, .put)
    XCTAssertEqual(requests.first?.url.path, "/v1/household/expenses/\(id.uuidString.lowercased())")
    let payload = try JSONSerialization.jsonObject(with: requests[0].body!) as! [String: Any]
    XCTAssertEqual(payload["amountMinor"] as? Int, 1234)
    // The API's strict draft contract requires nullable fields to be present,
    // not omitted by JSONEncoder's default Optional encoding.
    XCTAssertTrue(payload["note"] is NSNull)

    let withoutMerchant = ExpenseDraft(spentOn: "2026-09-26", amountMinor: 1234,
      currency: "USD", category: "Groceries", merchant: nil, note: nil)
    let second = ExpenseRecordingTransport(responses: [HTTPResponse(statusCode: 201, body: body)])
    _ = try await RemoteExpenseStore(baseURL: URL(string: "https://api.example.com")!,
      transport: second).create(id: id, draft: withoutMerchant)
    let secondPayload = try JSONSerialization.jsonObject(with: (await second.requests())[0].body!) as! [String: Any]
    XCTAssertTrue(secondPayload["merchant"] is NSNull)
    XCTAssertTrue(secondPayload["note"] is NSNull)

    let updateTransport = ExpenseRecordingTransport(responses: [HTTPResponse(statusCode: 200, body: body)])
    _ = try await RemoteExpenseStore(baseURL: URL(string: "https://api.example.com")!,
      transport: updateTransport).update(id: id, version: 1, draft: withoutMerchant)
    let updatedPayload = try JSONSerialization.jsonObject(with: (await updateTransport.requests())[0].body!) as! [String: Any]
    XCTAssertTrue(updatedPayload["merchant"] is NSNull)
    XCTAssertTrue(updatedPayload["note"] is NSNull)
    XCTAssertEqual(updatedPayload["expectedVersion"] as? Int, 1)
  }
}

private actor ExpenseRecordingTransport: HTTPTransport {
  private var queued: [HTTPResponse]
  private var sent: [HTTPRequest] = []
  init(responses: [HTTPResponse]) { queued = responses }
  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    sent.append(request)
    return queued.removeFirst()
  }
  func requests() -> [HTTPRequest] { sent }
}
