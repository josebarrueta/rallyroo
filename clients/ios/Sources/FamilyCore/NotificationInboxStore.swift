import Foundation

public enum InboxNotificationKind: String, Codable, Sendable {
    case eventOccurrence = "event_occurrence"
    case reminderOccurrence = "reminder_occurrence"
    case scheduleUpdate = "schedule_update"
    case commuteDisruption = "commute_disruption"
    case driverAssignment = "driver_assignment"
    case savedConflict = "saved_conflict"
}

public struct InboxNotificationDestination: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case event, reminder
        case commuteSubscription = "commute_subscription"
        case settings
    }
    public let kind: Kind
    public let id: String
    public init(kind: Kind, id: String) { self.kind = kind; self.id = id }
}

public struct InboxNotification: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let kind: InboxNotificationKind
    public let title: String
    public let body: String
    public let destination: InboxNotificationDestination
    public let occurredAt: Date
    public let readAt: Date?

    public init(id: UUID, kind: InboxNotificationKind, title: String, body: String,
                destination: InboxNotificationDestination, occurredAt: Date, readAt: Date?) {
        self.id = id; self.kind = kind; self.title = title; self.body = body
        self.destination = destination; self.occurredAt = occurredAt; self.readAt = readAt
    }
}

public protocol NotificationInboxStore: Sendable {
    func notifications() async throws -> [InboxNotification]
    func markRead(id: UUID) async throws
    func delete(id: UUID) async throws
    func ingest(_ notification: InboxNotification) async throws
}

public actor EmptyNotificationInboxStore: NotificationInboxStore {
    public init() {}
    public func notifications() async throws -> [InboxNotification] { [] }
    public func markRead(id: UUID) async throws {}
    public func delete(id: UUID) async throws {}
    public func ingest(_ notification: InboxNotification) async throws {}
}

public actor LocalNotificationInboxStore: NotificationInboxStore {
    private let storageURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    public init(storageURL: URL) {
        self.storageURL = storageURL
        encoder = JSONEncoder(); decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601; decoder.dateDecodingStrategy = .iso8601
    }
    public func notifications() async throws -> [InboxNotification] {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return [] }
        return try decoder.decode([InboxNotification].self, from: Data(contentsOf: storageURL))
            .sorted { $0.occurredAt > $1.occurredAt }
    }
    public func markRead(id: UUID) async throws {
        var records = try await notifications()
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        let item = records[index]
        records[index] = InboxNotification(
            id: item.id, kind: item.kind, title: item.title, body: item.body,
            destination: item.destination, occurredAt: item.occurredAt, readAt: item.readAt ?? .now
        )
        try persist(records)
    }
    public func delete(id: UUID) async throws {
        var records = try await notifications()
        records.removeAll { $0.id == id }
        try persist(records)
    }
    public func ingest(_ notification: InboxNotification) async throws {
        var records = try await notifications()
        guard !records.contains(where: { $0.id == notification.id }) else { return }
        records.append(notification)
        records = Array(records.sorted { $0.occurredAt > $1.occurredAt }.prefix(500))
        try persist(records)
    }
    private func persist(_ records: [InboxNotification]) throws {
        try FileManager.default.createDirectory(
            at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try encoder.encode(records).write(to: storageURL, options: .atomic)
    }
}

public actor RemoteNotificationInboxStore: NotificationInboxStore {
    private let notificationsURL: URL
    private let transport: any HTTPTransport
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let cacheURL: URL?
    private let accountID: @Sendable () async throws -> String?

    public init(
        baseURL: URL,
        transport: any HTTPTransport = URLSessionHTTPTransport(),
        cacheURL: URL? = nil,
        accountID: @escaping @Sendable () async throws -> String? = { nil }
    ) {
        notificationsURL = baseURL.appending(path: "v1/notifications")
        self.transport = transport
        self.cacheURL = cacheURL
        self.accountID = accountID
        decoder = JSONDecoder(); encoder = JSONEncoder()
        decoder.dateDecodingStrategy = .iso8601; encoder.dateEncodingStrategy = .iso8601
    }

    public func notifications() async throws -> [InboxNotification] {
        do {
            let response = try await transport.send(HTTPRequest(method: .get, url: notificationsURL))
            try response.requireSuccess()
            let records = try decoder.decode([InboxNotification].self, from: response.body)
            try await saveCache(records)
            return records
        } catch {
            guard let cached = try await cachedNotifications() else { throw error }
            return cached
        }
    }

    public func ingest(_ notification: InboxNotification) async throws {}

    public func delete(id: UUID) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .delete, url: notificationsURL.appending(path: id.uuidString)
        ))
        try response.requireSuccess()
        if var cached = try await cachedNotifications() {
            cached.removeAll { $0.id == id }
            try await saveCache(cached)
        }
    }

    public func markRead(id: UUID) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .patch,
            url: notificationsURL.appending(path: id.uuidString).appending(path: "read")
        ))
        try response.requireSuccess()
        if var cached = try await cachedNotifications(),
           let index = cached.firstIndex(where: { $0.id == id }) {
            let item = cached[index]
            cached[index] = InboxNotification(
                id: item.id, kind: item.kind, title: item.title, body: item.body,
                destination: item.destination, occurredAt: item.occurredAt, readAt: .now
            )
            try await saveCache(cached)
        }
    }

    private func saveCache(_ records: [InboxNotification]) async throws {
        guard let cacheURL, let account = try await accountID() else { return }
        let envelope = InboxCacheEnvelope(accountID: account, records: records)
        try FileManager.default.createDirectory(
            at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try encoder.encode(envelope).write(to: cacheURL, options: .atomic)
    }

    private func cachedNotifications() async throws -> [InboxNotification]? {
        guard let cacheURL, let account = try await accountID(),
              FileManager.default.fileExists(atPath: cacheURL.path) else { return nil }
        let envelope = try decoder.decode(InboxCacheEnvelope.self, from: Data(contentsOf: cacheURL))
        return envelope.accountID == account ? envelope.records : nil
    }
}

private struct InboxCacheEnvelope: Codable {
    let accountID: String
    let records: [InboxNotification]
}
