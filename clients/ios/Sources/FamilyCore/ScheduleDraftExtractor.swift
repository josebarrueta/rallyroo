import Foundation

public enum ScheduleDraftKind: String, Codable, Equatable, Sendable {
    case event
    case reminder
}

public enum ScheduleDraftInputType: String, Codable, Equatable, Sendable {
    case text
    case voice
    case image
}

public struct ScheduleDraft: Codable, Equatable, Sendable {
    public let kind: ScheduleDraftKind
    public let title: String
    public let memberIDs: [KidID]
    public let startTime: Date?
    public let endTime: Date?
    public let dueAt: Date?
    public let location: String?
    public let alertLeadTimeMinutes: Int?
    public let clarification: String?
    public let confidence: Double

    public init(
        kind: ScheduleDraftKind,
        title: String,
        memberIDs: [KidID],
        startTime: Date?,
        endTime: Date?,
        dueAt: Date?,
        location: String?,
        alertLeadTimeMinutes: Int?,
        clarification: String?,
        confidence: Double
    ) {
        self.kind = kind
        self.title = title
        self.memberIDs = memberIDs
        self.startTime = startTime
        self.endTime = endTime
        self.dueAt = dueAt
        self.location = location
        self.alertLeadTimeMinutes = alertLeadTimeMinutes
        self.clarification = clarification
        self.confidence = confidence
    }
}

public protocol ScheduleDraftExtractor: Sendable {
    func extract(
        text: String,
        inputType: ScheduleDraftInputType,
        timeZone: String
    ) async throws -> [ScheduleDraft]
}

public actor RemoteScheduleDraftExtractor: ScheduleDraftExtractor {
    private struct Request: Encodable {
        let inputType: ScheduleDraftInputType
        let text: String
        let timeZone: String
    }

    private struct Response: Decodable {
        let drafts: [ScheduleDraft]
    }

    private let endpoint: URL
    private let transport: any HTTPTransport
    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder

    public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
        endpoint = baseURL.appending(path: "v1/schedule-drafts")
        self.transport = transport
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    public func extract(
        text: String,
        inputType: ScheduleDraftInputType,
        timeZone: String = TimeZone.autoupdatingCurrent.identifier
    ) async throws -> [ScheduleDraft] {
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: endpoint,
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(Request(inputType: inputType, text: text, timeZone: timeZone)),
            timeoutInterval: 60
        ))
        try response.requireSuccess()
        return try decoder.decode(Response.self, from: response.body).drafts
    }
}
