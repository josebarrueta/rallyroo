import Foundation
import XCTest
@testable import FamilyCore

final class AuthenticatedHTTPTransportTests: XCTestCase {
    func testAddsTheCurrentBearerToken() async throws {
        let baseTransport = BearerRecordingTransport(statusCode: 200)
        let authentication = TokenAuthentication()
        let transport: any HTTPTransport = AuthenticatedHTTPTransport(
            transport: baseTransport,
            authentication: authentication
        )

        _ = try await transport.send(HTTPRequest(
            method: .get,
            url: URL(string: "https://api.example.com/v1/events")!
        ))

        let request = await baseTransport.lastRequest()
        XCTAssertEqual(request?.headers["Authorization"], "Bearer secret-token")
    }

    func testForbiddenResponseDoesNotExpireAValidSession() async throws {
        let authentication = TokenAuthentication()
        let transport: any HTTPTransport = AuthenticatedHTTPTransport(
            transport: BearerRecordingTransport(statusCode: 403),
            authentication: authentication
        )

        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: URL(string: "https://api.example.com/v1/parent-only-action")!
        ))

        XCTAssertEqual(response.statusCode, 403)
        let session = try await authentication.currentSession()
        XCTAssertNotNil(session)
    }

    func testInvalidatesTheSessionAndPublishesExpirationAfterUnauthorizedResponse() async throws {
        let baseTransport = BearerRecordingTransport(statusCode: 401)
        let authentication = TokenAuthentication()
        let transport: any HTTPTransport = AuthenticatedHTTPTransport(
            transport: baseTransport,
            authentication: authentication
        )
        let expiration = expectation(
            forNotification: .authenticationSessionDidExpire,
            object: nil
        )

        let response = try await transport.send(HTTPRequest(
            method: .get,
            url: URL(string: "https://api.example.com/v1/events")!
        ))

        XCTAssertEqual(response.statusCode, 401)
        await fulfillment(of: [expiration], timeout: 1)
        let session = try await authentication.currentSession()
        XCTAssertNil(session)
    }
}

private actor BearerRecordingTransport: HTTPTransport {
    private let statusCode: Int
    private var request: HTTPRequest?

    init(statusCode: Int) {
        self.statusCode = statusCode
    }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        self.request = request
        return HTTPResponse(statusCode: statusCode)
    }
    func lastRequest() -> HTTPRequest? { request }
}

private actor TokenAuthentication: Authentication, SessionInvalidatingAuthentication {
    private var session: AuthSession? = AuthSession(
        accountID: "1",
        displayName: "Alex",
        role: .parent,
        accessToken: "secret-token"
    )

    func currentSession() async throws -> AuthSession? { session }
    func signIn(
        with provider: AuthenticationProvider,
        invitationCode: String?
    ) async throws -> AuthSession {
        try await currentSession()!
    }
    func signOut() async throws { session = nil }
    func deleteAccount() async throws { session = nil }
    func invalidateSession(rejectedAccessToken: String) async throws -> Bool {
        guard session?.accessToken == rejectedAccessToken else { return false }
        session = nil
        return true
    }
}
