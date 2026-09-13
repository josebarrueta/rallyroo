import Foundation
import XCTest

@testable import FamilyCore

final class ArrivalTimeTests: XCTestCase {
    // MARK: - Codable

    func testDecodingJSONWithoutArrivalTimeYieldsNil() throws {
        let event = FamilyEvent(
            id: UUID(uuidString: "10000000-0000-4000-8000-000000000001")!,
            title: "Practice",
            kidID: KidID(rawValue: "jake"),
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )

        let data = try JSONEncoder().encode(event)

        XCTAssertFalse(String(data: data, encoding: .utf8)!.contains("arrivalTime"))
        let decoded = try JSONDecoder().decode(FamilyEvent.self, from: data)
        XCTAssertNil(decoded.arrivalTime)
    }

    func testArrivalTimeRoundtripsThroughJSON() throws {
        let event = FamilyEvent(
            id: UUID(uuidString: "10000000-0000-4000-8000-000000000002")!,
            title: "Car pickup",
            kidID: KidID(rawValue: "emma"),
            startTime: Date(timeIntervalSince1970: 1_735_845_200),
            endTime: Date(timeIntervalSince1970: 1_735_848_800),
            arrivalTime: Date(timeIntervalSince1970: 1_735_841_600),
            source: .manual,
            status: .confirmed
        )

        let data = try JSONEncoder().encode(event)
        let decoded = try JSONDecoder().decode(FamilyEvent.self, from: data)

        XCTAssertTrue(
            data.contains(Data("arrivalTime".utf8)), "arrivalTime must be present in the payload")
        XCTAssertEqual(decoded, event)
        XCTAssertEqual(decoded.arrivalTime, event.arrivalTime)
    }

    // MARK: - LocalEventStore validation

    func testLocalEventStoreRejectsArrivalAfterStart() async throws {
        let store = LocalEventStore(storageURL: temporaryStorageURL())
        let event = FamilyEvent(
            title: "Practice",
            kidID: KidID(rawValue: "jake"),
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            arrivalTime: Date(timeIntervalSince1970: 1_735_843_400),
            source: .manual,
            status: .confirmed
        )

        do {
            _ = try await store.save(event)
            XCTFail("Expected the store to reject an arrival time after start")
        } catch let error as EventValidationError {
            XCTAssertEqual(error, .arrivalTimeMustNotFollowStartTime)
        }
    }

    func testLocalEventStoreRejectsArrivalAfterStartWhenUpdatingRecurring() async throws {
        let calendar = utcCalendar()
        let start = calendar.date(from: DateComponents(year: 2026, month: 9, day: 2, hour: 16))!
        let source = FamilyEvent(
            id: UUID(uuidString: "30000000-0000-4000-8000-000000000001")!,
            title: "Practice",
            kidID: KidID(rawValue: "jake"),
            startTime: start,
            endTime: start.addingTimeInterval(3_600),
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                endDate: calendar.date(
                    from: DateComponents(year: 2026, month: 12, day: 31, hour: 16))!
            )
        )
        let store = LocalEventStore(storageURL: temporaryStorageURL())
        try await store.save(source)

        let editedStart = start.addingTimeInterval(7 * 24 * 60 * 60)
        var edited = source
        edited.title = "Carpool"
        edited.startTime = editedStart
        edited.endTime = editedStart.addingTimeInterval(3_600)
        edited.arrivalTime = editedStart.addingTimeInterval(30 * 60)
        let edit = RecurringEventEdit(
            sourceEventID: source.id,
            editedEvent: edited,
            scope: .allFuture,
            occurrenceStart: editedStart
        )

