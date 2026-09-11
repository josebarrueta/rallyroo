import Foundation

public enum HTTPMethod: String, Equatable, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

public struct HTTPRequest: Equatable, Sendable {
    public let method: HTTPMethod
    public let url: URL
    public let headers: [String: String]
    public let body: Data?
    public let timeoutInterval: TimeInterval

    public init(
        method: HTTPMethod,
        url: URL,
        headers: [String: String] = [:],
        body: Data? = nil,
        timeoutInterval: TimeInterval = 60
    ) {
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
        self.timeoutInterval = timeoutInterval
    }
}

public struct HTTPResponse: Equatable, Sendable {
    public let statusCode: Int
    public let body: Data

    public init(statusCode: Int, body: Data = Data()) {
        self.statusCode = statusCode
        self.body = body
    }
}

public protocol HTTPTransport: Sendable {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse
}

public actor URLSessionHTTPTransport: HTTPTransport {
    public init() {}

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.httpBody = request.body
        urlRequest.timeoutInterval = request.timeoutInterval
        request.headers.forEach { urlRequest.setValue($1, forHTTPHeaderField: $0) }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw RemoteStoreError.invalidResponse
        }
        return HTTPResponse(statusCode: httpResponse.statusCode, body: data)
    }
}

public enum RemoteStoreError: Error, Equatable, Sendable {
    case invalidResponse
    case requestFailed(statusCode: Int)
}

extension HTTPResponse {
    func requireSuccess() throws {
        guard (200..<300).contains(statusCode) else {
            throw RemoteStoreError.requestFailed(statusCode: statusCode)
        }
    }
}

public actor RemoteEventStore: EventStore {
    private struct CachedEvents: Codable {
        let accountID: String
        let events: [FamilyEvent]
    }

    private let eventsURL: URL
    private let transport: any HTTPTransport
    private let cacheURL: URL?
    private let accountID: @Sendable () async throws -> String?
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        baseURL: URL,
        transport: any HTTPTransport = URLSessionHTTPTransport(),
        cacheURL: URL? = nil,
        accountID: @escaping @Sendable () async throws -> String? = { nil }
    ) {
        eventsURL = baseURL.appending(path: "v1/events")
        self.transport = transport
        self.cacheURL = cacheURL
        self.accountID = accountID
        encoder = JSONEncoder()
        decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    public func loadEvents() async throws -> EventSnapshot {
        let activeAccountID = try await accountID()
        do {
            let response = try await transport.send(HTTPRequest(method: .get, url: eventsURL))
            try response.requireSuccess()
            let events = try decoder.decode([FamilyEvent].self, from: response.body)
            if let activeAccountID {
                try? writeCache(CachedEvents(accountID: activeAccountID, events: events))
            }
            return EventSnapshot(events: events, freshness: .fresh)
        } catch {
            if case RemoteStoreError.requestFailed(let statusCode) = error,
               statusCode == 401 || statusCode == 403 {
                throw error
            }
            guard let activeAccountID,
                  let cached = try? readCache(),
                  cached.accountID == activeAccountID else {
                throw error
            }
            return EventSnapshot(events: cached.events, freshness: .cached)
        }
    }

    public func save(
        _ event: FamilyEvent,
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult {
        var components = URLComponents(
            url: eventsURL.appending(path: event.id.uuidString),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(
            name: "notifyParticipants",
            value: notifyParticipants.description
        )]
        let response = try await transport.send(HTTPRequest(
            method: .put,
            url: components.url!,
            headers: [
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey.uuidString.lowercased(),
            ],
            body: try encoder.encode(event)
        ))
        try response.requireSuccess()
        let payload = try decoder.decode(SaveResponse.self, from: response.body)
        return EventMutationResult(
            conflicts: payload.conflicts.compactMap { $0.eventConflict },
            notificationOutcome: payload.notificationOutcome ?? .notRequested
        )
    }


    public func updateOccurrences(
         _ upserts: [FamilyEvent],
        deleteIDs: [String],
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult {
        struct RecurringEditRequest: Codable {
            let upserts: [FamilyEvent]
            let deleteIDs: [String]
            let notifyParticipants: Bool
        }
        let recurringEditURL = eventsURL.appending(path: "recurring-edit")
        let body = try encoder.encode(RecurringEditRequest(
            upserts: upserts,
            deleteIDs: deleteIDs,
            notifyParticipants: notifyParticipants
        ))
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: recurringEditURL,
            headers: [
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey.uuidString.lowercased(),
            ],
            body: body
        ))
        try response.requireSuccess()
        let payload = try decoder.decode(SaveResponse.self, from: response.body)
        return EventMutationResult(
            conflicts: payload.conflicts.compactMap { $0.eventConflict },
            notificationOutcome: payload.notificationOutcome ?? .notRequested
        )
    }
    public func delete(_ event: FamilyEvent, idempotencyKey: UUID) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: eventsURL.appending(path: event.id.uuidString),
            headers: ["Idempotency-Key": idempotencyKey.uuidString.lowercased()]
        ))
        try response.requireSuccess()
    }

    public func clearCache() async throws {
        guard let cacheURL, FileManager.default.fileExists(atPath: cacheURL.path) else { return }
        try FileManager.default.removeItem(at: cacheURL)
    }

    private func readCache() throws -> CachedEvents {
        guard let cacheURL else { throw CocoaError(.fileNoSuchFile) }
        return try decoder.decode(CachedEvents.self, from: Data(contentsOf: cacheURL))
    }

    private func writeCache(_ cache: CachedEvents) throws {
        guard let cacheURL else { return }
        try FileManager.default.createDirectory(
            at: cacheURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try encoder.encode(cache).write(to: cacheURL, options: .atomic)
#if os(iOS)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: cacheURL.path
        )
#endif
    }
}

private struct SaveResponse: Codable {
    let conflicts: [ConflictPayload]
    let notificationOutcome: ScheduleUpdateNotificationOutcome?
}

private struct ConflictPayload: Codable {
    let kind: String
    let memberID: String?
    let driver: String?
    let eventIDs: [UUID]

    var eventConflict: EventConflict? {
        let conflictKind: EventConflict.Kind
        switch kind {
        case "overlapping_participant":
            guard let memberID else { return nil }
            conflictKind = .overlappingParticipantActivity(KidID(rawValue: memberID))
        case "double_booked_driver":
            if let memberID {
                conflictKind = .doubleBookedDriverMember(KidID(rawValue: memberID))
            } else if let driver {
                conflictKind = .doubleBookedDriver(driver)
            } else {
                return nil
            }
        default:
            return nil
        }
        return EventConflict(kind: conflictKind, eventIDs: eventIDs)
    }
}
