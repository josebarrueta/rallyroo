import Foundation

public struct ShoppingRoutine: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let familyID: String
  public let storeName: String
  public let intervalWeeks: Int
  public let preferredWeekday: Int?
  public let createdByMemberID: String
  public let createdAt: Date
  public let updatedAt: Date

  public init(
    id: UUID,
    familyID: String,
    storeName: String,
    intervalWeeks: Int,
    preferredWeekday: Int?,
    createdByMemberID: String,
    createdAt: Date,
    updatedAt: Date
  ) {
    self.id = id
    self.familyID = familyID
    self.storeName = storeName
    self.intervalWeeks = intervalWeeks
    self.preferredWeekday = preferredWeekday
    self.createdByMemberID = createdByMemberID
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

public struct ShoppingRoutineDraft: Codable, Equatable, Sendable {
  public let storeName: String
  public let intervalWeeks: Int
  public let preferredWeekday: Int?

  public init(storeName: String, intervalWeeks: Int, preferredWeekday: Int?) {
    self.storeName = storeName
    self.intervalWeeks = intervalWeeks
    self.preferredWeekday = preferredWeekday
  }
}

public struct PantryItem: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let familyID: String
  public let name: String
  public let category: String?
  public let unit: String?
  public let critical: Bool
  public let expectedDurationDays: Int?
  public let minimumQuantity: Double?
  public let targetQuantity: Double?
  public let routineIDs: [UUID]
  public let createdByMemberID: String
  public let createdAt: Date
  public let updatedAt: Date

  public init(
    id: UUID,
    familyID: String,
    name: String,
    category: String?,
    unit: String?,
    critical: Bool,
    expectedDurationDays: Int?,
    minimumQuantity: Double?,
    targetQuantity: Double?,
    routineIDs: [UUID],
    createdByMemberID: String,
    createdAt: Date,
    updatedAt: Date
  ) {
    self.id = id
    self.familyID = familyID
    self.name = name
    self.category = category
    self.unit = unit
    self.critical = critical
    self.expectedDurationDays = expectedDurationDays
    self.minimumQuantity = minimumQuantity
    self.targetQuantity = targetQuantity
    self.routineIDs = routineIDs
    self.createdByMemberID = createdByMemberID
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

public struct PantryItemDraft: Codable, Equatable, Sendable {
  public let name: String
  public let category: String?
  public let unit: String?
  public let critical: Bool
  public let expectedDurationDays: Int?
  public let minimumQuantity: Double?
  public let targetQuantity: Double?
  public let routineIDs: [UUID]

  public init(
    name: String,
    category: String?,
    unit: String?,
    critical: Bool,
    expectedDurationDays: Int?,
    minimumQuantity: Double?,
    targetQuantity: Double?,
    routineIDs: [UUID]
  ) {
    self.name = name
    self.category = category
    self.unit = unit
    self.critical = critical
    self.expectedDurationDays = expectedDurationDays
    self.minimumQuantity = minimumQuantity
    self.targetQuantity = targetQuantity
    self.routineIDs = routineIDs
  }
}

public struct ShoppingCatalog: Codable, Equatable, Sendable {
  public let routines: [ShoppingRoutine]
  public let items: [PantryItem]

  public init(routines: [ShoppingRoutine], items: [PantryItem]) {
    self.routines = routines
    self.items = items
  }
}

public enum ShoppingItemRequestStatus: String, Codable, Equatable, Sendable {
  case open
  case resolved
  case cancelled
}

public struct ShoppingItemRequest: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let familyID: String
  public let itemID: UUID
  public let requestedByMemberID: String
  public let quantity: Double?
  public let note: String?
  public let status: ShoppingItemRequestStatus
  public let requestedAt: Date
  public let resolvedAt: Date?
  public let resolvedByMemberID: String?

  public init(
    id: UUID,
    familyID: String,
    itemID: UUID,
    requestedByMemberID: String,
    quantity: Double?,
    note: String?,
    status: ShoppingItemRequestStatus,
    requestedAt: Date,
    resolvedAt: Date?,
    resolvedByMemberID: String?
  ) {
    self.id = id
    self.familyID = familyID
    self.itemID = itemID
    self.requestedByMemberID = requestedByMemberID
    self.quantity = quantity
    self.note = note
    self.status = status
    self.requestedAt = requestedAt
    self.resolvedAt = resolvedAt
    self.resolvedByMemberID = resolvedByMemberID
  }
}

public struct ShoppingItemRequestDraft: Codable, Equatable, Sendable {
  public let itemID: UUID
  public let quantity: Double?
  public let note: String?

  public init(itemID: UUID, quantity: Double?, note: String?) {
    self.itemID = itemID
    self.quantity = quantity
    self.note = note
  }
}

public enum StockLevel: String, Codable, Equatable, Sendable {
  case enough
  case low
  case out
}

public struct StockObservation: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let familyID: String
  public let itemID: UUID
  public let observedByMemberID: String
  public let level: StockLevel
  public let quantity: Double?
  public let note: String?
  public let observedAt: Date

  public init(
    id: UUID,
    familyID: String,
    itemID: UUID,
    observedByMemberID: String,
    level: StockLevel,
    quantity: Double?,
    note: String?,
    observedAt: Date
  ) {
    self.id = id
    self.familyID = familyID
    self.itemID = itemID
    self.observedByMemberID = observedByMemberID
    self.level = level
    self.quantity = quantity
    self.note = note
    self.observedAt = observedAt
  }
}

