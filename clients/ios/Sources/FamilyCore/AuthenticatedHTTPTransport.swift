import Foundation

public actor AuthenticatedHTTPTransport: HTTPTransport {
    private let transport: any HTTPTransport
    private let authentication: any Authentication

    public init(transport: any HTTPTransport, authentication: any Authentication) {
        self.transport = transport
        self.authentication = authentication
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        var headers = request.headers
        let accessToken = try await authentication.currentSession()?.accessToken
        if let accessToken {
            headers["Authorization"] = "Bearer \(accessToken)"
        }
        let response = try await transport.send(HTTPRequest(
            method: request.method,
            url: request.url,
            headers: headers,
            body: request.body
        ))
        if response.statusCode == 401,
           let accessToken,
           let invalidatingAuthentication = authentication as? any SessionInvalidatingAuthentication,
           (try? await invalidatingAuthentication.invalidateSession(
               rejectedAccessToken: accessToken
           )) == true {
            NotificationCenter.default.post(name: .authenticationSessionDidExpire, object: nil)
        }
        return response
    }
}
