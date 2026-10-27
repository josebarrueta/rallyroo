import Foundation

public struct LocationSuggestion: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let address: String

    public init(id: String, address: String) {
        self.id = id
        self.address = address
    }
}

public enum LocationSearchAttribution: Equatable, Sendable {
    case googleMaps
}

public protocol LocationSearch: Sendable {
    var attribution: LocationSearchAttribution? { get }
    func suggestions(for query: String) async throws -> [LocationSuggestion]
}

public extension LocationSearch {
    var attribution: LocationSearchAttribution? { nil }
}

public enum LocationSearchError: Error, Equatable, Sendable {
    case unavailable
}

public struct EmptyLocationSearch: LocationSearch {
    public init() {}
    public func suggestions(for query: String) async throws -> [LocationSuggestion] {
        throw LocationSearchError.unavailable
    }
}

public actor RemoteLocationSearch: LocationSearch {
    // The current locations endpoint is backed by Google Places. Keep local/
    // unavailable implementations unattributed rather than crediting Google falsely.
    public nonisolated let attribution: LocationSearchAttribution? = .googleMaps
    private let searchURL: URL
    private let transport: any HTTPTransport

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
        searchURL = baseURL.appending(path: "v1/locations/search")
        self.transport = transport
    }

    public func suggestions(for query: String) async throws -> [LocationSuggestion] {
        guard var components = URLComponents(url: searchURL, resolvingAgainstBaseURL: false) else {
            throw RemoteStoreError.invalidResponse
        }
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components.url else { throw RemoteStoreError.invalidResponse }
        let response = try await transport.send(HTTPRequest(method: .get, url: url))
        try response.requireSuccess()
        return try JSONDecoder().decode([LocationSuggestion].self, from: response.body)
    }
}
