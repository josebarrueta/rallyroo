import CryptoKit
import Foundation
import XCTest
@testable import FamilyCore

final class RemoteAuthenticationTests: XCTestCase {
    func testSignsInThroughBackendOwnedGoogleOAuthAndStoresSession() async throws {
        let expectedSession = AuthSession(
            accountID: "account-1",
            displayName: "Alex",
            role: .parent,
            accessToken: "secret-token"
        )
        let transport = AuthenticationHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: try JSONEncoder().encode(expectedSession)),
            HTTPResponse(statusCode: 200, body: try JSONEncoder().encode(expectedSession))
        ])
        let webSession = StubOAuthWebSession(
            callbackURL: URL(string: "rallyroo://oauth-callback?stytch_token_type=oauth&token=oauth-token")!
        )
        let sessionStore = TestAuthSessionStore()
        let authentication: any Authentication = RemoteAuthentication(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport,
            webSession: webSession,
            sessionStore: sessionStore
        )

        let session = try await authentication.signIn()

        XCTAssertEqual(session, expectedSession)
        let restoredAuthentication: any Authentication = RemoteAuthentication(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport,
            webSession: webSession,
            sessionStore: sessionStore
        )
        let currentSession = try await restoredAuthentication.currentSession()
        XCTAssertEqual(currentSession, expectedSession)
        let requests = await transport.recordedRequests()
        XCTAssertEqual(requests.map(\.method), [.post, .get])
        XCTAssertEqual(requests.map(\.url.path), ["/v1/sessions", "/v1/sessions"])
        let exchange = try XCTUnwrap(requests.first?.body)
        let tokenExchange = try JSONDecoder().decode(OAuthTokenExchange.self, from: exchange)
        XCTAssertEqual(tokenExchange.oauthToken, "oauth-token")
        let webRequest = await webSession.recordedRequest()
        XCTAssertEqual(webRequest.authorizationPath, "/v1/auth/google")
        XCTAssertEqual(webRequest.callbackScheme, "rallyroo")
        let digest = SHA256.hash(data: Data(tokenExchange.codeVerifier.utf8))
        let expectedChallenge = Data(digest).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        XCTAssertEqual(webRequest.challenge, expectedChallenge)
    }

    func testRestoresTheStoredSessionWhenValidationIsOffline() async throws {
        let storedSession = AuthSession(
            accountID: "account-1",
            displayName: "Alex",
            role: .parent,
            accessToken: "secret-token"
        )
        let sessionStore = TestAuthSessionStore()
        try await sessionStore.save(storedSession)
        let authentication: any Authentication = RemoteAuthentication(
            baseURL: URL(string: "https://api.example.com")!,
            transport: OfflineAuthenticationHTTPTransport(),
            webSession: StubOAuthWebSession(
                callbackURL: URL(string: "rallyroo://oauth-callback")!
            ),
            sessionStore: sessionStore
        )

        let restored = try await authentication.currentSession()

        XCTAssertEqual(restored, storedSession)
    }

    func testDeletesTheRemoteAccountAndClearsTheStoredSession() async throws {
        let storedSession = AuthSession(
            accountID: "account-1",
            displayName: "Alex",
            role: .parent,
            accessToken: "secret-token"
        )
        let sessionStore = TestAuthSessionStore()
        try await sessionStore.save(storedSession)
        let transport = AuthenticationHTTPTransport(responses: [
            HTTPResponse(statusCode: 204, body: Data())
        ])
        let authentication: any Authentication = RemoteAuthentication(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport,
            webSession: StubOAuthWebSession(
                callbackURL: URL(string: "rallyroo://oauth-callback")!
            ),
            sessionStore: sessionStore
        )

        try await authentication.deleteAccount()

        let savedSession = try await sessionStore.load()
        XCTAssertNil(savedSession)
        let requests = await transport.recordedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, .delete)
        XCTAssertEqual(request.url.path, "/v1/account")
        XCTAssertEqual(request.headers["Authorization"], "Bearer secret-token")
    }

    func testSignsInWithAppleThroughTheBackendOwnedOAuthFlow() async throws {
        let expectedSession = AuthSession(
            accountID: "account-1",
            displayName: "Alex",
            role: .parent,
            accessToken: "secret-token"
        )
        let transport = AuthenticationHTTPTransport(responses: [
            HTTPResponse(statusCode: 200, body: try JSONEncoder().encode(expectedSession))
        ])
        let webSession = StubOAuthWebSession(
            callbackURL: URL(string: "rallyroo://oauth-callback?stytch_token_type=oauth&token=apple-oauth-token")!
        )
        let authentication: any Authentication = RemoteAuthentication(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport,
            webSession: webSession,
            sessionStore: TestAuthSessionStore()
        )

        let session = try await authentication.signIn(with: .apple, invitationCode: nil)

        XCTAssertEqual(session, expectedSession)
        let webRequest = await webSession.recordedRequest()
        XCTAssertEqual(webRequest.authorizationPath, "/v1/auth/apple")
        XCTAssertEqual(webRequest.callbackScheme, "rallyroo")
    }
}

private struct OAuthTokenExchange: Codable {
    let oauthToken: String
    let codeVerifier: String
}

private actor StubOAuthWebSession: OAuthWebSession {
    struct Request {
        let authorizationPath: String?
        let callbackScheme: String?
        let challenge: String?
    }

    let callbackURL: URL
    private var request = Request(authorizationPath: nil, callbackScheme: nil, challenge: nil)

    init(callbackURL: URL) {
        self.callbackURL = callbackURL
    }

    func authenticate(using authorizationURL: URL, callbackScheme: String) async throws -> URL {
        let components = URLComponents(url: authorizationURL, resolvingAgainstBaseURL: false)
        request = Request(
            authorizationPath: components?.path,
            callbackScheme: callbackScheme,
            challenge: components?.queryItems?.first(where: { $0.name == "codeChallenge" })?.value
        )
        return callbackURL
    }

    func recordedRequest() -> Request { request }
}

private actor TestAuthSessionStore: AuthSessionStore {
    private var session: AuthSession?
    func load() async throws -> AuthSession? { session }
    func save(_ session: AuthSession) async throws { self.session = session }
    func delete() async throws { session = nil }
}

private struct OfflineAuthenticationError: Error {}

private actor OfflineAuthenticationHTTPTransport: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw OfflineAuthenticationError()
    }
}

private actor AuthenticationHTTPTransport: HTTPTransport {
    private var responses: [HTTPResponse]
    private var requests: [HTTPRequest] = []
    init(responses: [HTTPResponse]) { self.responses = responses }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        requests.append(request)
        return responses.removeFirst()
    }
    func recordedRequests() -> [HTTPRequest] { requests }
}
