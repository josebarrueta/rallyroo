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

public protocol ShoppingStore: Sendable {
  func catalog() async throws -> ShoppingCatalog
  func saveRoutine(id: UUID, draft: ShoppingRoutineDraft) async throws -> ShoppingRoutine
  func deleteRoutine(id: UUID) async throws
  func savePantryItem(id: UUID, draft: PantryItemDraft) async throws -> PantryItem
  func deletePantryItem(id: UUID) async throws
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
