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
}

public actor EmptyNotificationInboxStore: NotificationInboxStore {
    public init() {}
    public func notifications() async throws -> [InboxNotification] { [] }
    public func markRead(id: UUID) async throws {}
}

public actor RemoteNotificationInboxStore: NotificationInboxStore {
    private let notificationsURL: URL
    private let transport: any HTTPTransport
    private let decoder: JSONDecoder

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
        notificationsURL = baseURL.appending(path: "v1/notifications")
        self.transport = transport
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    public func notifications() async throws -> [InboxNotification] {
        let response = try await transport.send(HTTPRequest(method: .get, url: notificationsURL))
        try response.requireSuccess()
        return try decoder.decode([InboxNotification].self, from: response.body)
    }

    public func markRead(id: UUID) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .patch,
            url: notificationsURL.appending(path: id.uuidString).appending(path: "read")
        ))
        try response.requireSuccess()
    }
}
