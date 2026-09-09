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

public enum CommuterProviderHealth: String, Codable, Sendable {
    case unavailable
    case healthy
    case degraded
    case stale
}

public struct CommuterProviderFeedStatus: Codable, Equatable, Sendable {
    public let state: CommuterProviderHealth
    public let lastSuccessAt: Date?
    public let lastAttemptAt: Date?
}

public struct CommuterProviderStatus: Codable, Equatable, Sendable {
    public let catalog: CommuterProviderFeedStatus
    public let realtime: CommuterProviderFeedStatus
}

public enum CaltrainDirection: String, Codable, Sendable {
    case northbound
    case southbound
    case unknown
}

public struct CaltrainStop: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let stationID: String
    public let stationName: String
    public let direction: CaltrainDirection
    public let latitude: Double
    public let longitude: Double
    public let validFrom: Date
    public let validUntil: Date
}

public struct CaltrainCatalog: Codable, Equatable, Sendable {
    public let status: CommuterProviderFeedStatus
    public let observedAt: Date?
    public let stops: [CaltrainStop]
}

public struct CommuterState: Codable, Equatable, Sendable {
    public let installation: CommuterInstallation?
    public let subscriptions: [CommuteSubscription]
    public let providerStatus: CommuterProviderStatus
}

public protocol CommuterStore: Sendable {
    func state() async throws -> CommuterState
    func catalog() async throws -> CaltrainCatalog
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
