import Foundation
import XCTest
@testable import FamilyCore

final class RemoteScheduleDraftExtractorTests: XCTestCase {
    func testExtractsReviewOnlyDraftsFromRecognizedText() async throws {
        let response = Data("""
        {"drafts":[{
          "kind":"event",
          "title":"Soccer practice",
          "memberIDs":["kid-1"],
          "startTime":"2026-09-08T00:00:00Z",
          "endTime":"2026-09-08T01:00:00Z",
          "dueAt":null,
          "location":"Lincoln Field",
          "alertLeadTimeMinutes":15,
          "clarification":null,
          "confidence":0.94
        }]}
        """.utf8)
        let transport = ScheduleDraftHTTPTransport(response: HTTPResponse(statusCode: 200, body: response))
        let extractor: any ScheduleDraftExtractor = RemoteScheduleDraftExtractor(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let drafts = try await extractor.extract(
            text: "Soccer practice Tuesday at five",
            inputType: .voice,
            timeZone: "America/Los_Angeles"
        )

        XCTAssertEqual(drafts.first?.kind, .event)
        XCTAssertEqual(drafts.first?.memberIDs, [KidID(rawValue: "kid-1")])
        XCTAssertEqual(drafts.first?.alertLeadTimeMinutes, 15)
        let recordedRequest = await transport.request()
        let request = try XCTUnwrap(recordedRequest)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.path, "/v1/schedule-drafts")
        XCTAssertEqual(request.timeoutInterval, 60)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body!) as? [String: Any])
        XCTAssertEqual(json["inputType"] as? String, "voice")
        XCTAssertEqual(json["text"] as? String, "Soccer practice Tuesday at five")
    }
}

private actor ScheduleDraftHTTPTransport: HTTPTransport {
    private let response: HTTPResponse
    private var recordedRequest: HTTPRequest?

    init(response: HTTPResponse) { self.response = response }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        recordedRequest = request
        return response
    }

    func request() -> HTTPRequest? { recordedRequest }
}
