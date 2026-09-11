import Foundation
import XCTest
@testable import FamilyCore

final class EventStoreTests: XCTestCase {
    func testCreatesAndListsAnEvent() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let event = FamilyEvent(
            title: "Soccer practice",
            kidID: KidID(rawValue: "jake"),
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            location: "North Field",
            driver: "Parent 1",
            source: .manual,
            status: .confirmed
        )

        try await repository.save(event)

        let savedEvents = try await repository.events()
        XCTAssertEqual(savedEvents, [event])
    }

    func testReportsAnOverlappingActivityForTheSameKid() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let kidID = KidID(rawValue: "emma")
        let practice = FamilyEvent(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            title: "Basketball practice",
            kidID: kidID,
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )
        let game = FamilyEvent(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!,
            title: "Soccer game",
            kidID: kidID,
            startTime: Date(timeIntervalSince1970: 1_735_843_400),
            endTime: Date(timeIntervalSince1970: 1_735_847_000),
            source: .manual,
            status: .confirmed
        )
        try await repository.save(practice)

        let conflicts = try await repository.save(game)

        XCTAssertEqual(conflicts, [
            EventConflict(
                kind: .overlappingKidActivity(kidID),
                eventIDs: [practice.id, game.id]
            ),
        ])
    }

    func testReportsADoubleBookedDriverAcrossKids() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let practice = FamilyEvent(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!,
            title: "Basketball practice",
            kidID: KidID(rawValue: "emma"),
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            driver: "Parent 1",
            source: .manual,
            status: .confirmed
        )
        let game = FamilyEvent(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000004")!,
            title: "Soccer game",
            kidID: KidID(rawValue: "jake"),
            startTime: Date(timeIntervalSince1970: 1_735_843_400),
            endTime: Date(timeIntervalSince1970: 1_735_847_000),
            driver: "Parent 1",
            source: .manual,
            status: .confirmed
        )
        try await repository.save(practice)

        let conflicts = try await repository.save(game)

        XCTAssertEqual(conflicts, [
            EventConflict(
                kind: .doubleBookedDriver("Parent 1"),
                eventIDs: [practice.id, game.id]
            ),
        ])
    }

    func testReportsAConflictOnAFutureRecurringOccurrence() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let kidID = KidID(rawValue: "emma")
        let start = Date(timeIntervalSince1970: 1_735_841_600)
        let existing = FamilyEvent(
            title: "Doctor appointment",
            kidID: kidID,
            startTime: start.addingTimeInterval(7 * 24 * 60 * 60),
            endTime: start.addingTimeInterval(7 * 24 * 60 * 60 + 3600),
            source: .manual,
            status: .confirmed
        )
        let recurring = FamilyEvent(
            title: "Soccer practice",
            kidID: kidID,
            startTime: start,
            endTime: start.addingTimeInterval(3600),
            source: .manual,
            status: .confirmed,
            recurrence: EventRecurrence(
                frequency: .weekly,
                endDate: start.addingTimeInterval(14 * 24 * 60 * 60)
            )
        )
        try await repository.save(existing)

        let conflicts = try await repository.save(recurring)

        XCTAssertEqual(conflicts.first?.kind, .overlappingKidActivity(kidID))
    }

    func testRejectsAnEventWhoseEndTimeIsNotAfterItsStartTime() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let event = FamilyEvent(
            title: "Invalid practice",
            kidID: KidID(rawValue: "emma"),
            startTime: Date(timeIntervalSince1970: 1_735_845_200),
            endTime: Date(timeIntervalSince1970: 1_735_841_600),
            source: .manual,
            status: .confirmed
        )

        do {
            _ = try await repository.save(event)
            XCTFail("Expected the store to reject an invalid time range")
        } catch let error as EventValidationError {
            XCTAssertEqual(error, .endTimeMustFollowStartTime)
        }
    }

    func testReportsAnOverlappingActivityForTheSameParent() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let parentID = KidID(rawValue: "parent-1")
        let workMeeting = FamilyEvent(
            title: "Work meeting",
            kidID: nil,
            participantIDs: [parentID],
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )
        let doctorAppointment = FamilyEvent(
            title: "Doctor appointment",
            kidID: nil,
            participantIDs: [parentID],
            startTime: Date(timeIntervalSince1970: 1_735_843_400),
            endTime: Date(timeIntervalSince1970: 1_735_847_000),
            source: .manual,
            status: .confirmed
        )
        try await repository.save(workMeeting)

        let conflicts = try await repository.save(doctorAppointment)

        XCTAssertEqual(conflicts, [
            EventConflict(
                kind: .overlappingParticipantActivity(parentID),
                eventIDs: [workMeeting.id, doctorAppointment.id]
            ),
        ])
    }

    func testRenamingARecurringEventDoesNotConflictWithTheSameSeries() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let eventID = UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEA")!
        let start = Date(timeIntervalSince1970: 1_735_848_800)
        let recurrence = EventRecurrence(
            frequency: .weekly,
            endDate: start.addingTimeInterval(12 * 7 * 24 * 60 * 60)
        )
        let original = FamilyEvent(
            id: eventID,
            title: "Weekly practice",
            kidID: KidID(rawValue: "jake"),
            startTime: start,
            endTime: start.addingTimeInterval(3_600),
            source: .manual,
            status: .confirmed,
            recurrence: recurrence
        )
        let renamed = FamilyEvent(
            id: eventID,
            title: "Renamed weekly practice",
            kidID: KidID(rawValue: "jake"),
            startTime: start,
            endTime: start.addingTimeInterval(3_600),
            source: .manual,
            status: .confirmed,
            recurrence: recurrence
        )
        try await repository.save(original)

        let conflicts = try await repository.save(renamed)

        let savedEvents = try await repository.events()
        XCTAssertEqual(conflicts, [])
        XCTAssertEqual(savedEvents, [renamed])
    }

    func testEditingAnEventStillReportsAConflictWithASeparateEvent() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let kidID = KidID(rawValue: "jake")
        let existing = FamilyEvent(
            title: "Soccer practice",
            kidID: kidID,
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )
        let eventID = UUID(uuidString: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEB")!
        let original = FamilyEvent(
            id: eventID,
            title: "Doctor appointment",
            kidID: kidID,
            startTime: Date(timeIntervalSince1970: 1_735_848_800),
            endTime: Date(timeIntervalSince1970: 1_735_852_400),
            source: .manual,
            status: .confirmed
        )
        let edited = FamilyEvent(
            id: eventID,
            title: "Earlier doctor appointment",
            kidID: kidID,
            startTime: Date(timeIntervalSince1970: 1_735_843_400),
            endTime: Date(timeIntervalSince1970: 1_735_847_000),
            source: .manual,
            status: .confirmed
        )
        try await repository.save(existing)
        try await repository.save(original)

        let conflicts = try await repository.save(edited)

        XCTAssertEqual(conflicts, [
            EventConflict(
                kind: .overlappingKidActivity(kidID),
                eventIDs: [existing.id, edited.id]
            ),
        ])
    }

    func testUpdatesAnEventWithTheSameID() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let eventID = UUID(uuidString: "00000000-0000-0000-0000-000000000005")!
        let originalEvent = FamilyEvent(
            id: eventID,
            title: "Soccer practice",
            kidID: KidID(rawValue: "jake"),
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )
        let updatedEvent = FamilyEvent(
            id: eventID,
            title: "Soccer game",
            kidID: KidID(rawValue: "jake"),
            startTime: Date(timeIntervalSince1970: 1_735_843_400),
            endTime: Date(timeIntervalSince1970: 1_735_847_000),
            source: .manual,
            status: .confirmed
        )
        try await repository.save(originalEvent)

        try await repository.save(updatedEvent)

        let savedEvents = try await repository.events()
        XCTAssertEqual(savedEvents, [updatedEvent])
    }

    func testAtomicallyAppliesAndReplaysARecurringWeekdayEditLocally() async throws {
        let storageURL = temporaryStorageURL()
        var repository: any EventStore = LocalEventStore(storageURL: storageURL)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .autoupdatingCurrent
        func date(_ day: Int) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: 16))!
        }
        let source = FamilyEvent(
            id: UUID(uuidString: "30000000-0000-4000-8000-000000000001")!,
            title: "Practice",
            kidID: KidID(rawValue: "kid-1"),
            startTime: date(2),
            endTime: date(2).addingTimeInterval(3_600),
            driverMemberID: KidID(rawValue: "parent-1"),
            source: .manual,
            status: .confirmed,
            alertLeadTime: .fifteenMinutes,
            recurrence: EventRecurrence(
                frequency: .weekly,
                weekdays: [.wednesday, .thursday],
                endDate: date(30)
            )
        )
        try await repository.save(source)
        let occurrenceStart = date(10)
        var edited = source
        edited.title = "Thursday carpool"
        edited.startTime = occurrenceStart
        edited.endTime = occurrenceStart.addingTimeInterval(45 * 60)
        edited.driverMemberID = KidID(rawValue: "parent-2")
        edited.alertLeadTime = .fortyFiveMinutes
        let edit = RecurringEventEdit(
            sourceEventID: source.id,
            editedEvent: edited,
            scope: .thisWeekdayAndFuture,
            occurrenceStart: occurrenceStart
        )
        let idempotencyKey = UUID(uuidString: "30000000-0000-4000-8000-000000000002")!

        _ = try await repository.updateRecurringEvent(
            edit, notifyParticipants: false, idempotencyKey: idempotencyKey
        )
        let afterFirstSave = try await repository.events()
        repository = LocalEventStore(storageURL: storageURL)
        _ = try await repository.updateRecurringEvent(
            edit, notifyParticipants: false, idempotencyKey: idempotencyKey
        )
        let afterReplay = try await repository.events()

        XCTAssertEqual(afterReplay, afterFirstSave)
        XCTAssertEqual(afterReplay.count, 3)
        let range = DateInterval(start: date(1), end: date(30).addingTimeInterval(24 * 60 * 60))
        let occurrences = EventOccurrenceExpander.occurrences(of: afterReplay, in: range, calendar: calendar)
        XCTAssertEqual(occurrences.first { $0.event.startTime == date(9) }?.event.title, "Practice")
        XCTAssertEqual(occurrences.first { $0.event.startTime == date(10) }?.event.title, "Thursday carpool")
        XCTAssertEqual(occurrences.first { $0.event.startTime == date(16) }?.event.title, "Practice")
        XCTAssertEqual(occurrences.first { $0.event.startTime == date(17) }?.event.title, "Thursday carpool")

        let thursdayRow = afterReplay.first { $0.title == "Thursday carpool" }!
        var allFuture = thursdayRow
        allFuture.title = "All future carpool"
        allFuture.startTime = date(17)
        allFuture.endTime = date(17).addingTimeInterval(45 * 60)
        _ = try await repository.updateRecurringEvent(
            RecurringEventEdit(
                sourceEventID: thursdayRow.id,
                editedEvent: allFuture,
                scope: .allFuture,
                occurrenceStart: date(17)
            ),
            notifyParticipants: false,
            idempotencyKey: UUID(uuidString: "30000000-0000-4000-8000-000000000003")!
        )
        let finalRows = try await repository.events()
        let finalOccurrences = EventOccurrenceExpander.occurrences(of: finalRows, in: range, calendar: calendar)
        XCTAssertEqual(finalOccurrences.first { $0.event.startTime == date(16) }?.event.title, "Practice")
        XCTAssertEqual(finalOccurrences.first { $0.event.startTime == date(17) }?.event.title, "All future carpool")
        XCTAssertEqual(finalOccurrences.first { $0.event.startTime == date(23) }?.event.title, "All future carpool")
        XCTAssertEqual(finalOccurrences.first { $0.event.startTime == date(24) }?.event.title, "All future carpool")
    }

    func testDeletesAnEvent() async throws {
        let repository: any EventStore = LocalEventStore(storageURL: temporaryStorageURL())
        let event = FamilyEvent(
            title: "Soccer practice",
            kidID: KidID(rawValue: "jake"),
            startTime: Date(timeIntervalSince1970: 1_735_841_600),
            endTime: Date(timeIntervalSince1970: 1_735_845_200),
            source: .manual,
            status: .confirmed
        )
        try await repository.save(event)

        try await repository.delete(event)

        let savedEvents = try await repository.events()
        XCTAssertEqual(savedEvents, [])
    }

    private func temporaryStorageURL() -> URL {
        FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString)
            .appendingPathExtension("json")
    }
}
