import Foundation

public struct CalendarAccountConnection: Decodable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let username: String
    public let createdAt: String
    public let timeZone: String?
}

public struct CalendarAccountConnections: Decodable, Sendable {
    public let serverURL: URL
    public let connections: [CalendarAccountConnection]
}

/// Deliberately not Encodable: one-time credentials must never enter a disk cache.
public struct CalendarAccountCredentials: Decodable, Identifiable, Sendable {
    public let id: UUID
    public let username: String
    public let password: String
    public let createdAt: String
    public let timeZone: String?
    public let serverURL: URL
}

public enum CalendarConnectionError: Error, Equatable {
    case unavailable
}

public protocol CalendarConnectionStore: Sendable {
    func connections() async throws -> CalendarAccountConnections
    func create() async throws -> CalendarAccountCredentials
    func revoke(id: UUID) async throws
}

public actor RemoteCalendarConnectionStore: CalendarConnectionStore {
    private let url: URL
    private let transport: any HTTPTransport
    private let calendarTimeZone: TimeZone

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport(), calendarTimeZone: TimeZone = .autoupdatingCurrent) {
        url = baseURL.appending(path: "v1/calendar-connections")
        self.transport = transport
        self.calendarTimeZone = calendarTimeZone
    }

    public func connections() async throws -> CalendarAccountConnections {
        let response = try await transport.send(HTTPRequest(method: .get, url: url))
        if response.statusCode == 403 || response.statusCode == 404 { throw CalendarConnectionError.unavailable }
        try response.requireSuccess()
        return try JSONDecoder().decode(CalendarAccountConnections.self, from: response.body)
    }

    public func create() async throws -> CalendarAccountCredentials {
        let response = try await transport.send(HTTPRequest(method: .post, url: url,
            headers: ["Content-Type": "application/json"],
            body: try JSONEncoder().encode(["timeZone": calendarTimeZone.identifier])))
        if response.statusCode == 403 || response.statusCode == 404 { throw CalendarConnectionError.unavailable }
        try response.requireSuccess()
        return try JSONDecoder().decode(CalendarAccountCredentials.self, from: response.body)
    }

    public func revoke(id: UUID) async throws {
        let response = try await transport.send(HTTPRequest(method: .delete, url: url.appending(path: id.uuidString.lowercased())))
        try response.requireSuccess()
    }
}
