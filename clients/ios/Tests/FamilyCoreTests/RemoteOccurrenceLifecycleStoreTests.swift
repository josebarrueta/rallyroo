import XCTest
@testable import FamilyCore

final class RemoteOccurrenceLifecycleStoreTests: XCTestCase {
    private func makeStore(
        transport: RecordingTransport = RecordingTransport(),
        token: String = "test-token"
        ) async -> RemoteOccurrenceLifecycleStore {
        let store = RemoteOccurrenceLifecycleStore(
            baseURL: URL(string: "https://example.com")!,
            transport: transport,
            authToken: { token }
         )
        return store
     }

    func testSkipSendsCorrectEndpoint() async throws {
        let transport = RecordingTransport()
        let store = await makeStore(transport: transport, token: "my-token")
        let ref = OccurrenceReference(
            kind: .event,
            seriesID: UUID(uuidString: "00000000-0000-4000-8000-000000000301")!,
            scheduledAt: Date(timeIntervalSince1970: 1_700_000_000)
         )
        try await store.skip(ref, scope: .allFuture)
        let request = await transport.lastRequest
        XCTAssertEqual(request?.method, .post)
        XCTAssertTrue(request?.url.absoluteString.contains("/v1/occurrences/skip") ?? false)
        XCTAssertEqual(request?.headers["Authorization"], "Bearer my-token")
        let body = request?.body
        XCTAssertNotNil(body)
        let decoded = try JSONDecoder().decode([String: String].self, from: body!)
        XCTAssertEqual(decoded["scope"], "all_future")
        XCTAssertEqual(decoded["kind"], "event")
         }

    func testDeleteSendsCorrectEndpoint() async throws {
        let transport = RecordingTransport()
        let store = await makeStore(transport: transport)
        let ref = OccurrenceReference(
            kind: .event,
            seriesID: UUID(uuidString: "00000000-0000-4000-8000-000000000301")!,
            scheduledAt: Date(timeIntervalSince1970: 1_700_000_000)
         )
        try await store.delete(ref, scope: .thisWeekdayFuture)
        let request = await transport.lastRequest
        XCTAssertTrue(request?.url.absoluteString.contains("/v1/occurrences/delete") ?? false)
        let decoded = try JSONDecoder().decode([String: String].self, from: request!.body!)
        XCTAssertEqual(decoded["scope"], "this_weekday_future")
         }

    func testAcknowledgeSendsCorrectEndpoint() async throws {
        let transport = RecordingTransport()
        let store = await makeStore(transport: transport)
        let ref = OccurrenceReference(
            kind: .reminder,
            seriesID: UUID(uuidString: "00000000-0000-4000-8000-000000000401")!,
            scheduledAt: Date(timeIntervalSince1970: 1_700_000_000)
         )
        try await store.acknowledge(ref)
        let request = await transport.lastRequest
        XCTAssertTrue(request?.url.absoluteString.contains("/v1/occurrences/acknowledge") ?? false)
        let decoded = try JSONDecoder().decode([String: String].self, from: request!.body!)
        XCTAssertEqual(decoded["kind"], "reminder")
         }

    func testFailedRequestThrows() async throws {
        let transport = RecordingTransport()
        await transport.setResponse(HTTPResponse(statusCode: 403))
        let store = await makeStore(transport: transport)
        let ref = OccurrenceReference(
            kind: .event,
            seriesID: UUID(uuidString: "00000000-0000-4000-8000-000000000301")!,
            scheduledAt: Date(timeIntervalSince1970: 1_700_000_000)
         )
        do {
            try await store.skip(ref)
            XCTFail("Should have thrown")
             } catch let error as RemoteStoreError {
            if case .requestFailed(statusCode: 403) = error { }
            else { XCTFail("Unexpected error: \(error)") }
             }
         }

    func testSkipSendsIso8601ScheduledAtWithFractionalSeconds() async throws {
        let transport = RecordingTransport()
        let store = try await makeStore(transport: transport)
        let ref = OccurrenceReference(
            kind: .event,
            seriesID: UUID(uuidString: "00000000-0000-4000-8000-000000000301")!,
            scheduledAt: Date(timeIntervalSince1970: 1_700_000_000.123)
          )
        try await store.skip(ref, scope: .thisOccurrence)
        let rawBody = await transport.lastRequest.flatMap { $0.body }
        XCTAssertNotNil(rawBody)
        let decoded = try JSONDecoder().decode([String: String].self, from: rawBody!)
        let scheduled = decoded["scheduledAt"]
        XCTAssertNotNil(scheduled)
        XCTAssertTrue((scheduled ?? "").contains("."), "Should include fractional seconds")
          }

    func testDeleteScopeThisWeekdayFuture() async throws {
        let transport = RecordingTransport()
        let store = try await makeStore(transport: transport)
        let ref = OccurrenceReference(
            kind: .event,
            seriesID: UUID(uuidString: "00000000-0000-4000-8000-000000000301")!,
            scheduledAt: Date(timeIntervalSince1970: 1_700_000_000)
          )
        try await store.delete(ref, scope: .thisWeekdayFuture)
        let request = await transport.lastRequest
        let decoded = try JSONDecoder().decode([String: String].self, from: request!.body!)
        XCTAssertEqual(decoded["scope"], "this_weekday_future")
      }

    func testOccurrenceScopeRawValues() {
        XCTAssertEqual(OccurrenceScope.thisOccurrence.rawValue, "this_occurrence")
        XCTAssertEqual(OccurrenceScope.thisWeekdayFuture.rawValue, "this_weekday_future")
        XCTAssertEqual(OccurrenceScope.allFuture.rawValue, "all_future")
      }
}
