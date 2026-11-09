import XCTest
@testable import FamilyCore

final class VoiceEventCreationServiceTests: XCTestCase {
    func testCreatesOneHourVoiceEventAndReturnsConflicts() async throws {
        let eventStore = RecordingVoiceEventStore(result: EventMutationResult(
            conflicts: [EventConflict(kind: .overlappingParticipantActivity(KidID(rawValue: "kid-1")), eventIDs: [])],
            notificationOutcome: .sent
        ))
        let service = VoiceEventCreationService(eventStore: eventStore)
        let start = Date(timeIntervalSince1970: 1_800_000_000)

        let result = try await service.create(VoiceEventCreationRequest(
            title: "  Soccer practice  ",
            startTime: start,
            location: "  Community field  ",
            notes: "  Bring water  "
        ), idempotencyKey: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!)

        XCTAssertEqual(result.event.title, "Soccer practice")
        XCTAssertEqual(result.event.startTime, start)
        XCTAssertEqual(result.event.endTime, start.addingTimeInterval(3_600))
        XCTAssertEqual(result.event.location, "Community field")
        XCTAssertEqual(result.event.notes, "Bring water")
        XCTAssertEqual(result.event.source, .voice)
        XCTAssertEqual(result.event.status, .confirmed)
        XCTAssertEqual(result.conflicts.count, 1)

        let recordedRequest = await eventStore.savedRequest()
        let saved = try XCTUnwrap(recordedRequest)
        XCTAssertEqual(saved.event, result.event)
        XCTAssertTrue(saved.notifyParticipants)
        XCTAssertEqual(saved.idempotencyKey, UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!)
    }

    func testResolvesMemberNameWithoutSilentlyDroppingParticipant() async throws {
        let memberStore = StubVoiceMemberStore(members: [
            FamilyMember(id: KidID(rawValue: "alex"), name: "Alex", role: .kid, colorTag: "Blue"),
        ])
        let eventStore = RecordingVoiceEventStore()
        let service = VoiceEventCreationService(eventStore: eventStore, memberStore: memberStore)

        let result = try await service.create(VoiceEventCreationRequest(
            title: "Dentist",
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            memberName: " alex "
        ))

        XCTAssertEqual(result.event.participantIDs, [KidID(rawValue: "alex")])
    }

    func testResolvesMultipleMemberNamesAndDeduplicatesParticipants() async throws {
        let alexID = KidID(rawValue: "alex")
        let samID = KidID(rawValue: "sam")
        let memberStore = StubVoiceMemberStore(members: [
            FamilyMember(id: alexID, name: "Alex", role: .kid, colorTag: "Blue"),
            FamilyMember(id: samID, name: "Sam", role: .parent, colorTag: "Green"),
        ])
        let service = VoiceEventCreationService(
            eventStore: RecordingVoiceEventStore(),
            memberStore: memberStore
        )

        let result = try await service.create(VoiceEventCreationRequest(
            title: "Dinner",
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            participantIDs: [alexID],
            memberNames: ["Alex", "Sam"]
        ))

        XCTAssertEqual(result.event.participantIDs, [alexID, samID])
    }

    func testRejectsMissingAndAmbiguousMembers() async throws {
        let members = [
            FamilyMember(id: KidID(rawValue: "alex-1"), name: "Alex", role: .kid, colorTag: "Blue"),
            FamilyMember(id: KidID(rawValue: "alex-2"), name: "Alex", role: .parent, colorTag: "Green"),
        ]
        let service = VoiceEventCreationService(
            eventStore: RecordingVoiceEventStore(),
            memberStore: StubVoiceMemberStore(members: members)
        )
        let request = VoiceEventCreationRequest(
            title: "Dentist",
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            memberName: "Alex"
        )

        do {
            _ = try await service.create(request)
            XCTFail("Expected ambiguous member error")
        } catch {
            XCTAssertEqual(error as? VoiceEventCreationError, .ambiguousMember("Alex"))
        }

        let missingService = VoiceEventCreationService(
            eventStore: RecordingVoiceEventStore(),
            memberStore: StubVoiceMemberStore(members: [])
        )
        do {
            _ = try await missingService.create(request)
            XCTFail("Expected missing member error")
        } catch {
            XCTAssertEqual(error as? VoiceEventCreationError, .memberNotFound("Alex"))
        }
    }

