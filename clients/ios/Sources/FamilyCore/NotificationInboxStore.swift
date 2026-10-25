import Foundation

public enum InboxNotificationKind: String, Codable, Sendable {
    case eventOccurrence = "event_occurrence"
    case reminderOccurrence = "reminder_occurrence"
    case scheduleUpdate = "schedule_update"
    case commuteDisruption = "commute_disruption"
    case driverAssignment = "driver_assignment"
    case savedConflict = "saved_conflict"
    case leaveTime = "leave_time"
    case dayBrief = "day_brief"
}

public struct InboxNotificationDestination: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case event, reminder
        case commuteSubscription = "commute_subscription"
        case settings
        case dayBrief = "day_brief"
    }
    public let kind: Kind
    public let id: String
    /// For recurring events: the local start time of this specific occurrence.
    public let occurrenceStart: Date?
    public init(kind: Kind, id: String, occurrenceStart: Date? = nil) { self.kind = kind; self.id = id; self.occurrenceStart = occurrenceStart }
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

public enum InboxFilter: String, CaseIterable, Sendable { case all, unread }
public enum InboxFreshness: Sendable { case local, live, cached }

public struct InboxNotificationPage: Sendable {
    public let items: [InboxNotification]
    public let nextCursor: String?
    public let freshness: InboxFreshness
    public let refreshedAt: Date?

    public init(items: [InboxNotification], nextCursor: String?, freshness: InboxFreshness, refreshedAt: Date? = nil) {
        self.items = items; self.nextCursor = nextCursor; self.freshness = freshness; self.refreshedAt = refreshedAt
    }
}

public protocol NotificationInboxStore: Sendable {
    func notifications() async throws -> [InboxNotification]
    func page(filter: InboxFilter, cursor: String?) async throws -> InboxNotificationPage
    func unreadCount() async throws -> Int
    func markAllRead() async throws
    func markRead(id: UUID) async throws
    func delete(id: UUID) async throws
    func deleteAll() async throws
    func ingest(_ notification: InboxNotification) async throws
}

public extension NotificationInboxStore {
    func page(filter: InboxFilter, cursor: String? = nil) async throws -> InboxNotificationPage {
        let records = try await notifications().filter { filter == .all || $0.readAt == nil }
            .sorted { $0.occurredAt == $1.occurredAt ? $0.id.uuidString > $1.id.uuidString : $0.occurredAt > $1.occurredAt }
        let offset: Int
        if let cursor {
            guard let parsed = Int(cursor), String(parsed) == cursor else { throw URLError(.badURL) }
            offset = parsed
        } else { offset = 0 }
        guard offset >= 0, offset <= records.count else { throw URLError(.badURL) }
        let items = Array(records.dropFirst(offset).prefix(50))
        let end = offset + items.count
        return InboxNotificationPage(items: items, nextCursor: end < records.count ? String(end) : nil, freshness: .local)
    }

    func markAllRead() async throws {
        for item in try await notifications() where item.readAt == nil {
            try await markRead(id: item.id)
        }
    }

    func unreadCount() async throws -> Int {
        try await notifications().filter { $0.readAt == nil }.count
    }

    func deleteAll() async throws {
        for item in try await notifications() {
            try await delete(id: item.id)
        }
    }
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
    public func deleteAll() async throws {
        try persist([])
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
        let account = try await accountID()
        do {
            let response = try await transport.send(HTTPRequest(method: .get, url: notificationsURL))
            try response.requireSuccess()
            let records = try decoder.decode([InboxNotification].self, from: response.body)
            guard try await accountID() == account else { throw CancellationError() }
            try await saveCache(records, account: account)
            return records
        } catch {
            guard let cached = try await cachedNotifications() else { throw error }
            return cached
        }
    }

    public func page(filter: InboxFilter, cursor: String? = nil) async throws -> InboxNotificationPage {
        let account = try await accountID()
        var components = URLComponents(url: notificationsURL.appending(path: "page"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "filter", value: filter.rawValue)]
        if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        do {
            let response = try await transport.send(HTTPRequest(method: .get, url: components.url!))
            try response.requireSuccess()
            let page = try decoder.decode(InboxPageResponse.self, from: response.body)
            guard try await accountID() == account else { throw CancellationError() }
            let refreshedAt = Date.now
            if cursor == nil, let url = pageCacheURL(filter: filter), let account {
                let envelope = InboxPageCache(accountID: account, page: page, refreshedAt: refreshedAt)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try encoder.encode(envelope).write(to: url, options: .atomic)
            }
            return InboxNotificationPage(items: page.items, nextCursor: page.nextCursor, freshness: .live, refreshedAt: refreshedAt)
        } catch {
            if error is CancellationError { throw error }
            if case RemoteStoreError.requestFailed(let status) = error, status == 401 || status == 403 { throw error }
            guard cursor == nil, try await accountID() == account,
                  let account, let url = pageCacheURL(filter: filter),
                  let data = try? Data(contentsOf: url),
                  let cached = try? decoder.decode(InboxPageCache.self, from: data), cached.accountID == account else { throw error }
            // Only the first page is cached. Older pages require a successful connection.
            return InboxNotificationPage(items: cached.page.items, nextCursor: nil, freshness: .cached, refreshedAt: cached.refreshedAt)
        }
    }

