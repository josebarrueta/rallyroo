import Foundation

public struct LocalAlertSlot: Equatable, Sendable {
    public let identifier: String
    public let fireAt: Date

    public init(identifier: String, fireAt: Date) {
        self.identifier = identifier
        self.fireAt = fireAt
    }
}

public struct LocalAlertAdmission: Equatable, Sendable {
    public let shouldSchedule: Bool
    public let identifierToRemove: String?

    public init(shouldSchedule: Bool, identifierToRemove: String? = nil) {
        self.shouldSchedule = shouldSchedule
        self.identifierToRemove = identifierToRemove
    }
}

public enum LocalAlertQueuePlanner {
    public static func admission(
        pending: [LocalAlertSlot],
        adding candidate: LocalAlertSlot,
        capacity: Int
    ) -> LocalAlertAdmission {
        guard capacity > 0 else { return LocalAlertAdmission(shouldSchedule: false) }
        if pending.contains(where: { $0.identifier == candidate.identifier }) {
            return LocalAlertAdmission(shouldSchedule: true)
        }
        guard pending.count >= capacity else {
            return LocalAlertAdmission(shouldSchedule: true)
        }
        guard let farthest = pending.max(by: {
            if $0.fireAt == $1.fireAt { return $0.identifier < $1.identifier }
            return $0.fireAt < $1.fireAt
        }), candidate.fireAt < farthest.fireAt else {
            return LocalAlertAdmission(shouldSchedule: false)
        }
        return LocalAlertAdmission(
            shouldSchedule: true,
            identifierToRemove: farthest.identifier
        )
    }
}
