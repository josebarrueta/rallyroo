import Foundation

public enum ConflictNotificationMessage {
    public static func make(
        event: FamilyEvent,
        conflicts: [EventConflict],
        members: [FamilyMember]
    ) -> String {
        guard let conflict = conflicts.first else {
            return ""
        }

        switch conflict.kind {
        case .overlappingKidActivity(let memberID),
             .overlappingParticipantActivity(let memberID):
            let name = members.first { $0.id == memberID }?.name ?? "a family member"
            return "Heads up: \(event.title) overlaps another event for \(name)."
        case .doubleBookedDriver(let driver):
            return "Heads up: \(driver) is already driving another event at this time."
        case .doubleBookedDriverMember(let memberID):
            let name = members.first { $0.id == memberID }?.name ?? "a family member"
            return "Heads up: \(name) is already driving another event at this time."
        }
    }
}
