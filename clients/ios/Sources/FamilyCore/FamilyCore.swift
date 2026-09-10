import Foundation

public struct KidID: Codable, Hashable, Sendable {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        rawValue = try container.decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public enum EventSource: String, Codable, Sendable {
    case manual
    case emailSuggested = "email_suggested"
    case voice
    case calendar
}

public struct EventProvenance: Codable, Equatable, Sendable {
    public let sourceID: String
    public let sourceName: String
    public let externalUID: String

    public init(sourceID: String, sourceName: String, externalUID: String) {
        self.sourceID = sourceID
        self.sourceName = sourceName
        self.externalUID = externalUID
    }
}

public enum EventStatus: String, Codable, Sendable {
    case confirmed
    case pendingReview = "pending_review"
}

public enum EventAlertLeadTime: Int, Codable, CaseIterable, Sendable {
    case atStart = 0
    case fiveMinutes = 5
    case fifteenMinutes = 15
    case oneHour = 60
    case oneDay = 1_440
}

public struct FamilyEvent: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public var title: String
    public var kidID: KidID?
    public var participantIDs: [KidID]
    public var startTime: Date
    public var endTime: Date
    public var location: String?
    public var driver: String?
    public var driverMemberID: KidID?
    public var source: EventSource
    public var status: EventStatus
    public var alertLeadTime: EventAlertLeadTime?
    public var recurrence: EventRecurrence?
    public var isReadOnly: Bool
    public var provenance: [EventProvenance]

    private enum CodingKeys: String, CodingKey {
        case id, title, kidID, participantIDs, startTime, endTime, location
        case driver, driverMemberID, source, status, recurrence, provenance
        case alertLeadTime = "alertLeadTimeMinutes"
        case isReadOnly = "readOnly"
    }

    public init(
        id: UUID = UUID(),
        title: String,
        kidID: KidID?,
        participantIDs: [KidID] = [],
        startTime: Date,
        endTime: Date,
        location: String? = nil,
        driver: String? = nil,
        driverMemberID: KidID? = nil,
        source: EventSource,
        status: EventStatus,
        alertLeadTime: EventAlertLeadTime? = .atStart,
        recurrence: EventRecurrence? = nil,
        isReadOnly: Bool = false,
        provenance: [EventProvenance] = []
    ) {
        self.id = id
        self.title = title
        self.kidID = kidID
        self.participantIDs = participantIDs.isEmpty ? kidID.map { [$0] } ?? [] : participantIDs
        self.startTime = startTime
        self.endTime = endTime
        self.location = location
        self.driver = driver
        self.driverMemberID = driverMemberID
        self.source = source
        self.status = status
        self.alertLeadTime = alertLeadTime
        self.recurrence = recurrence
        self.isReadOnly = isReadOnly
        self.provenance = provenance
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        kidID = try container.decodeIfPresent(KidID.self, forKey: .kidID)
        participantIDs = try container.decodeIfPresent([KidID].self, forKey: .participantIDs) ?? []
        startTime = try container.decode(Date.self, forKey: .startTime)
        endTime = try container.decode(Date.self, forKey: .endTime)
        location = try container.decodeIfPresent(String.self, forKey: .location)
        driver = try container.decodeIfPresent(String.self, forKey: .driver)
        driverMemberID = try container.decodeIfPresent(KidID.self, forKey: .driverMemberID)
        source = try container.decode(EventSource.self, forKey: .source)
        status = try container.decode(EventStatus.self, forKey: .status)
        alertLeadTime = try container.decodeIfPresent(EventAlertLeadTime.self, forKey: .alertLeadTime)
        recurrence = try container.decodeIfPresent(EventRecurrence.self, forKey: .recurrence)
        isReadOnly = try container.decodeIfPresent(Bool.self, forKey: .isReadOnly) ?? false
        provenance = try container.decodeIfPresent([EventProvenance].self, forKey: .provenance) ?? []
    }
}

public enum EventValidationError: Error, Equatable, Sendable {
    case endTimeMustFollowStartTime
}

public struct EventConflict: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case overlappingKidActivity(KidID)
        case overlappingParticipantActivity(KidID)
        case doubleBookedDriver(String)
        case doubleBookedDriverMember(KidID)
    }

    public let kind: Kind
    public let eventIDs: [UUID]

    public init(kind: Kind, eventIDs: [UUID]) {
        self.kind = kind
        self.eventIDs = eventIDs
    }
}

public enum ScheduleUpdateNotificationOutcome: String, Codable, Equatable, Sendable {
    case sent
    case queuedForRetry
    case noRecipients
    case notRequested
}

public struct EventMutationResult: Equatable, Sendable {
    public let conflicts: [EventConflict]
    public let notificationOutcome: ScheduleUpdateNotificationOutcome

    public init(
        conflicts: [EventConflict],
        notificationOutcome: ScheduleUpdateNotificationOutcome
    ) {
        self.conflicts = conflicts
        self.notificationOutcome = notificationOutcome
    }
}

public enum EventDataFreshness: Equatable, Sendable {
    case fresh
    case cached
}

