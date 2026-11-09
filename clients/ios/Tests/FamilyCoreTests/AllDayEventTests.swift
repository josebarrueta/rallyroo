import XCTest
@testable import FamilyCore

final class AllDayEventTests: XCTestCase {
    private func instant(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }
    private func calendar(_ zone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone)!
        return calendar
    }

    func testAllDayDatesKeepExclusiveBoundsAcrossDSTAndDisplayTimeZones() throws {
        let allDay = try EventAllDay(startDate: "2027-03-14", endDate: "2027-03-15", timeZone: "America/Los_Angeles")
        let anchored = allDay.dateInterval()
        XCTAssertEqual(anchored.start, instant("2027-03-14T08:00:00Z"))
        XCTAssertEqual(anchored.end, instant("2027-03-15T07:00:00Z"))
        XCTAssertEqual(anchored.duration, 23 * 3600)
        XCTAssertEqual(allDay.inclusiveEndDate, "2027-03-14")
        let tokyo = allDay.dateInterval(in: TimeZone(identifier: "Asia/Tokyo")!)
        XCTAssertEqual(tokyo.start, instant("2027-03-13T15:00:00Z"))
        XCTAssertEqual(tokyo.end, instant("2027-03-14T15:00:00Z"))
    }

    func testInvalidDateBoundsAndTimeZonesAreRejectedRatherThanNormalized() throws {
        for (start, end, zone) in [
            ("2027-02-30", "2027-03-03", "UTC"),
            ("2027-03-14", "2027-03-14", "UTC"),
            ("2027-03-15", "2027-03-14", "UTC"),
            ("2027-03-14", "2027-03-15", "Not/AZone"),
            ("2027-3-14", "2027-03-15", "UTC"),
        ] {
            XCTAssertThrowsError(try EventAllDay(startDate: start, endDate: end, timeZone: zone))
        }
    }

    func testMidnightDSTGapsFoldsAndSkippedDatesMatchTheBackendAnchorRules() throws {
        let gap = try EventAllDay(startDate: "2018-11-04", endDate: "2018-11-05", timeZone: "America/Sao_Paulo")
        XCTAssertEqual(gap.dateInterval().start, instant("2018-11-04T03:00:00Z"))
        XCTAssertEqual(gap.dateInterval().duration, 23 * 3600)
        let fold = try EventAllDay(startDate: "2018-11-04", endDate: "2018-11-05", timeZone: "America/Havana")
        XCTAssertEqual(fold.dateInterval().start, instant("2018-11-04T04:00:00Z"))
        XCTAssertEqual(fold.dateInterval().duration, 25 * 3600)
        XCTAssertThrowsError(try EventAllDay(startDate: "2011-12-30", endDate: "2011-12-31", timeZone: "Pacific/Apia"))
    }

    func testStoresRejectStaleDateMetadataBeforeWritingOrSendingIt() async throws {
        let allDay = try EventAllDay(startDate: "2027-03-14", endDate: "2027-03-15", timeZone: "America/Los_Angeles")
        let event = FamilyEvent(title: "Invalid stale dates", kidID: nil, startTime: allDay.dateInterval().start.addingTimeInterval(3600),
            endTime: allDay.dateInterval().end, allDay: allDay, source: .manual, status: .confirmed)
        let transport = AllDayRecordingTransport()
        let file = FileManager.default.temporaryDirectory.appending(path: "all-day-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: file) }
        let local = LocalEventStore(storageURL: file)
        let remote = RemoteEventStore(baseURL: URL(string: "https://api.example")!, transport: transport)
        for store in [local as any EventStore, remote as any EventStore] {
            do {
                _ = try await store.save(event, notifyParticipants: false, idempotencyKey: UUID())
                XCTFail("Expected invalid date metadata")
            } catch { XCTAssertEqual(error as? EventValidationError, .invalidAllDayDates) }
        }
        let requests = await transport.count()
        XCTAssertEqual(requests, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testDateOnlyMetadataSurvivesCodingAndNilExplicitlyClearsItForTheServer() throws {
        let allDay = try EventAllDay(startDate: "2027-03-14", endDate: "2027-03-15", timeZone: "America/Los_Angeles")
        var event = FamilyEvent(title: "Family day", kidID: nil, startTime: allDay.dateInterval().start,
            endTime: allDay.dateInterval().end, allDay: allDay, source: .manual, status: .confirmed)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let encoded = try encoder.encode(event)
        XCTAssertEqual(try decoder.decode(FamilyEvent.self, from: encoded), event)
        event.allDay = nil
        event.alertLeadTime = nil
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(event)) as? [String: Any])
        XCTAssertTrue(json["allDay"] is NSNull)
        XCTAssertTrue(json["alertLeadTimeMinutes"] is NSNull)
        var legacy = json
        legacy.removeValue(forKey: "allDay")
        XCTAssertNil(try decoder.decode(FamilyEvent.self, from: JSONSerialization.data(withJSONObject: legacy)).allDay)
    }

    func testMultiDayOccurrenceAppearsOnEveryCoveredDisplayDateAndNotItsExclusiveEnd() throws {
        let allDay = try EventAllDay(startDate: "2027-03-13", endDate: "2027-03-16", timeZone: "America/Los_Angeles")
        let event = FamilyEvent(title: "Family break", kidID: nil, startTime: allDay.dateInterval().start,
            endTime: allDay.dateInterval().end, allDay: allDay, source: .manual, status: .confirmed)
        let displayCalendar = calendar("Asia/Tokyo")
        let middleDay = instant("2027-03-13T15:00:00Z") // March 14 in Tokyo
        let range = DateInterval(start: middleDay, end: displayCalendar.date(byAdding: .day, value: 1, to: middleDay)!)
        let occurrences = EventOccurrenceExpander.occurrences(of: [event], in: range, calendar: displayCalendar)
        XCTAssertEqual(occurrences.count, 1)
        XCTAssertEqual(occurrences.first?.scheduledAt, event.startTime)
        XCTAssertEqual(occurrences.first?.sourceEvent, event)
        XCTAssertTrue(event.occurs(on: middleDay, calendar: displayCalendar))
        XCTAssertFalse(event.occurs(on: instant("2027-03-15T15:00:00Z"), calendar: displayCalendar)) // March 16
        XCTAssertFalse(ScheduleEventDisplay(event: event, members: []).hasEnded(at: middleDay, calendar: displayCalendar))
    }
}

private actor AllDayRecordingTransport: HTTPTransport {
    private var requests = 0
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests += 1
        return HTTPResponse(statusCode: 200, body: Data("{\"conflicts\":[],\"notificationOutcome\":\"notRequested\"}".utf8))
    }
    func count() -> Int { requests }
}
