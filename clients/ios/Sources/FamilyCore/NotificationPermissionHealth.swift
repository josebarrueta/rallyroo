import Foundation

public struct NotificationPermissionHealth: Equatable, Sendable {
    public enum Authorization: String, Sendable { case notRequested, denied, authorized, provisional, ephemeral }
    public let authorization: Authorization
    public let alertsEnabled: Bool
    public let badgesEnabled: Bool

    public init(authorization: Authorization, alertsEnabled: Bool, badgesEnabled: Bool) {
        self.authorization = authorization; self.alertsEnabled = alertsEnabled; self.badgesEnabled = badgesEnabled
    }
    public var title: String {
        switch authorization {
        case .notRequested: "Not enabled yet"
        case .denied: "Notifications blocked"
        case .authorized: alertsEnabled ? "Notifications allowed" : "Notification alerts disabled"
        case .provisional: "Quiet notifications allowed"
        case .ephemeral: "Notifications allowed temporarily"
        }
    }
    public var guidance: String {
        switch authorization {
        case .notRequested: "Enable notifications to receive schedule and reminder alerts outside the app."
        case .denied: "Allow notifications in iPhone Settings. Your in-app Alerts remain available."
        default: "\(alertsEnabled ? "Notification alerts are enabled." : "Visible notification alerts are disabled.") \(badgesEnabled ? "App-icon badges are enabled." : "App-icon badges are disabled; the in-app unread count still works.") Permission does not guarantee delivery; Focus and network conditions also matter."
        }
    }
    public var canRequest: Bool { authorization == .notRequested }
    public var canOpenSettings: Bool { authorization != .notRequested }
}

public protocol NotificationPermissionProvider: Sendable {
    func health() async -> NotificationPermissionHealth
    func request() async throws -> Bool
}
