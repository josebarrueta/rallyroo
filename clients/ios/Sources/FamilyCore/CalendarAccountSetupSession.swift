import Foundation

public enum CalendarAccountSetupField: String, Sendable {
    case server, username, password, accountURL
}

/// A short-lived, memory-only handoff to iPhone Settings. Deliberately not
/// Codable: switching apps may mask the secret, but must not lose it mid-setup.
public struct CalendarAccountSetupSession: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let connectionID: UUID
    public let serverURL: URL
    public let username: String
    public let timeZone: String?
    public let expiresAt: Date
    private let issuedAt: Date
    private var password: String?

    public init(credentials: CalendarAccountCredentials, now: Date = .now) {
        connectionID = credentials.id
        serverURL = credentials.serverURL
        username = credentials.username
        timeZone = credentials.timeZone
        issuedAt = now
        expiresAt = now.addingTimeInterval(600)
        password = credentials.password
    }

    public func copyValue(for field: CalendarAccountSetupField, at now: Date = .now) -> String? {
        switch field {
        case .server: serverURL.host
        case .accountURL: serverURL.absoluteString
        case .username: username
        case .password: now >= issuedAt && now < expiresAt ? password : nil
        }
    }

    public mutating func clearPassword() { password = nil }

    public var description: String { "CalendarAccountSetupSession(<redacted>)" }
    public var debugDescription: String { description }
}