public struct StockObservationInput: Codable, Equatable, Sendable {
  public let level: StockLevel
  public let quantity: Double?
  public let note: String?

  public init(level: StockLevel, quantity: Double?, note: String?) {
    self.level = level
    self.quantity = quantity
    self.note = note
  }
}

public struct ShoppingEvidence: Codable, Equatable, Sendable {
  public let openRequests: [ShoppingItemRequest]
  public let latestObservations: [StockObservation]

  public init(
    openRequests: [ShoppingItemRequest],
    latestObservations: [StockObservation]
  ) {
    self.openRequests = openRequests
    self.latestObservations = latestObservations
  }
}

public enum ShoppingTripStatus: String, Codable, Sendable {
  case draft
  case finalized
  case completed
}

public enum ShoppingOutcomeStatus: String, Codable, Sendable {
  case purchased
  case skipped
  case unavailable
  case deferred
}

public struct ShoppingOutcomeInput: Codable, Equatable, Sendable {
  public let itemID: UUID
  public let status: ShoppingOutcomeStatus
  public let quantity: Double?
  public let price: Double?

  public init(itemID: UUID, status: ShoppingOutcomeStatus, quantity: Double?, price: Double?) {
    self.itemID = itemID
    self.status = status
    self.quantity = quantity
    self.price = price
  }
}

public struct ShoppingPurchase: Codable, Equatable, Sendable {
  public let familyID: String
  public let tripID: UUID
  public let itemID: UUID
  public let purchasedAt: Date
  public let quantity: Double?
  public let price: Double?

  public init(familyID: String, tripID: UUID, itemID: UUID,
              purchasedAt: Date, quantity: Double?, price: Double?) {
    self.familyID = familyID
    self.tripID = tripID
    self.itemID = itemID
    self.purchasedAt = purchasedAt
    self.quantity = quantity
    self.price = price
  }
}

public enum ShoppingTripDecision: String, Codable, Sendable {
  case buy
  case checkAtHome = "check_at_home"
  case skip
}

public struct ShoppingTripEntry: Codable, Equatable, Sendable {
  public let itemID: UUID
  public let decision: ShoppingTripDecision
  public let reason: String
  public let requestIDs: [UUID]
  public let observationID: UUID?

  public init(itemID: UUID, decision: ShoppingTripDecision, reason: String,
              requestIDs: [UUID], observationID: UUID?) {
    self.itemID = itemID
    self.decision = decision
    self.reason = reason
    self.requestIDs = requestIDs
    self.observationID = observationID
  }
}

