import Foundation
import XCTest
@testable import FamilyCore

final class ReceiptDraftStoreTests: XCTestCase {
  func testExplainsBoundedReceiptRejectionsWithoutEchoingResponse() async throws {
    let cases: [(Int, String)] = [
      (400, "receipt text"), (422, "more than 100"), (429, "wait"),
      (502, "valid proposal"), (503, "unavailable"), (504, "too long"),
    ]
    for (status, expected) in cases {
      let transport = ReceiptRecordingTransport(response: HTTPResponse(statusCode: status,
        body: Data("{\"private\":\"never repeat this\"}".utf8)))
      let store = RemoteReceiptDraftStore(baseURL: URL(string: "https://api.example.test")!, transport: transport)
      do {
        _ = try await store.propose(ocrText: "Synthetic receipt text of sufficient length")
        XCTFail("Expected a rejected proposal")
      } catch {
        let message = ReceiptProposalFeedback.message(for: error)
        XCTAssertTrue(message.localizedCaseInsensitiveContains(expected), "HTTP \(status)")
        XCTAssertFalse(message.contains("never repeat this"))
      }
    }
  }

  func testSendsOnlyOCRTextAndDecodesUnverifiedProposal() async throws {
    let transport = ReceiptRecordingTransport(response: HTTPResponse(statusCode: 200, body: Data("""
      {"merchant":"Example Store","spentOn":"2026-09-26","totalMinor":1234,
       "currency":"USD","category":"Groceries",
       "lineItems":[{"name":"Milk","amountMinor":499}]}
      """.utf8)))
    let store = RemoteReceiptDraftStore(baseURL: URL(string: "https://api.example.test")!, transport: transport)
    let proposed = try await store.propose(ocrText: "Example Store\nMilk $4.99\nTOTAL $12.34")
    XCTAssertEqual(proposed.totalMinor, 1234)
    XCTAssertEqual(proposed.lineItems.map(\.name), ["Milk"])
    let request = await transport.lastRequest()
    XCTAssertEqual(request?.url.path, "/v1/household/receipt-drafts")
    XCTAssertEqual(request?.method, .post)
    XCTAssertEqual(request?.timeoutInterval, 90)
    let payload = try JSONSerialization.jsonObject(with: request!.body!) as! [String: String]
    XCTAssertEqual(payload["ocrText"], "Example Store\nMilk $4.99\nTOTAL $12.34")
    XCTAssertEqual(payload.count, 1)
  }
}

private actor ReceiptRecordingTransport: HTTPTransport {
  let response: HTTPResponse
  var recorded: HTTPRequest?
  init(response: HTTPResponse) { self.response = response }
  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    recorded = request
    return response
  }
  func lastRequest() -> HTTPRequest? { recorded }
}
