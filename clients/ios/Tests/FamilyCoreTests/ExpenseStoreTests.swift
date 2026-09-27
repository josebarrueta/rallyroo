import Foundation
import XCTest
@testable import FamilyCore

final class ExpenseStoreTests: XCTestCase {
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