public struct ShoppingTripPlan: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let familyID: String
  public let routineID: UUID
  public let plannedFor: String
  public let status: ShoppingTripStatus
  public let version: Int
  public let entries: [ShoppingTripEntry]
  public let outcomes: [ShoppingOutcomeInput]
  public let createdByMemberID: String
  public let createdAt: Date
  public let updatedAt: Date
  public let finalizedAt: Date?
  public let finalizedByMemberID: String?
  public let completedAt: Date?
  public let completedByMemberID: String?

  public init(id: UUID, familyID: String, routineID: UUID, plannedFor: String,
              status: ShoppingTripStatus, version: Int, entries: [ShoppingTripEntry],
              outcomes: [ShoppingOutcomeInput], createdByMemberID: String,
              createdAt: Date, updatedAt: Date,
              finalizedAt: Date?, finalizedByMemberID: String?,
              completedAt: Date?, completedByMemberID: String?) {
    self.id = id
    self.familyID = familyID
    self.routineID = routineID
    self.plannedFor = plannedFor
    self.status = status
    self.version = version
    self.entries = entries
    self.outcomes = outcomes
    self.createdByMemberID = createdByMemberID
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.finalizedAt = finalizedAt
    self.finalizedByMemberID = finalizedByMemberID
    self.completedAt = completedAt
    self.completedByMemberID = completedByMemberID
  }
}

public struct ShoppingTripDecisionInput: Codable, Equatable, Sendable {
  public let itemID: UUID
  public let decision: ShoppingTripDecision

  public init(itemID: UUID, decision: ShoppingTripDecision) {
    self.itemID = itemID
    self.decision = decision
  }
}

public protocol ShoppingStore: Sendable {
  func purchases() async throws -> [ShoppingPurchase]
  func completeTrip(id: UUID, expectedVersion: Int,
                    outcomes: [ShoppingOutcomeInput]) async throws -> ShoppingTripPlan
  func trips() async throws -> [ShoppingTripPlan]
  func prepareTrip(id: UUID, routineID: UUID, plannedFor: String) async throws -> ShoppingTripPlan
  func reviewTrip(id: UUID, expectedVersion: Int,
                  entries: [ShoppingTripDecisionInput]) async throws -> ShoppingTripPlan
  func finalizeTrip(id: UUID, expectedVersion: Int) async throws -> ShoppingTripPlan
  func catalog() async throws -> ShoppingCatalog
  func evidence() async throws -> ShoppingEvidence
  func saveRoutine(id: UUID, draft: ShoppingRoutineDraft) async throws -> ShoppingRoutine
  func deleteRoutine(id: UUID) async throws
  func savePantryItem(id: UUID, draft: PantryItemDraft) async throws -> PantryItem
  func deletePantryItem(id: UUID) async throws
  func requestItem(id: UUID, draft: ShoppingItemRequestDraft) async throws -> ShoppingItemRequest
  func closeRequest(
    id: UUID, status: ShoppingItemRequestStatus
  ) async throws -> ShoppingItemRequest
  func observeStock(
    id: UUID, itemID: UUID, input: StockObservationInput
  ) async throws -> StockObservation
}

