import Foundation

/// Event data resolved for display without exposing persistence details to a view.
public struct ScheduleEventDisplay: Equatable, Sendable {
    public let event: FamilyEvent
    public let participantNames: [String]
    public let participantColorTags: [String]
    public let primaryColorTag: String?

    public init(event: FamilyEvent, members: [FamilyMember]) {
        self.event = event
        let participants = members.filter { event.participantIDs.contains($0.id) }
        participantNames = participants.map(\.name)
        participantColorTags = participants.map(\.colorTag)
        primaryColorTag = participantColorTags.first
    }

    public func hasEnded(at date: Date) -> Bool {
        event.endTime <= date
    }
}
