import Foundation

public enum CalendarSourceVisibility: String, Codable, Equatable, Sendable {
    case personal
    case family
}

public enum CalendarSourceStatus: String, Codable, Sendable {
    case pending
    case ready
    case error
}

public struct CalendarSourceConnection: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let ownerMemberID: String
    public let visibility: CalendarSourceVisibility
    public let name: String
    public let participantIDs: [KidID]
    public let status: CalendarSourceStatus
    public let lastSyncedAt: Date?
    public let lastError: String?

    public init(
        id: UUID,
        ownerMemberID: String,
        visibility: CalendarSourceVisibility,
        name: String,
        participantIDs: [KidID],
        status: CalendarSourceStatus,
        lastSyncedAt: Date? = nil,
        lastError: String? = nil
    ) {
        self.id = id
        self.ownerMemberID = ownerMemberID
        self.visibility = visibility
        self.name = name
        self.participantIDs = participantIDs
        self.status = status
        self.lastSyncedAt = lastSyncedAt
        self.lastError = lastError
    }
}

public protocol CalendarSourceStore: Sendable {
    func sources() async throws -> [CalendarSourceConnection]
    func connect(
        name: String,
        url: URL,
        participantIDs: [KidID],
        visibility: CalendarSourceVisibility
    ) async throws -> CalendarSourceConnection
    func update(
        _ source: CalendarSourceConnection,
        name: String,
        visibility: CalendarSourceVisibility
    ) async throws -> CalendarSourceConnection
    func synchronize(_ source: CalendarSourceConnection) async throws -> CalendarSourceConnection
    func delete(_ source: CalendarSourceConnection) async throws
}

public actor RemoteCalendarSourceStore: CalendarSourceStore {
    private let sourcesURL: URL
    private let transport: any HTTPTransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
        sourcesURL = baseURL.appending(path: "v1/calendar-sources")
        self.transport = transport
        encoder = JSONEncoder()
        decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    public func sources() async throws -> [CalendarSourceConnection] {
        let response = try await transport.send(HTTPRequest(method: .get, url: sourcesURL))
        try response.requireSuccess()
        return try decoder.decode([CalendarSourceConnection].self, from: response.body)
    }

    public func connect(
        name: String,
        url: URL,
        participantIDs: [KidID],
        visibility: CalendarSourceVisibility
    ) async throws -> CalendarSourceConnection {
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: sourcesURL,
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(CreateCalendarSourceRequest(
                name: name,
                url: url.absoluteString,
                participantIDs: participantIDs,
                visibility: visibility
            ))
        ))
        try response.requireSuccess()
        return try decoder.decode(CalendarSourceConnection.self, from: response.body)
    }

    public func update(
        _ source: CalendarSourceConnection,
        name: String,
        visibility: CalendarSourceVisibility
    ) async throws -> CalendarSourceConnection {
        let response = try await transport.send(HTTPRequest(
            method: .patch,
            url: sourcesURL.appending(path: source.id.uuidString),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(UpdateCalendarSourceRequest(name: name, visibility: visibility))
        ))
        try response.requireSuccess()
        return try decoder.decode(CalendarSourceConnection.self, from: response.body)
    }

    public func synchronize(_ source: CalendarSourceConnection) async throws -> CalendarSourceConnection {
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: sourcesURL.appending(path: source.id.uuidString).appending(path: "sync")
        ))
        try response.requireSuccess()
        return try decoder.decode(CalendarSourceConnection.self, from: response.body)
    }

    public func delete(_ source: CalendarSourceConnection) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: sourcesURL.appending(path: source.id.uuidString)
        ))
        try response.requireSuccess()
    }
}

private struct UpdateCalendarSourceRequest: Codable {
    let name: String
    let visibility: CalendarSourceVisibility
}

private struct CreateCalendarSourceRequest: Codable {
    let name: String
    let url: String
    let participantIDs: [KidID]
    let visibility: CalendarSourceVisibility
}
