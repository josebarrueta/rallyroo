import Foundation

public enum TravelPlanningError: Error, Equatable, Sendable {
    case invalidWaypoint
    case invalidSavedPlace
    case invalidPreparationMinutes
    case invalidRecipients
}

public enum SavedPlaceVisibility: String, Codable, Sendable {
    case family
    case personal
}

public enum TrafficPreference: String, Codable, Sendable {
    case bestGuess = "best_guess"
    case pessimistic
}

/// Exactly one of `placeID` or `address`, matching the server's strict union
/// `{ "placeID": "..." } | { "address": "..." }`.
public struct TravelWaypoint: Codable, Equatable, Sendable {
    public let placeID: String?
    public let address: String?

    private enum CodingKeys: String, CodingKey {
        case placeID, address
     }

    public init(placeID: String?, address: String?) throws {
        let trimmedPlaceID = placeID?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAddress = address?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasPlaceID = !(trimmedPlaceID?.isEmpty ?? true)
        let hasAddress = !(trimmedAddress?.isEmpty ?? true)
        guard hasPlaceID != hasAddress else {
            throw TravelPlanningError.invalidWaypoint
         }
        guard (trimmedPlaceID?.count ?? 0) <= 500,
              (trimmedAddress?.count ?? 0) <= 500 else {
            throw TravelPlanningError.invalidWaypoint
         }
        self.placeID = trimmedPlaceID
        self.address = trimmedAddress
     }

    public init(placeID: String) throws {
        try self.init(placeID: placeID, address: nil)
     }

    public init(address: String) throws {
        try self.init(placeID: nil, address: address)
     }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let placeID = try container.decodeIfPresent(String.self, forKey: .placeID)
        let address = try container.decodeIfPresent(String.self, forKey: .address)
        try self.init(placeID: placeID, address: address)
     }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let placeID {
            try container.encode(placeID, forKey: .placeID)
         } else if let address {
            try container.encode(address, forKey: .address)
         }
     }
}

public enum TravelPlanOrigin: Codable, Equatable, Sendable {
    case savedPlace(UUID)
    case oneTime(TravelWaypoint)

    private enum CodingKeys: String, CodingKey {
        case kind, savedPlaceID, waypoint
     }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let kind = try container.decodeIfPresent(String.self, forKey: .kind) else {
            throw DecodingError.keyNotFound(
                CodingKeys.kind,
                .init(codingPath: container.codingPath, debugDescription: "Missing travel plan origin kind")
             )
         }
        switch kind {
        case "saved_place":
            let savedPlaceID = try container.decode(UUID.self, forKey: .savedPlaceID)
            self = .savedPlace(savedPlaceID)
        case "one_time":
            let waypoint = try container.decode(TravelWaypoint.self, forKey: .waypoint)
            self = .oneTime(waypoint)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "Unknown travel plan origin kind: \(kind)"
             )
         }
     }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .savedPlace(savedPlaceID):
            try container.encode("saved_place", forKey: .kind)
            try container.encode(savedPlaceID, forKey: .savedPlaceID)
        case let .oneTime(waypoint):
            try container.encode("one_time", forKey: .kind)
            try container.encode(waypoint, forKey: .waypoint)
         }
     }
}

public struct SavedPlace: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let ownerMemberID: String?
    public let visibility: SavedPlaceVisibility
    public let label: String
    public let waypoint: TravelWaypoint
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: UUID,
        ownerMemberID: String?,
        visibility: SavedPlaceVisibility,
        label: String,
        waypoint: TravelWaypoint,
        createdAt: Date,
        updatedAt: Date
     ) {
        self.id = id
        self.ownerMemberID = ownerMemberID
        self.visibility = visibility
        self.label = label
        self.waypoint = waypoint
        self.createdAt = createdAt
        self.updatedAt = updatedAt
     }
}

public struct SavedPlaceDraft: Codable, Equatable, Sendable {
    public let visibility: SavedPlaceVisibility
    public let label: String
    public let waypoint: TravelWaypoint

    public init(
        visibility: SavedPlaceVisibility,
        label: String,
        waypoint: TravelWaypoint
     ) {
        self.visibility = visibility
        self.label = label
        self.waypoint = waypoint
     }

