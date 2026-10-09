import Foundation

public enum AccountRole: String, Codable, Equatable, Sendable {
    case parent
    case kid
}

public enum AuthenticationProvider: String, CaseIterable, Equatable, Sendable {
    case apple
    case google
}

public struct AuthSession: Codable, Equatable, Sendable {
    public let accountID: String
    public let displayName: String
    public let role: AccountRole
    public let accessToken: String?

    public init(
        accountID: String,
        displayName: String,
        role: AccountRole,
        accessToken: String? = nil
    ) {
        self.accountID = accountID
        self.displayName = displayName
        self.role = role
        self.accessToken = accessToken
    }
}

/// Vendor-neutral authentication seam used by local and remote adapters.
public protocol Authentication: Sendable {
    func currentSession() async throws -> AuthSession?
    func signIn(
        with provider: AuthenticationProvider,
        invitationCode: String?
    ) async throws -> AuthSession
    func signOut() async throws
    func deleteAccount() async throws
}

/// Authentication adapters that can discard a locally cached session without
/// attempting a remote sign-out after the server has already rejected it.
public protocol SessionInvalidatingAuthentication: Authentication {
    /// Invalidates only when the rejected token is still current, so a late
    /// response from an older request cannot sign out a newly authenticated session.
    func invalidateSession(rejectedAccessToken: String) async throws -> Bool
}

public extension Notification.Name {
    static let authenticationSessionDidExpire = Notification.Name(
        "dev.rallyroo.authenticationSessionDidExpire"
    )
}

public extension Authentication {
    func signIn(invitationCode: String?) async throws -> AuthSession {
        try await signIn(with: .google, invitationCode: invitationCode)
    }

    func signIn() async throws -> AuthSession {
        try await signIn(with: .google, invitationCode: nil)
    }
}

public actor LocalAuthentication: Authentication {
    private var session: AuthSession?

    public init() {
        session = Self.localParentSession
    }

    public func currentSession() async throws -> AuthSession? {
        session
    }

    public func signIn(
        with provider: AuthenticationProvider,
        invitationCode: String?
    ) async throws -> AuthSession {
        session = Self.localParentSession
        return Self.localParentSession
    }

    public func signOut() async throws {
        session = nil
    }

    public func deleteAccount() async throws {
        session = nil
    }

    private static let localParentSession = AuthSession(
        accountID: "local-parent",
        displayName: "Local Parent",
        role: .parent
    )
}
