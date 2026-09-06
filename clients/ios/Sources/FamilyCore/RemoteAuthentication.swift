import CryptoKit
import Foundation

public enum RemoteAuthenticationError: Error, Equatable {
    case invalidOAuthCallback
}

public actor RemoteAuthentication: Authentication {
    private struct OAuthTokenExchange: Encodable {
        let oauthToken: String
        let codeVerifier: String
        let invitationCode: String?
    }

    private let authorizationBaseURL: URL
    private let sessionsURL: URL
    private let accountURL: URL
    private let transport: any HTTPTransport
    private let webSession: any OAuthWebSession
    private let sessionStore: any AuthSessionStore
    private var session: AuthSession?

    public init(
        baseURL: URL,
        transport: any HTTPTransport,
        webSession: any OAuthWebSession,
        sessionStore: any AuthSessionStore
    ) {
        authorizationBaseURL = baseURL.appending(path: "v1/auth")
        sessionsURL = baseURL.appending(path: "v1/sessions")
        accountURL = baseURL.appending(path: "v1/account")
        self.transport = transport
        self.webSession = webSession
        self.sessionStore = sessionStore
    }

    @MainActor
    public init(
        baseURL: URL,
        transport: any HTTPTransport = URLSessionHTTPTransport()
    ) {
        self.init(
            baseURL: baseURL,
            transport: transport,
            webSession: SystemOAuthWebSession(),
            sessionStore: KeychainAuthSessionStore()
        )
    }

    public func currentSession() async throws -> AuthSession? {
        if let session { return session }
        guard let stored = try await sessionStore.load(), let token = stored.accessToken else {
            return nil
        }
        let response: HTTPResponse
        do {
            response = try await transport.send(HTTPRequest(
                method: .get,
                url: sessionsURL,
                headers: ["Authorization": "Bearer \(token)"]
            ))
        } catch {
            // A previously validated, device-bound session can unlock that account's
            // protected last-good cache while the network is unavailable.
            session = stored
            return stored
        }
        if response.statusCode == 401 || response.statusCode == 403 {
            try await sessionStore.delete()
            return nil
        }
        if response.statusCode >= 500 {
            session = stored
            return stored
        }
        try response.requireSuccess()
        let validated = try JSONDecoder().decode(AuthSession.self, from: response.body)
        try await sessionStore.save(validated)
        session = validated
        return validated
    }

    public func signIn(
        with provider: AuthenticationProvider,
        invitationCode: String?
    ) async throws -> AuthSession {
        let codeVerifier = UUID().uuidString + UUID().uuidString
        let digest = SHA256.hash(data: Data(codeVerifier.utf8))
        let codeChallenge = Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let authorizationURL = authorizationBaseURL.appending(path: provider.rawValue)
        var components = URLComponents(url: authorizationURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "codeChallenge", value: codeChallenge)]
        guard let securedAuthorizationURL = components?.url else {
            throw RemoteAuthenticationError.invalidOAuthCallback
        }
        let callbackURL = try await webSession.authenticate(
            using: securedAuthorizationURL,
            callbackScheme: "rallyroo"
        )
        guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              components.queryItems?.first(where: { $0.name == "stytch_token_type" })?.value == "oauth",
              let oauthToken = components.queryItems?.first(where: { $0.name == "token" })?.value,
              !oauthToken.isEmpty else {
            throw RemoteAuthenticationError.invalidOAuthCallback
        }
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: sessionsURL,
            headers: ["Content-Type": "application/json"],
            body: try JSONEncoder().encode(OAuthTokenExchange(
                oauthToken: oauthToken,
                codeVerifier: codeVerifier,
                invitationCode: invitationCode
            ))
        ))
        try response.requireSuccess()
        let authenticatedSession = try JSONDecoder().decode(AuthSession.self, from: response.body)
        try await sessionStore.save(authenticatedSession)
        session = authenticatedSession
        return authenticatedSession
    }

    public func signOut() async throws {
        guard let activeSession = try await currentSession() else {
            try await sessionStore.delete()
            return
        }
        let headers = activeSession.accessToken.map { ["Authorization": "Bearer \($0)"] } ?? [:]
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: sessionsURL,
            headers: headers
        ))
        try response.requireSuccess()
        try await sessionStore.delete()
        self.session = nil
    }

    public func deleteAccount() async throws {
        let activeSession: AuthSession?
        if let session {
            activeSession = session
        } else {
            activeSession = try await sessionStore.load()
        }
        guard let activeSession else {
            try await sessionStore.delete()
            return
        }
        let headers = activeSession.accessToken.map { ["Authorization": "Bearer \($0)"] } ?? [:]
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: accountURL,
            headers: headers
        ))
        try response.requireSuccess()
        try await sessionStore.delete()
        self.session = nil
    }
}