    public func validate() throws {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLabel.isEmpty, trimmedLabel.count <= 100 else {
            throw TravelPlanningError.invalidSavedPlace
         }
     }
}

public struct EventTravelPlan: Codable, Equatable, Sendable {
    public let eventID: UUID
    public let revision: Int
    public let origin: TravelPlanOrigin
    public let preparationMinutes: Int
    public let trafficPreference: TrafficPreference
    public let recipientMemberIDs: [String]
    public let leaveAlertEnabled: Bool
    public let createdByMemberID: String
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        eventID: UUID,
        revision: Int,
        origin: TravelPlanOrigin,
        preparationMinutes: Int,
        trafficPreference: TrafficPreference,
        recipientMemberIDs: [String],
        leaveAlertEnabled: Bool,
        createdByMemberID: String,
        createdAt: Date,
        updatedAt: Date
     ) {
        self.eventID = eventID
        self.revision = revision
        self.origin = origin
        self.preparationMinutes = preparationMinutes
        self.trafficPreference = trafficPreference
        self.recipientMemberIDs = recipientMemberIDs
        self.leaveAlertEnabled = leaveAlertEnabled
        self.createdByMemberID = createdByMemberID
        self.createdAt = createdAt
        self.updatedAt = updatedAt
     }
}

public struct TravelPlanDraft: Codable, Equatable, Sendable {
    public let origin: TravelPlanOrigin
    public let preparationMinutes: Int
    public let trafficPreference: TrafficPreference
    public let recipientMemberIDs: [String]
    public let leaveAlertEnabled: Bool

    public init(
        origin: TravelPlanOrigin,
        preparationMinutes: Int,
        trafficPreference: TrafficPreference,
        recipientMemberIDs: [String],
        leaveAlertEnabled: Bool
     ) {
        self.origin = origin
        self.preparationMinutes = preparationMinutes
        self.trafficPreference = trafficPreference
        self.recipientMemberIDs = recipientMemberIDs
        self.leaveAlertEnabled = leaveAlertEnabled
     }

    public static func automatic(
        origin: TravelPlanOrigin,
        eligibleRecipientIDs: [String],
        leaveAlertEnabled: Bool
    ) -> TravelPlanDraft {
        TravelPlanDraft(
            origin: origin,
            preparationMinutes: 0,
            trafficPreference: .bestGuess,
            recipientMemberIDs: Array(Set(eligibleRecipientIDs)).sorted(),
            leaveAlertEnabled: leaveAlertEnabled
        )
    }

    public func validate() throws {
        guard (0...180).contains(preparationMinutes) else {
            throw TravelPlanningError.invalidPreparationMinutes
         }
        let recipients = recipientMemberIDs.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
         }
        guard (!leaveAlertEnabled || !recipients.isEmpty),
              recipients.allSatisfy({ !$0.isEmpty }),
              Set(recipients).count == recipients.count else {
            throw TravelPlanningError.invalidRecipients
         }
     }
}

public struct TravelPreview: Codable, Equatable, Sendable {
    public let leaveTime: Date
    public let durationSeconds: Double
    public let distanceMeters: Double
    public let estimatedAt: Date
    public let leaveNow: Bool
    public let provider: String
    public let attribution: String

    public init(
        leaveTime: Date,
        durationSeconds: Double,
        distanceMeters: Double,
        estimatedAt: Date,
        leaveNow: Bool,
        provider: String,
        attribution: String
     ) {
        self.leaveTime = leaveTime
        self.durationSeconds = durationSeconds
        self.distanceMeters = distanceMeters
        self.estimatedAt = estimatedAt
        self.leaveNow = leaveNow
        self.provider = provider
        self.attribution = attribution
     }
}

