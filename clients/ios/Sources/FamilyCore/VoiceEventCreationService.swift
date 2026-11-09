import Foundation

public struct VoiceEventCreationRequest: Equatable, Sendable {
    public let title: String
    public let startTime: Date
    public let endTime: Date?
    public let isAllDay: Bool
    public let participantIDs: [KidID]
    public let memberName: String?
    public let memberNames: [String]
    public let location: String?
    public let notes: String?
    public let recurrence: EventRecurrence?

    public init(
        title: String,
        startTime: Date,
        endTime: Date? = nil,
        isAllDay: Bool = false,
        participantIDs: [KidID] = [],
        memberName: String? = nil,
        memberNames: [String] = [],
        location: String? = nil,
        notes: String? = nil,
        recurrence: EventRecurrence? = nil
    ) {
        self.title = title
        self.startTime = startTime
        self.endTime = endTime
        self.isAllDay = isAllDay
        self.participantIDs = participantIDs
        self.memberName = memberName
        self.memberNames = memberNames
        self.location = location
        self.notes = notes
        self.recurrence = recurrence
    }
}

public struct VoiceEventCreationResult: Equatable, Sendable {
    public let event: FamilyEvent
    public let conflicts: [EventConflict]

    public init(event: FamilyEvent, conflicts: [EventConflict]) {
        self.event = event
        self.conflicts = conflicts
    }
}

public enum VoiceEventCreationError: Error, Equatable, Sendable {
    case emptyTitle
    case endTimeMustFollowStartTime
    case allDayRecurrenceUnsupported
    case memberStoreUnavailable
    case memberNotFound(String)
    case ambiguousMember(String)
}

public actor VoiceEventCreationService {
    private let eventStore: any EventStore
    private let memberStore: (any FamilyMemberStore)?
    private var calendar: Calendar

    public init(
        eventStore: any EventStore,
        memberStore: (any FamilyMemberStore)? = nil,
        calendar: Calendar = .autoupdatingCurrent
    ) {
        self.eventStore = eventStore
        self.memberStore = memberStore
        self.calendar = calendar
    }

    public func create(
        _ request: VoiceEventCreationRequest,
        idempotencyKey: UUID = UUID()
    ) async throws -> VoiceEventCreationResult {
        let title = request.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw VoiceEventCreationError.emptyTitle }
        if request.isAllDay && request.recurrence != nil { throw VoiceEventCreationError.allDayRecurrenceUnsupported }

        let startTime: Date
        let endTime: Date
        if request.isAllDay {
            startTime = calendar.startOfDay(for: request.startTime)
            endTime = request.endTime.map { calendar.startOfDay(for: $0) }
                ?? calendar.date(byAdding: .day, value: 1, to: startTime)!
        } else {
            startTime = request.startTime
            endTime = request.endTime ?? request.startTime.addingTimeInterval(3_600)
        }
        guard endTime > startTime else {
            throw VoiceEventCreationError.endTimeMustFollowStartTime
        }

        let allDay: EventAllDay?
        if request.isAllDay {
            allDay = try EventAllDay(startDate: EventAllDay.dateString(for: startTime, in: calendar.timeZone),
                endDate: EventAllDay.dateString(for: endTime, in: calendar.timeZone), timeZone: calendar.timeZone.identifier)
        } else { allDay = nil }

        var participantIDs = request.participantIDs
        let requestedNames = (request.memberNames + [request.memberName].compactMap { $0 })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if !requestedNames.isEmpty {
            guard let memberStore else {
                throw VoiceEventCreationError.memberStoreUnavailable
            }
            let members = try await memberStore.members()
            for memberName in requestedNames {
                let matches = members.filter {
                    $0.name.compare(
                        memberName,
                        options: [.caseInsensitive, .diacriticInsensitive],
                        range: nil,
                        locale: .autoupdatingCurrent
                    ) == .orderedSame
                }
                guard !matches.isEmpty else {
                    throw VoiceEventCreationError.memberNotFound(memberName)
                }
                guard matches.count == 1 else {
                    throw VoiceEventCreationError.ambiguousMember(memberName)
                }
                participantIDs.append(matches[0].id)
            }
        }
        participantIDs = participantIDs.reduce(into: []) { result, id in
            if !result.contains(id) { result.append(id) }
        }

        let event = FamilyEvent(
            title: title,
            kidID: nil,
            participantIDs: participantIDs,
            startTime: startTime,
            endTime: endTime,
            allDay: allDay,
            location: normalized(request.location),
            notes: normalized(request.notes),
            source: .voice,
            status: .confirmed,
            alertLeadTime: request.isAllDay ? nil : .atStart,
            recurrence: request.recurrence
        )
        let mutation = try await eventStore.save(
            event,
            notifyParticipants: true,
            idempotencyKey: idempotencyKey
        )
        return VoiceEventCreationResult(event: event, conflicts: mutation.conflicts)
    }

    private func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