    private func pageCacheURL(filter: InboxFilter) -> URL? {
        cacheURL?.appendingPathExtension("page-\(filter.rawValue)")
    }

    private func invalidatePageCaches(account: String?) async throws {
        guard try await accountID() == account else { throw CancellationError() }
        for filter in InboxFilter.allCases {
            guard let url = pageCacheURL(filter: filter),
                  let data = try? Data(contentsOf: url),
                  let cached = try? decoder.decode(InboxPageCache.self, from: data), cached.accountID == account else { continue }
            try FileManager.default.removeItem(at: url)
        }
    }

    public func unreadCount() async throws -> Int {
        let account = try await accountID()
        do {
            let response = try await transport.send(HTTPRequest(
                method: .get, url: notificationsURL.appending(path: "unread-count")
            ))
            try response.requireSuccess()
            let count = try decoder.decode(UnreadInboxCount.self, from: response.body).count
            guard count >= 0 else { throw URLError(.cannotParseResponse) }
            guard try await accountID() == account else { throw CancellationError() }
            if let cached = try await cachedEnvelope() {
                try await saveCache(cached.records, account: account, unreadCount: count)
            }
            return count
        } catch {
            guard let cached = try await cachedEnvelope() else { throw error }
            return cached.unreadCount ?? cached.records.filter { $0.readAt == nil }.count
        }
    }

    public func markAllRead() async throws {
        let account = try await accountID()
        let response = try await transport.send(HTTPRequest(
            method: .post, url: notificationsURL.appending(path: "read-all")
        ))
        try response.requireSuccess()
        try await invalidatePageCaches(account: account)
        if let envelope = try await cachedEnvelope() {
            let records = envelope.records.map { item in
                InboxNotification(
                    id: item.id, kind: item.kind, title: item.title, body: item.body,
                    destination: item.destination, occurredAt: item.occurredAt, readAt: item.readAt ?? .now
                )
            }
            try await saveCache(records, account: account, unreadCount: 0)
        }
    }

    public func ingest(_ notification: InboxNotification) async throws {}

    public func delete(id: UUID) async throws {
        let account = try await accountID()
        let response = try await transport.send(HTTPRequest(
            method: .delete, url: notificationsURL.appending(path: id.uuidString)
        ))
        try response.requireSuccess()
        try await invalidatePageCaches(account: account)
        if let envelope = try await cachedEnvelope() {
            let wasUnread = envelope.records.contains { $0.id == id && $0.readAt == nil }
            let count = envelope.unreadCount.map { max(0, $0 - (wasUnread ? 1 : 0)) }
            try await saveCache(envelope.records.filter { $0.id != id }, account: envelope.accountID, unreadCount: count)
        }
    }

    public func deleteAll() async throws {
        let account = try await accountID()
        let response = try await transport.send(HTTPRequest(method: .delete, url: notificationsURL))
        try response.requireSuccess()
        try await invalidatePageCaches(account: account)
        try await saveCache([], account: account, unreadCount: 0)
    }

    public func markRead(id: UUID) async throws {
        let account = try await accountID()
        let response = try await transport.send(HTTPRequest(
            method: .patch,
            url: notificationsURL.appending(path: id.uuidString).appending(path: "read")
        ))
        try response.requireSuccess()
        try await invalidatePageCaches(account: account)
        if let envelope = try await cachedEnvelope(),
           let index = envelope.records.firstIndex(where: { $0.id == id }) {
            var cached = envelope.records
            let item = cached[index]
            cached[index] = InboxNotification(
                id: item.id, kind: item.kind, title: item.title, body: item.body,
                destination: item.destination, occurredAt: item.occurredAt, readAt: .now
            )
            let count = envelope.unreadCount.map { max(0, $0 - (item.readAt == nil ? 1 : 0)) }
            try await saveCache(cached, account: envelope.accountID, unreadCount: count)
        }
    }

    private func saveCache(_ records: [InboxNotification], account: String?, unreadCount: Int? = nil) async throws {
        guard let cacheURL, let account else { return }
        let previous = try await cachedEnvelope()?.unreadCount
        guard try await accountID() == account else { throw CancellationError() }
        let count = unreadCount ?? previous
        let envelope = InboxCacheEnvelope(accountID: account, records: records, unreadCount: count)
        try FileManager.default.createDirectory(
            at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try encoder.encode(envelope).write(to: cacheURL, options: .atomic)
    }

    private func cachedNotifications() async throws -> [InboxNotification]? {
        try await cachedEnvelope()?.records
    }

    private func cachedEnvelope() async throws -> InboxCacheEnvelope? {
        guard let cacheURL, let account = try await accountID(),
              FileManager.default.fileExists(atPath: cacheURL.path) else { return nil }
        let envelope = try decoder.decode(InboxCacheEnvelope.self, from: Data(contentsOf: cacheURL))
        return envelope.accountID == account ? envelope : nil
    }
}

private struct InboxPageResponse: Codable {
    let items: [InboxNotification]
    let nextCursor: String?
}
private struct InboxPageCache: Codable {
    let accountID: String
    let page: InboxPageResponse
    let refreshedAt: Date
}

private struct InboxCacheEnvelope: Codable {
    let accountID: String
    let records: [InboxNotification]
    let unreadCount: Int?
}

private struct UnreadInboxCount: Decodable {
    let count: Int
}