public protocol TravelPlanningStore: Sendable {
    func savedPlaces() async throws -> [SavedPlace]
    func createSavedPlace(_ draft: SavedPlaceDraft) async throws -> SavedPlace
    func updateSavedPlace(_ draft: SavedPlaceDraft, id: UUID) async throws -> SavedPlace
    func deleteSavedPlace(id: UUID) async throws
    func travelPlan(for eventID: UUID) async throws -> EventTravelPlan?
    func saveTravelPlan(
        _ draft: TravelPlanDraft,
        for eventID: UUID
     ) async throws -> EventTravelPlan
    func deleteTravelPlan(for eventID: UUID) async throws
    func previewTravelPlan(for eventID: UUID) async throws -> TravelPreview
    func previewTravelPlan(
        _ draft: TravelPlanDraft,
        for eventID: UUID
     ) async throws -> TravelPreview
}

public actor RemoteTravelPlanningStore: TravelPlanningStore {
    private let baseURL: URL
    private let transport: any HTTPTransport
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        baseURL: URL,
        transport: any HTTPTransport = URLSessionHTTPTransport()
     ) {
        self.baseURL = baseURL
        self.transport = transport
        encoder = JSONEncoder()
        decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
     }

    // MARK: Saved places

    public func savedPlaces() async throws -> [SavedPlace] {
        try await sendAndDecode(HTTPRequest(method: .get, url: savedPlacesURL))
     }

    public func createSavedPlace(_ draft: SavedPlaceDraft) async throws -> SavedPlace {
        try draft.validate()
        return try await sendAndDecode(HTTPRequest(
            method: .post,
            url: savedPlacesURL,
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(draft)
         ))
     }

    public func updateSavedPlace(
        _ draft: SavedPlaceDraft,
        id: UUID
     ) async throws -> SavedPlace {
        try draft.validate()
        return try await sendAndDecode(HTTPRequest(
            method: .put,
            url: savedPlacesURL.appending(path: id.uuidString),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(draft)
         ))
     }

    public func deleteSavedPlace(id: UUID) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: savedPlacesURL.appending(path: id.uuidString)
         ))
        try response.requireSuccess()
     }

    // MARK: Travel plans

    public func travelPlan(for eventID: UUID) async throws -> EventTravelPlan? {
        let response = try await transport.send(HTTPRequest(
            method: .get,
            url: eventTravelPlanURL(eventID)
         ))
        guard response.statusCode != 404 else { return nil }
        try response.requireSuccess()
        return try decoder.decode(EventTravelPlan.self, from: response.body)
     }

    public func saveTravelPlan(
        _ draft: TravelPlanDraft,
        for eventID: UUID
     ) async throws -> EventTravelPlan {
        try draft.validate()
        return try await sendAndDecode(HTTPRequest(
            method: .put,
            url: eventTravelPlanURL(eventID),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(draft)
         ))
     }

    public func deleteTravelPlan(for eventID: UUID) async throws {
        let response = try await transport.send(HTTPRequest(
            method: .delete,
            url: eventTravelPlanURL(eventID)
         ))
        try response.requireSuccess()
     }

    // MARK: Previews

    public func previewTravelPlan(for eventID: UUID) async throws -> TravelPreview {
        let response = try await transport.send(HTTPRequest(
            method: .post,
            url: previewURL(eventID)
         ))
        try response.requireSuccess()
        return try decoder.decode(TravelPreview.self, from: response.body)
     }

    public func previewTravelPlan(
        _ draft: TravelPlanDraft,
        for eventID: UUID
     ) async throws -> TravelPreview {
        try draft.validate()
        return try await sendAndDecode(HTTPRequest(
            method: .post,
            url: previewURL(eventID),
            headers: ["Content-Type": "application/json"],
            body: try encoder.encode(draft)
         ))
     }

    // MARK: URL helpers

    private var savedPlacesURL: URL {
        baseURL.appending(path: "v1/saved-places")
     }

    private func eventTravelPlanURL(_ eventID: UUID) -> URL {
        baseURL
            .appending(path: "v1/events")
            .appending(path: eventID.uuidString)
            .appending(path: "travel-plan")
     }

    private func previewURL(_ eventID: UUID) -> URL {
        eventTravelPlanURL(eventID).appending(path: "preview")
     }

    private func sendAndDecode<Value: Decodable>(_ request: HTTPRequest) async throws -> Value {
        let response = try await transport.send(request)
        try response.requireSuccess()
        return try decoder.decode(Value.self, from: response.body)
     }
}
