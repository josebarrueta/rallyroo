import Foundation
import XCTest

@testable import FamilyCore

final class RemoteDayBriefStoreTests: XCTestCase {
  // MARK: Fixed samples

  private let preferredPreferences = DayBriefPreferences(
    enabled: true,
    timeZone: "America/Los_Angeles",
    weekdayTime: "07:30",
    weekendHolidayTime: "09:00",
    earlyEventLeadMinutes: 20,
    holidayRegion: "US"
  )

  private func makeStore(_ transport: any HTTPTransport) -> any DayBriefStore {
    RemoteDayBriefStore(
      baseURL: URL(string: "https://api.example.com")!,
      transport: transport
    )
  }

  private func preferencesResponseJSON() -> Data {
    Data(
      """
      {
        "enabled":true,
        "timeZone":"America/Los_Angeles",
        "weekdayTime":"07:30",
        "weekendHolidayTime":"09:00",
        "earlyEventLeadMinutes":20,
        "holidayRegion":"US"
      }
      """.utf8)
  }

  private func briefResponseJSON() -> Data {
    Data(
      """
      {
        "localDate":"2026-10-05",
        "timeZone":"America/Los_Angeles",
        "facts":{
          "events":[
            {
              "id":"event-pickup",
              "title":"School pickup",
              "scheduledAt":"2026-10-05T09:00:00.000Z",
              "startTime":"2026-10-05T14:30:00.000Z",
              "endTime":"2026-10-05T15:00:00.000Z",
              "location":"Lincoln Elementary",
              "roles":["driver"]
            }
          ],
          "reminders":[]
        },
        "title":"Mon 10/5",
        "body":"You have 1 event.",
        "generatedAt":"2026-10-05T08:00:00.000Z"
      }
      """.utf8)
  }

  // MARK: Preferences

  func testReturnsNilForA404Preferences() async throws {
    let transport = RecordingHTTPTransport(responses: [
      HTTPResponse(
        statusCode: 404,
        body: Data(#"{"error":"preferences_not_found"}"#.utf8)
      )
    ])
    let store = makeStore(transport)

    let result = try await store.preferences()

    XCTAssertNil(result)
    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.method), [.get])
    let request = try XCTUnwrap(requests.first)
    XCTAssertEqual(request.url.path, "/v1/day-brief/preferences")
    XCTAssertNil(request.body)
    XCTAssertNil(request.headers["Content-Type"])
  }

  func testSavesPreferencesAsAPUTWithExactDecodedRequestFields() async throws {
    let transport = RecordingHTTPTransport(responses: [
      HTTPResponse(statusCode: 200, body: preferencesResponseJSON())
    ])
    let store = makeStore(transport)

    let saved = try await store.savePreferences(preferredPreferences)

    XCTAssertEqual(saved, preferredPreferences)
    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.count, 1)
    let request = try XCTUnwrap(requests.first)
    XCTAssertEqual(request.method, .put)
    XCTAssertEqual(request.url.path, "/v1/day-brief/preferences")
    XCTAssertEqual(request.headers["Content-Type"], "application/json")
    let json = try bodyObject(request)
    XCTAssertEqual(json["enabled"] as? Bool, true)
    XCTAssertEqual(json["timeZone"] as? String, "America/Los_Angeles")
    XCTAssertEqual(json["weekdayTime"] as? String, "07:30")
    XCTAssertEqual(json["weekendHolidayTime"] as? String, "09:00")
    XCTAssertEqual(json["earlyEventLeadMinutes"] as? Int, 20)
    XCTAssertEqual(json["holidayRegion"] as? String, "US")
    XCTAssertEqual(json.count, 6)
  }

  // MARK: Brief

  func testReadsABriefDecodingISO8601DatesAndRoleEvent() async throws {
    let transport = RecordingHTTPTransport(responses: [
      HTTPResponse(statusCode: 200, body: briefResponseJSON())
    ])
    let store = makeStore(transport)

    let brief = try await store.brief(localDate: "2026-10-05")

    let decoded = try XCTUnwrap(brief)
    XCTAssertEqual(decoded.localDate, "2026-10-05")
    XCTAssertEqual(decoded.timeZone, "America/Los_Angeles")
    XCTAssertEqual(decoded.title, "Mon 10/5")
    XCTAssertEqual(decoded.body, "You have 1 event.")
    let event = try XCTUnwrap(decoded.facts.events.first)
    XCTAssertEqual(decoded.facts.events.count, 1)
    XCTAssertEqual(event.id, "event-pickup")
    XCTAssertEqual(event.title, "School pickup")
    XCTAssertEqual(event.location, "Lincoln Elementary")
    XCTAssertEqual(event.roles, [.driver])
    XCTAssertEqual(event.scheduledAt, Date(timeIntervalSince1970: 1_791_190_800))
    XCTAssertEqual(event.startTime, Date(timeIntervalSince1970: 1_791_210_600))
    XCTAssertEqual(event.endTime, Date(timeIntervalSince1970: 1_791_212_400))
    XCTAssertEqual(decoded.generatedAt, Date(timeIntervalSince1970: 1_791_187_200))
    XCTAssertTrue(decoded.facts.reminders.isEmpty)

    let requests = await transport.recordedRequests()
    XCTAssertEqual(requests.map(\.method), [.get])
    let request = try XCTUnwrap(requests.first)
    XCTAssertEqual(request.url.path, "/v1/day-briefs/2026-10-05")
    XCTAssertNil(request.body)
    XCTAssertNil(request.headers["Content-Type"])
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
