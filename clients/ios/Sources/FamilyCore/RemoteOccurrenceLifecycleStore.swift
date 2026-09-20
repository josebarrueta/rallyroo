import Foundation

public struct OccurrenceReference: Codable, Equatable, Sendable {
    public let kind: ScheduleOccurrenceKind
    public let seriesID: UUID
    public let scheduledAt: Date

    public init(kind: ScheduleOccurrenceKind, seriesID: UUID, scheduledAt: Date) {
        self.kind = kind
        self.seriesID = seriesID
        self.scheduledAt = scheduledAt
        }
}

public enum OccurrenceScope: String, Codable, Sendable {
    case thisOccurrence = "this_occurrence"
    case thisWeekdayFuture = "this_weekday_future"
    case allFuture = "all_future"
}

public protocol OccurrenceLifecycleStore: Sendable {
    func skip(_ reference: OccurrenceReference, scope: OccurrenceScope) async throws
    func restore(_ reference: OccurrenceReference, scope: OccurrenceScope) async throws
    func delete(_ reference: OccurrenceReference, scope: OccurrenceScope) async throws
    func acknowledge(_ reference: OccurrenceReference) async throws
}

public actor RemoteOccurrenceLifecycleStore: OccurrenceLifecycleStore {
    private struct SkipRequest: Codable {
        let kind: String
        let seriesID: String
        let scheduledAt: String
        let scope: String
        }

    private struct AcknowledgeRequest: Codable {
        let kind: String
        let seriesID: String
        let scheduledAt: String
        }

    private let baseURL: URL
    private let transport: any HTTPTransport
    private let encoder: JSONEncoder
    private let authToken: @Sendable () async throws -> String?

    public init(
        baseURL: URL,
        transport: any HTTPTransport,
        authToken: @escaping @Sendable () async throws -> String?,
        encoder: JSONEncoder = JSONEncoder()
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.authToken = authToken
        self.encoder = encoder
        encoder.outputFormatting = [.sortedKeys]
        }

    public func skip(_ reference: OccurrenceReference, scope: OccurrenceScope = .thisOccurrence) async throws {
        let token = try await authToken()
        let request = SkipRequest(
            kind: reference.kind.rawValue,
            seriesID: reference.seriesID.uuidString,
            scheduledAt: reference.scheduledAt.iso8601String,
            scope: scope.rawValue
        )
        try await perform("skip", body: try encoder.encode(request), token: token)
        }

    public func restore(_ reference: OccurrenceReference, scope: OccurrenceScope = .thisOccurrence) async throws {
        let token = try await authToken()
        let request = SkipRequest(
            kind: reference.kind.rawValue,
            seriesID: reference.seriesID.uuidString,
            scheduledAt: reference.scheduledAt.iso8601String,
            scope: scope.rawValue
        )
        try await perform("restore", body: try encoder.encode(request), token: token)
    }

    public func delete(_ reference: OccurrenceReference, scope: OccurrenceScope = .thisOccurrence) async throws {
        let token = try await authToken()
        let request = SkipRequest(
            kind: reference.kind.rawValue,
            seriesID: reference.seriesID.uuidString,
            scheduledAt: reference.scheduledAt.iso8601String,
            scope: scope.rawValue
        )
        try await perform("delete", body: try encoder.encode(request), token: token)
        }

    public func acknowledge(_ reference: OccurrenceReference) async throws {
        let token = try await authToken()
        let request = AcknowledgeRequest(
            kind: reference.kind.rawValue,
            seriesID: reference.seriesID.uuidString,
            scheduledAt: reference.scheduledAt.iso8601String
        )
        try await perform("acknowledge", body: try encoder.encode(request), token: token)
        }

    private func perform(
        _ endpoint: String,
        body: Data,
        token: String?
        ) async throws {
        let url = baseURL.appending(path: "/v1/occurrences/\(endpoint)")
        var headers = [
            "Content-Type": "application/json",
            "Accept": "application/json",
        ]
        if let token { headers["Authorization"] = "Bearer \(token)" }
        do {
            let response = try await transport.send(HTTPRequest(
                method: .post,
                url: url,
                headers: headers,
                body: body
            ))
            try response.requireSuccess()
        } catch let error as RemoteStoreError {
            throw error
        } catch {
            throw error
        }
        }
}

// MARK: - ISO 8601 date formatting

extension Date {
    var iso8601String: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: self)
        }
}

// MARK: - Mock transport for testing

public actor RecordingTransport: HTTPTransport {
    public var lastRequest: HTTPRequest?
    public var response = HTTPResponse(statusCode: 200)

    public init() {}


    public func setResponse(_ response: HTTPResponse) {
        self.response = response
          }

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        self.lastRequest = request
        return self.response
        }
}