        do {
            _ = try await store.updateRecurringEvent(
                edit, notifyParticipants: false, idempotencyKey: UUID())
            XCTFail("Expected the store to reject an arrival time after start")
        } catch let error as EventValidationError {
            XCTAssertEqual(error, .arrivalTimeMustNotFollowStartTime)
        }
    }

    // MARK: - Occurrence expansion

    func testOccurrenceExpansionPreservesArrivalOffset() {
        let calendar = utcCalendar()
        let start = calendar.date(from: DateComponents(year: 2026, month: 9, day: 2, hour: 16))!
        let event = FamilyEvent(
            title: "Practice",
            kidID: KidID(rawValue: "jake"),
            startTime: start,
            endTime: start.addingTimeInterval(3_600),
            arrivalTime: start.addingTimeInterval(-30 * 60),
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                endDate: calendar.date(
                    from: DateComponents(year: 2026, month: 12, day: 31, hour: 16))!
            )
        )
        let range = DateInterval(
            start: start.addingTimeInterval(-60 * 60),
            end: calendar.date(from: DateComponents(year: 2026, month: 12, day: 31, hour: 23))!
        )
        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event], in: range, calendar: calendar)

        XCTAssertFalse(occurrences.isEmpty)
        for occurrence in occurrences {
            guard let arrival = occurrence.event.arrivalTime else {
                XCTFail("Every occurrence must carry the arrival time")
                continue
            }
            let offset = arrival.timeIntervalSince(occurrence.event.startTime)
            XCTAssertEqual(offset, -30 * 60, accuracy: 0.001)
        }
    }

    // MARK: - Recurring edit continuation

    func testRecurringEditContinuationPreservesArrivalOffset() throws {
        let calendar = utcCalendar()
        let source = FamilyEvent(
            id: UUID(uuidString: "40000000-0000-4000-8000-000000000001")!,
            title: "Practice",
            kidID: KidID(rawValue: "jake"),
            startTime: calendar.date(from: DateComponents(year: 2026, month: 9, day: 2, hour: 16))!,
            endTime: calendar.date(from: DateComponents(year: 2026, month: 9, day: 2, hour: 17))!,
            arrivalTime: calendar.date(
                from: DateComponents(year: 2026, month: 9, day: 2, hour: 15))!,
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                endDate: calendar.date(
                    from: DateComponents(year: 2026, month: 12, day: 31, hour: 16))!
            )
        )
        let occurrenceStart = calendar.date(
            from: DateComponents(year: 2026, month: 9, day: 9, hour: 16))!
        let edited = FamilyEvent(
            id: source.id,
            title: "Carpool",
            kidID: source.kidID,
            participantIDs: source.participantIDs,
            startTime: occurrenceStart,
            endTime: occurrenceStart.addingTimeInterval(3_600),
            arrivalTime: occurrenceStart.addingTimeInterval(-30 * 60),
            source: source.source,
            status: source.status,
            recurrence: source.recurrence
        )

        let plan = try RecurringEventEditPlanner.plan(
            edited: edited,
            source: source,
            scope: .thisOccurrence,
            occurrenceStart: occurrenceStart,
            calendar: calendar,
            makeID: idSequence()
        )

        let editedOccurrence = try XCTUnwrap(plan.upserts.first { $0.recurrence == nil })
        XCTAssertEqual(
            try XCTUnwrap(editedOccurrence.arrivalTime).timeIntervalSince1970,
            occurrenceStart.addingTimeInterval(-30 * 60).timeIntervalSince1970,
            accuracy: 0.001
        )
        let continuationStart = calendar.date(
            from: DateComponents(year: 2026, month: 9, day: 16, hour: 16))!
        let continuation = try XCTUnwrap(
            plan.upserts.first {
                $0.recurrence != nil && $0.startTime == continuationStart
            })
        XCTAssertEqual(
            try XCTUnwrap(continuation.arrivalTime).timeIntervalSince1970,
            continuationStart.addingTimeInterval(-60 * 60).timeIntervalSince1970,
            accuracy: 0.001
        )
    }

    // MARK: - Helpers

    private func utcCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.firstWeekday = 7
        return calendar
    }

    private func temporaryStorageURL() -> URL {
        FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appendingPathExtension("json")
    }

    private func idSequence() -> () -> UUID {
        { UUID() }
    }
}