public actor RemoteShoppingStore: ShoppingStore {
  private let shoppingURL: URL
  private let transport: any HTTPTransport
  private let encoder: JSONEncoder
  private let decoder: JSONDecoder

  public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
    shoppingURL = baseURL.appending(path: "v1/shopping")
    self.transport = transport
    encoder = JSONEncoder()
    decoder = JSONDecoder()
    encoder.dateEncodingStrategy = .iso8601
    decoder.dateDecodingStrategy = .iso8601
  }

  public func purchases() async throws -> [ShoppingPurchase] {
    try await sendAndDecode(HTTPRequest(method: .get, url: shoppingURL.appending(path: "purchases")))
  }

  public func completeTrip(id: UUID, expectedVersion: Int,
                           outcomes: [ShoppingOutcomeInput]) async throws -> ShoppingTripPlan {
    try await sendAndDecode(HTTPRequest(
      method: .post, url: tripURL(id).appending(path: "complete"),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(TripCompletion(expectedVersion: expectedVersion, outcomes: outcomes))
    ))
  }

  public func trips() async throws -> [ShoppingTripPlan] {
    try await sendAndDecode(HTTPRequest(method: .get, url: shoppingURL.appending(path: "trips")))
  }

  public func prepareTrip(id: UUID, routineID: UUID, plannedFor: String) async throws -> ShoppingTripPlan {
    try await sendAndDecode(HTTPRequest(
      method: .put, url: tripURL(id), headers: ["Content-Type": "application/json"],
      body: try encoder.encode(TripPreparation(routineID: routineID, plannedFor: plannedFor))
    ))
  }

  public func reviewTrip(id: UUID, expectedVersion: Int,
                         entries: [ShoppingTripDecisionInput]) async throws -> ShoppingTripPlan {
    try await sendAndDecode(HTTPRequest(
      method: .patch, url: tripURL(id), headers: ["Content-Type": "application/json"],
      body: try encoder.encode(TripReview(expectedVersion: expectedVersion, entries: entries))
    ))
  }

  public func finalizeTrip(id: UUID, expectedVersion: Int) async throws -> ShoppingTripPlan {
    try await sendAndDecode(HTTPRequest(
      method: .post, url: tripURL(id).appending(path: "finalize"),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(TripFinalization(expectedVersion: expectedVersion))
    ))
  }

  private func tripURL(_ id: UUID) -> URL {
    shoppingURL.appending(path: "trips").appending(path: id.uuidString.lowercased())
  }

  public func catalog() async throws -> ShoppingCatalog {
    try await sendAndDecode(HTTPRequest(
      method: .get,
      url: shoppingURL.appending(path: "catalog")
    ))
  }

  public func evidence() async throws -> ShoppingEvidence {
    try await sendAndDecode(HTTPRequest(
      method: .get,
      url: shoppingURL.appending(path: "evidence")
    ))
  }

  public func saveRoutine(id: UUID, draft: ShoppingRoutineDraft) async throws -> ShoppingRoutine {
    try await sendAndDecode(HTTPRequest(
      method: .put,
      url: shoppingURL.appending(path: "routines").appending(path: id.uuidString.lowercased()),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(draft)
    ))
  }

  public func deleteRoutine(id: UUID) async throws {
    try await send(HTTPRequest(
      method: .delete,
      url: shoppingURL.appending(path: "routines").appending(path: id.uuidString.lowercased())
    ))
  }

  public func savePantryItem(id: UUID, draft: PantryItemDraft) async throws -> PantryItem {
    try await sendAndDecode(HTTPRequest(
      method: .put,
      url: shoppingURL.appending(path: "pantry-items").appending(path: id.uuidString.lowercased()),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(draft)
    ))
  }

  public func deletePantryItem(id: UUID) async throws {
    try await send(HTTPRequest(
      method: .delete,
      url: shoppingURL.appending(path: "pantry-items").appending(path: id.uuidString.lowercased())
    ))
  }

  public func requestItem(
    id: UUID,
    draft: ShoppingItemRequestDraft
  ) async throws -> ShoppingItemRequest {
    try await sendAndDecode(HTTPRequest(
      method: .put,
      url: shoppingURL.appending(path: "requests").appending(path: id.uuidString.lowercased()),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(draft)
    ))
  }

  public func closeRequest(
    id: UUID,
    status: ShoppingItemRequestStatus
  ) async throws -> ShoppingItemRequest {
    try await sendAndDecode(HTTPRequest(
      method: .patch,
      url: shoppingURL.appending(path: "requests").appending(path: id.uuidString.lowercased()),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(ShoppingRequestStatusUpdate(status: status))
    ))
  }

  public func observeStock(
    id: UUID,
    itemID: UUID,
    input: StockObservationInput
  ) async throws -> StockObservation {
    try await sendAndDecode(HTTPRequest(
      method: .put,
      url: shoppingURL.appending(path: "stock-observations")
        .appending(path: id.uuidString.lowercased()),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(StockObservationRequest(itemID: itemID, input: input))
    ))
  }

  private func send(_ request: HTTPRequest) async throws {
    let response = try await transport.send(request)
    try response.requireSuccess()
  }

  private func sendAndDecode<Value: Decodable>(_ request: HTTPRequest) async throws -> Value {
    let response = try await transport.send(request)
    try response.requireSuccess()
    return try decoder.decode(Value.self, from: response.body)
  }
}

private struct TripPreparation: Encodable {
  let routineID: UUID
  let plannedFor: String
}

private struct TripReview: Encodable {
  let expectedVersion: Int
  let entries: [ShoppingTripDecisionInput]
}

private struct TripCompletion: Encodable {
  let expectedVersion: Int
  let outcomes: [ShoppingOutcomeInput]
}

private struct TripFinalization: Encodable {
  let expectedVersion: Int
}

private struct ShoppingRequestStatusUpdate: Encodable {
  let status: ShoppingItemRequestStatus
}

private struct StockObservationRequest: Encodable {
  let itemID: UUID
  let level: StockLevel
  let quantity: Double?
  let note: String?

  init(itemID: UUID, input: StockObservationInput) {
    self.itemID = itemID
    level = input.level
    quantity = input.quantity
    note = input.note
  }
}
