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

public protocol ShoppingStore: Sendable {
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
