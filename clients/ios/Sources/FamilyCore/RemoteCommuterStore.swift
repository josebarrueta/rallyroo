import Foundation

public actor RemoteCommuterStore: CommuterStore {
    private let commuterURL: URL
    private let transport: any HTTPTransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
        commuterURL = baseURL.appending(path: "v1/modules/commuter")
        self.transport = transport
        encoder = JSONEncoder()
        decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    public func state() async throws -> CommuterState {
        try await sendAndDecode(HTTPRequest(method: .get, url: commuterURL))
    }

    public func catalog() async throws -> CaltrainCatalog {
        try await sendAndDecode(HTTPRequest(
            method: .get,
            url: commuterURL.appending(path: "catalog")
        ))
    }

    public func searchJourneys(
        _ search: CaltrainJourneySearch
    ) async throws -> CaltrainJourneySearchResult {
        try await sendAndDecode(HTTPRequest(
            method: .post,
            url: commuterURL.appending(path: "journeys").appending(path: "search"),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(search)
        ))
    }

    public func enable() async throws -> CommuterInstallation {
        try await sendAndDecode(HTTPRequest(method: .put, url: commuterURL))
    }

    public func disable() async throws {
        let response = try await transport.send(HTTPRequest(
            method: .patch,
            url: commuterURL,
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(InstallationStatusBody(status: .disabled))
        ))
        try response.requireSuccess()
    }

    public func removeModule() async throws {
        let response = try await transport.send(HTTPRequest(method: .delete, url: commuterURL))
        try response.requireSuccess()
    }

    public func createSubscription(
        _ draft: CommuteSubscriptionDraft
    ) async throws -> CommuteSubscription {
        try await sendAndDecode(HTTPRequest(
            method: .post,
            url: commuterURL.appending(path: "subscriptions"),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(draft)
        ))
    }

    public func updateSubscription(
        _ draft: CommuteSubscriptionDraft,
        for subscription: CommuteSubscription
    ) async throws -> CommuteSubscription {
        try await sendAndDecode(HTTPRequest(
            method: .put,
            url: subscriptionURL(subscription),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(draft)
        ))
    }

    public func setStatus(
        _ status: CommuteSubscriptionStatus,
        for subscription: CommuteSubscription
    ) async throws -> CommuteSubscription {
        try await sendAndDecode(HTTPRequest(
            method: .patch,
            url: subscriptionURL(subscription),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(StatusBody(status: status))
        ))
    }

    public func remove(_ subscription: CommuteSubscription) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: subscriptionURL(subscription)
        ))
        try response.requireSuccess()
    }

    private func subscriptionURL(_ subscription: CommuteSubscription) -> URL {
        commuterURL.appending(path: "subscriptions").appending(path: subscription.id.uuidString)
    }

    private func sendAndDecode<Value: Decodable>(_ request: HTTPRequest) async throws -> Value {
        let response = try await transport.send(request)
        try response.requireSuccess()
        return try decoder.decode(Value.self, from: response.body)
    }
}

private struct InstallationStatusBody: Encodable {
    let status: CommuterInstallationStatus
}

private struct StatusBody: Encodable {
    let status: CommuteSubscriptionStatus
}