    func testRejectsBlankTitleAndInvalidEndTime() async throws {
        let service = VoiceEventCreationService(eventStore: RecordingVoiceEventStore())
        let start = Date(timeIntervalSince1970: 1_800_000_000)

        do {
            _ = try await service.create(VoiceEventCreationRequest(title: "   ", startTime: start))
            XCTFail("Expected blank title error")
        } catch {
            XCTAssertEqual(error as? VoiceEventCreationError, .emptyTitle)
        }

        do {
            _ = try await service.create(VoiceEventCreationRequest(
                title: "Practice",
                startTime: start,
                endTime: start
            ))
            XCTFail("Expected invalid end time error")
        } catch {
            XCTAssertEqual(error as? VoiceEventCreationError, .endTimeMustFollowStartTime)
        }
    }

    func testPreservesRecurrenceOnCreatedEvent() async throws {
        let service = VoiceEventCreationService(eventStore: RecordingVoiceEventStore())
        let recurrence = EventRecurrence(
            frequency: .weekly,
            weekdays: [.monday, .wednesday],
            endDate: Date(timeIntervalSince1970: 1_810_000_000),
            timeZone: "America/Los_Angeles"
        )

        let result = try await service.create(VoiceEventCreationRequest(
            title: "Practice",
            startTime: Date(timeIntervalSince1970: 1_800_000_000),
            recurrence: recurrence
        ))

        XCTAssertEqual(result.event.recurrence, recurrence)
    }

    func testAllDayEventUsesCalendarDayBoundaries() async throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let input = calendar.date(from: DateComponents(year: 2027, month: 3, day: 14, hour: 15))!
        let service = VoiceEventCreationService(
            eventStore: RecordingVoiceEventStore(),
            calendar: calendar
        )

        let result = try await service.create(VoiceEventCreationRequest(
            title: "Family day",
            startTime: input,
            isAllDay: true
        ))

        let expectedStart = calendar.startOfDay(for: input)
        XCTAssertEqual(result.event.startTime, expectedStart)
        XCTAssertEqual(result.event.endTime, calendar.date(byAdding: .day, value: 1, to: expectedStart))
        XCTAssertEqual(result.event.allDay, try EventAllDay(startDate: "2027-03-14", endDate: "2027-03-15", timeZone: "America/Los_Angeles"))
        XCTAssertNil(result.event.alertLeadTime)
    }

    func testRejectsAllDayRecurrenceBeforeSavingRatherThanCreatingAnUnsupportedSeries() async throws {
        let store = RecordingVoiceEventStore()
        let service = VoiceEventCreationService(eventStore: store)
        do {
            _ = try await service.create(VoiceEventCreationRequest(title: "Family day", startTime: .now, isAllDay: true,
                recurrence: EventRecurrence(frequency: .daily, endDate: .now.addingTimeInterval(86400))))
            XCTFail("Expected unsupported all-day recurrence")
        } catch {
            XCTAssertEqual(error as? VoiceEventCreationError, .allDayRecurrenceUnsupported)
        }
        let saved = await store.savedRequest()
        XCTAssertNil(saved)
    }
}

private actor RecordingVoiceEventStore: EventStore {
    struct SavedRequest: Sendable {
        let event: FamilyEvent
        let notifyParticipants: Bool
        let idempotencyKey: UUID
    }

    private let result: EventMutationResult
    private var saved: SavedRequest?

    init(result: EventMutationResult = EventMutationResult(conflicts: [], notificationOutcome: .sent)) {
        self.result = result
    }

    func savedRequest() -> SavedRequest? { saved }

    func save(_ event: FamilyEvent, notifyParticipants: Bool, idempotencyKey: UUID) async throws -> EventMutationResult {
        saved = SavedRequest(event: event, notifyParticipants: notifyParticipants, idempotencyKey: idempotencyKey)
        return result
    }

    func delete(_ event: FamilyEvent, idempotencyKey: UUID) async throws {}
    func updateRecurringEvent(_ edit: RecurringEventEdit, notifyParticipants: Bool, idempotencyKey: UUID) async throws -> EventMutationResult { result }
    func loadEvents() async throws -> EventSnapshot { EventSnapshot(events: [], freshness: .fresh) }
    func saveImportedEventSettings(for event: FamilyEvent, arrivalTime: Date?, alertLeadTime: EventAlertLeadTime?, driver: String?, driverMemberID: KidID?) async throws -> FamilyEvent { event }
    func clearCache() async throws {}
}

private actor StubVoiceMemberStore: FamilyMemberStore {
    private let storedMembers: [FamilyMember]

    init(members: [FamilyMember]) { storedMembers = members }

    func save(_ member: FamilyMember) async throws {}
    func delete(_ member: FamilyMember) async throws {}
    func members() async throws -> [FamilyMember] { storedMembers }
}
