import Foundation

public actor RemoteReminderStore: ReminderStore {
    private let remindersURL: URL
    private let transport: any HTTPTransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
        remindersURL = baseURL.appending(path: "v1/reminders")
        self.transport = transport
        encoder = JSONEncoder()
        decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    public func reminders() async throws -> [FamilyReminder] {
        let response = try await transport.send(HTTPRequest(method: .get, url: remindersURL))
        try response.requireSuccess()
        return try decoder.decode([FamilyReminder].self, from: response.body)
    }

    public func save(_ reminder: FamilyReminder) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .put,
            url: reminderURL(reminder),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(reminder)
        ))
        try response.requireSuccess()
    }

    public func delete(_ reminder: FamilyReminder) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: reminderURL(reminder)
        ))
        try response.requireSuccess()
    }

    public func complete(_ reminder: FamilyReminder, by memberID: KidID) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: reminderURL(reminder).appending(path: "complete")
        ))
        try response.requireSuccess()
    }

    public func reopen(_ reminder: FamilyReminder) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: reminderURL(reminder).appending(path: "reopen")
        ))
        try response.requireSuccess()
    }

    private func reminderURL(_ reminder: FamilyReminder) -> URL {
        remindersURL.appending(path: reminder.id.uuidString)
    }

     public func occurrences(_ series: [FamilyReminder], in range: DateInterval) async throws -> [FamilyReminder] {
        ReminderOccurrenceExpander.occurrences(of: series, in: range).map(\.reminder)
        }
}