public struct EventSnapshot: Equatable, Sendable {
    public let events: [FamilyEvent]
    public let freshness: EventDataFreshness

    public init(events: [FamilyEvent], freshness: EventDataFreshness) {
        self.events = events
        self.freshness = freshness
    }
}

/// Backend-neutral persistence boundary for family events.
///
/// The app depends on this protocol; local and remote backends supply conforming
/// implementations without exposing their transport or storage details.
public protocol EventAlertScheduler: Sendable {
    func schedule(_ event: FamilyEvent) async throws
    func cancel(_ event: FamilyEvent) async
}

public protocol EventStore: Sendable {
    @discardableResult
    func save(
        _ event: FamilyEvent,
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult
    func delete(_ event: FamilyEvent, idempotencyKey: UUID) async throws
    func loadEvents() async throws -> EventSnapshot
    func clearCache() async throws
}

public extension EventStore {
    @discardableResult
    func save(_ event: FamilyEvent, notifyParticipants: Bool = true) async throws -> [EventConflict] {
        try await save(
            event,
            notifyParticipants: notifyParticipants,
            idempotencyKey: UUID()
        ).conflicts
    }

    func delete(_ event: FamilyEvent) async throws {
        try await delete(event, idempotencyKey: UUID())
    }

    func events() async throws -> [FamilyEvent] {
        try await loadEvents().events
    }

    func clearCache() async throws {}
}

public actor LocalEventStore: EventStore {
    private let storageURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(storageURL: URL) {
        self.storageURL = storageURL
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    @discardableResult
    public func save(
        _ event: FamilyEvent,
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult {
        guard event.endTime > event.startTime else {
            throw EventValidationError.endTimeMustFollowStartTime
        }

        var savedEvents = try await events()
        savedEvents.removeAll { $0.id == event.id }
        let conflicts = conflicts(for: event, against: savedEvents)
        savedEvents.append(event)
        try write(savedEvents)
        return EventMutationResult(
            conflicts: conflicts,
            notificationOutcome: notifyParticipants ? .noRecipients : .notRequested
        )
    }

    public func delete(_ event: FamilyEvent, idempotencyKey: UUID) async throws {
        var savedEvents = try await events()
        savedEvents.removeAll { $0.id == event.id }
        try write(savedEvents)
    }

    public func loadEvents() async throws -> EventSnapshot {
        EventSnapshot(events: try storedEvents(), freshness: .fresh)
    }

    private func storedEvents() throws -> [FamilyEvent] {
        guard FileManager.default.fileExists(atPath: storageURL.path) else {
            return []
        }

        return try decoder.decode([FamilyEvent].self, from: Data(contentsOf: storageURL))
    }

    private func conflicts(for event: FamilyEvent, against savedEvents: [FamilyEvent]) -> [EventConflict] {
        let allEvents = [event] + savedEvents
        let rangeStart = allEvents.map(\.startTime).min() ?? event.startTime
        let rangeEnd = allEvents.map {
            max($0.recurrence?.endDate ?? $0.startTime, $0.endTime)
        }.max() ?? event.endTime
        let range = DateInterval(start: rangeStart, end: rangeEnd.addingTimeInterval(24 * 60 * 60))
        let eventOccurrences = EventOccurrenceExpander.occurrences(of: [event], in: range)

        return savedEvents.compactMap { savedEvent in
            let savedOccurrences = EventOccurrenceExpander.occurrences(of: [savedEvent], in: range)
            let overlaps = eventOccurrences.contains { occurrence in
                savedOccurrences.contains { savedOccurrence in
                    occurrence.event.startTime < savedOccurrence.event.endTime
                        && savedOccurrence.event.startTime < occurrence.event.endTime
                }
            }
            guard overlaps else { return nil }

            if let kidID = event.kidID, kidID == savedEvent.kidID {
                return EventConflict(
                    kind: .overlappingKidActivity(kidID),
                    eventIDs: [savedEvent.id, event.id]
                )
            }

            if let participantID = event.participantIDs.first(where: { savedEvent.participantIDs.contains($0) }) {
                return EventConflict(
                    kind: .overlappingParticipantActivity(participantID),
                    eventIDs: [savedEvent.id, event.id]
                )
            }

            if let driverMemberID = event.driverMemberID,
               driverMemberID == savedEvent.driverMemberID {
                return EventConflict(
                    kind: .doubleBookedDriverMember(driverMemberID),
                    eventIDs: [savedEvent.id, event.id]
                )
            }

            if event.driverMemberID == nil, savedEvent.driverMemberID == nil,
               let driver = event.driver, !driver.isEmpty, driver == savedEvent.driver {
                return EventConflict(
                    kind: .doubleBookedDriver(driver),
                    eventIDs: [savedEvent.id, event.id]
                )
            }

            return nil
        }
    }

    private func write(_ events: [FamilyEvent]) throws {
        try FileManager.default.createDirectory(
            at: storageURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try encoder.encode(events).write(to: storageURL, options: .atomic)
    }
}
