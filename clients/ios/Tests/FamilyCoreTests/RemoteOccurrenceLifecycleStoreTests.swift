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

    func testRestoreSendsCorrectEndpoint() async throws {
        let transport = RecordingTransport()
        let store = await makeStore(transport: transport)
        let ref = OccurrenceReference(
            kind: .event,
            seriesID: UUID(uuidString: "00000000-0000-4000-8000-000000000301")!,
            scheduledAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        try await store.restore(ref, scope: .thisOccurrence)

        let request = await transport.lastRequest
        XCTAssertTrue(request?.url.absoluteString.contains("/v1/occurrences/restore") ?? false)
        let decoded = try JSONDecoder().decode([String: String].self, from: request!.body!)
        XCTAssertEqual(decoded["scope"], "this_occurrence")
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

    func testLegacyTuesdayDeletionSendsTheCalendarUsedForExpansion() async throws {
        let formatter = ISO8601DateFormatter()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let event = FamilyEvent(
            id: UUID(uuidString: "00000000-0000-4000-8000-000000000301")!,
            title: "Practice",
            kidID: nil,
            participantIDs: [],
            startTime: formatter.date(from: "2026-11-04T03:30:00Z")!,
            endTime: formatter.date(from: "2026-11-04T05:00:00Z")!,
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                weekdays: [.tuesday],
                endDate: formatter.date(from: "2027-03-06T23:26:43Z")!
            )
        )
        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event],
            in: DateInterval(
                start: formatter.date(from: "2026-11-10T00:00:00Z")!,
                end: formatter.date(from: "2026-11-12T00:00:00Z")!
            ),
            calendar: calendar
        )
        let occurrence = try XCTUnwrap(occurrences.first)
        let transport = RecordingTransport()
        let store = await makeStore(transport: transport)
        try await store.delete(occurrence.lifecycleReference(calendar: calendar), scope: .allFuture)
        let request = await transport.lastRequest
        let decoded = try JSONDecoder().decode([String: String].self, from: request!.body!)
        XCTAssertEqual(decoded["scheduledAt"], "2026-11-11T03:30:00.000Z")
        XCTAssertEqual(decoded["timeZone"], "America/Los_Angeles")
        XCTAssertEqual(decoded["scope"], "all_future")
    }

    func testSavedTimezoneTakesPrecedenceOverTheDeviceCalendar() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let event = FamilyEvent(
            title: "Practice", kidID: nil, participantIDs: [],
            startTime: start, endTime: start.addingTimeInterval(3600),
            source: .manual, status: .confirmed,
            recurrence: EventRecurrence(frequency: .weekly, endDate: start, timeZone: "America/New_York")
        )
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let occurrence = EventOccurrence(id: "test", event: event, sourceEvent: event)
        XCTAssertEqual(occurrence.lifecycleReference(calendar: calendar).timeZone, "America/New_York")
    }

    func testOccurrenceScopeRawValues() {
        XCTAssertEqual(OccurrenceScope.thisOccurrence.rawValue, "this_occurrence")
        XCTAssertEqual(OccurrenceScope.thisWeekdayFuture.rawValue, "this_weekday_future")
        XCTAssertEqual(OccurrenceScope.allFuture.rawValue, "all_future")
      }
}
