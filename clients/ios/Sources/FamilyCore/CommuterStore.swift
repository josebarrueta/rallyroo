import Foundation

public enum CommuterAgencyID: String, Codable, Sendable {
    case caltrain = "CT"
}

public enum CommuterInstallationStatus: String, Codable, Sendable {
    case enabled
    case disabled
}

public enum CommuteSubscriptionVisibility: String, Codable, Sendable {
    case personal
    case family
}

public enum CommuteSubscriptionStatus: String, Codable, Sendable {
    case active
    case paused
}

public enum CommuteAlertKind: String, Codable, Sendable {
    case delay
    case cancellation
}

public struct CommuterInstallation: Codable, Equatable, Sendable {
    public let enabledByMemberID: String
    public let status: CommuterInstallationStatus

    public init(enabledByMemberID: String, status: CommuterInstallationStatus) {
        self.enabledByMemberID = enabledByMemberID
        self.status = status
    }
}

public struct CommuteSubscription: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let ownerMemberID: String
    public let visibility: CommuteSubscriptionVisibility
    public let agencyID: CommuterAgencyID
    public let routeID: String
    public let directionID: String
    public let originStopID: String
    public let destinationStopID: String
    public let serviceWeekdays: [Int]
    public let windowStartMinutes: Int
    public let windowEndMinutes: Int
    public let alertKinds: [CommuteAlertKind]
    public let minimumDelayMinutes: Int
    public let status: CommuteSubscriptionStatus
}

public struct CommuteSubscriptionDraft: Codable, Equatable, Sendable {
    public let visibility: CommuteSubscriptionVisibility
    public let agencyID: CommuterAgencyID
    public let routeID: String
    public let directionID: String
    public let originStopID: String
    public let destinationStopID: String
    public let serviceWeekdays: [Int]
    public let windowStartMinutes: Int
    public let windowEndMinutes: Int
    public let alertKinds: [CommuteAlertKind]
    public let minimumDelayMinutes: Int

    public init(
        visibility: CommuteSubscriptionVisibility,
        routeID: String,
        directionID: String,
        originStopID: String,
        destinationStopID: String,
        serviceWeekdays: [Int],
        windowStartMinutes: Int,
        windowEndMinutes: Int,
        alertKinds: [CommuteAlertKind],
        minimumDelayMinutes: Int
    ) {
        self.visibility = visibility
        agencyID = .caltrain
        self.routeID = routeID
        self.directionID = directionID
        self.originStopID = originStopID
        self.destinationStopID = destinationStopID
        self.serviceWeekdays = serviceWeekdays
        self.windowStartMinutes = windowStartMinutes
        self.windowEndMinutes = windowEndMinutes
        self.alertKinds = alertKinds
        self.minimumDelayMinutes = minimumDelayMinutes
    }
}

public struct CommuterState: Codable, Equatable, Sendable {
    public let installation: CommuterInstallation?
    public let subscriptions: [CommuteSubscription]
}

public protocol CommuterStore: Sendable {
    func state() async throws -> CommuterState
    func enable() async throws -> CommuterInstallation
    func disable() async throws
    func removeModule() async throws
    func createSubscription(_ draft: CommuteSubscriptionDraft) async throws -> CommuteSubscription
    func setStatus(
        _ status: CommuteSubscriptionStatus,
        for subscription: CommuteSubscription
    ) async throws -> CommuteSubscription
    func remove(_ subscription: CommuteSubscription) async throws
}
