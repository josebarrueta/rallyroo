import Foundation

public struct DayBriefPreferences: Codable, Equatable, Sendable {
  public let enabled: Bool
  public let timeZone: String
  public let weekdayTime: String
  public let weekendHolidayTime: String
  public let earlyEventLeadMinutes: Int
  public let holidayRegion: String

  public init(
    enabled: Bool,
    timeZone: String,
    weekdayTime: String,
    weekendHolidayTime: String,
    earlyEventLeadMinutes: Int,
    holidayRegion: String
  ) {
    self.enabled = enabled
    self.timeZone = timeZone
    self.weekdayTime = weekdayTime
    self.weekendHolidayTime = weekendHolidayTime
    self.earlyEventLeadMinutes = earlyEventLeadMinutes
    self.holidayRegion = holidayRegion
  }
}

public enum DayBriefEventRole: String, Codable, Equatable, Sendable {
  case driver
  case participant
  case personalCalendar = "personal_calendar"
}

public struct DayBriefEventFact: Codable, Equatable, Sendable {
  public let id: String
  public let title: String
  public let scheduledAt: Date
  public let startTime: Date
  public let endTime: Date
  public let location: String?
  public let roles: [DayBriefEventRole]

  public init(
    id: String,
    title: String,
    scheduledAt: Date,
    startTime: Date,
    endTime: Date,
    location: String?,
    roles: [DayBriefEventRole]
  ) {
    self.id = id
    self.title = title
    self.scheduledAt = scheduledAt
    self.startTime = startTime
    self.endTime = endTime
    self.location = location
    self.roles = roles
  }
}

public struct DayBriefReminderFact: Codable, Equatable, Sendable {
  public let id: String
  public let title: String
  public let dueAt: Date

  public init(id: String, title: String, dueAt: Date) {
    self.id = id
    self.title = title
    self.dueAt = dueAt
  }
}

public struct DayBriefFacts: Codable, Equatable, Sendable {
  public let events: [DayBriefEventFact]
  public let reminders: [DayBriefReminderFact]

  public init(events: [DayBriefEventFact], reminders: [DayBriefReminderFact]) {
    self.events = events
    self.reminders = reminders
  }
}

public struct DayBrief: Codable, Equatable, Sendable {
  public let localDate: String
  public let timeZone: String
  public let facts: DayBriefFacts
  public let title: String
  public let body: String
  public let generatedAt: Date?

  public init(
    localDate: String,
    timeZone: String,
    facts: DayBriefFacts,
    title: String,
    body: String,
    generatedAt: Date? = nil
  ) {
    self.localDate = localDate
    self.timeZone = timeZone
    self.facts = facts
    self.title = title
    self.body = body
    self.generatedAt = generatedAt
  }
}

public protocol DayBriefStore: Sendable {
  func preferences() async throws -> DayBriefPreferences?
  func savePreferences(_ preferences: DayBriefPreferences) async throws -> DayBriefPreferences
  func brief(localDate: String) async throws -> DayBrief?
}

public actor RemoteDayBriefStore: DayBriefStore {
  private let preferencesURL: URL
  private let briefsURL: URL
  private let transport: any HTTPTransport
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
    preferencesURL = baseURL.appending(path: "v1/day-brief").appending(path: "preferences")
    briefsURL = baseURL.appending(path: "v1/day-briefs")
    self.transport = transport
    encoder = JSONEncoder()
    decoder = JSONDecoder()
    encoder.dateEncodingStrategy = .iso8601
    decoder.dateDecodingStrategy = .iso8601
  }

  public func preferences() async throws -> DayBriefPreferences? {
    let response = try await transport.send(
      HTTPRequest(
        method: .get,
        url: preferencesURL
      ))
    guard response.statusCode != 404 else { return nil }
    try response.requireSuccess()
    return try decoder.decode(DayBriefPreferences.self, from: response.body)
  }

  public func savePreferences(
    _ preferences: DayBriefPreferences
  ) async throws -> DayBriefPreferences {
    try await sendAndDecode(
      HTTPRequest(
        method: .put,
        url: preferencesURL,
        headers: ["Content-Type": "application/json"],
        body: try encoder.encode(preferences)
      ))
  }

  public func brief(localDate: String) async throws -> DayBrief? {
    let response = try await transport.send(
      HTTPRequest(
        method: .get,
        url: briefsURL.appending(path: localDate)
      ))
    guard response.statusCode != 404 else { return nil }
    try response.requireSuccess()
    return try decoder.decode(DayBrief.self, from: response.body)
  }

  private func sendAndDecode<Value: Decodable>(_ request: HTTPRequest) async throws -> Value {
    let response = try await transport.send(request)
    try response.requireSuccess()
    return try decoder.decode(Value.self, from: response.body)
  }
}
