import Foundation

public struct ExpenseDraft: Codable, Equatable, Sendable {
  public var spentOn: String
  public var amountMinor: Int
  public var currency: String
  public var category: String
  public var merchant: String?
  public var note: String?

  public init(spentOn: String, amountMinor: Int, currency: String,
              category: String, merchant: String?, note: String?) {
    self.spentOn = spentOn
    self.amountMinor = amountMinor
    self.currency = currency
    self.category = category
    self.merchant = merchant
    self.note = note
  }

  private enum CodingKeys: String, CodingKey {
    case spentOn, amountMinor, currency, category, merchant, note
  }

  public func encode(to encoder: Encoder) throws {
    var fields = encoder.container(keyedBy: CodingKeys.self)
    try fields.encode(spentOn, forKey: .spentOn)
    try fields.encode(amountMinor, forKey: .amountMinor)
    try fields.encode(currency, forKey: .currency)
    try fields.encode(category, forKey: .category)
    // The API requires nullable fields to be present even when empty.
    try fields.encode(merchant, forKey: .merchant)
    try fields.encode(note, forKey: .note)
  }
}

public struct FamilyExpense: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let familyID: String
  public let createdByMemberID: String
  public let spentOn: String
  public let amountMinor: Int
  public let currency: String
  public let category: String
  public let merchant: String?
  public let note: String?
  public let version: Int
  public let createdAt: String
  public let updatedAt: String

  public init(id: UUID, familyID: String, createdByMemberID: String, spentOn: String,
              amountMinor: Int, currency: String, category: String, merchant: String?,
              note: String?, version: Int, createdAt: String, updatedAt: String) {
    self.id = id
    self.familyID = familyID
    self.createdByMemberID = createdByMemberID
    self.spentOn = spentOn
    self.amountMinor = amountMinor
    self.currency = currency
    self.category = category
    self.merchant = merchant
    self.note = note
    self.version = version
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

public struct ExpensePage: Codable, Equatable, Sendable {
  public let expenses: [FamilyExpense]
  public let nextCursor: String?
  public init(expenses: [FamilyExpense], nextCursor: String?) {
    self.expenses = expenses
    self.nextCursor = nextCursor
  }
}

public protocol ExpenseStore: Sendable {
  func list(limit: Int, cursor: String?) async throws -> ExpensePage
  func create(id: UUID, draft: ExpenseDraft) async throws -> FamilyExpense
  func update(id: UUID, version: Int, draft: ExpenseDraft) async throws -> FamilyExpense
  func delete(id: UUID, version: Int) async throws
}

// A string-to-minor-units conversion must never round a floating-point amount.
public enum ExpenseAmount {
  public static func usdMinorUnits(_ raw: String) -> Int? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let parts = text.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count <= 2, let dollars = parts.first,
          !dollars.isEmpty, dollars.allSatisfy(\.isNumber),
          let whole = Int(dollars), whole <= 9_999_999_999 else { return nil }
    let fraction = parts.count == 2 ? String(parts[1]) : ""
    guard fraction.count <= 2, fraction.allSatisfy(\.isNumber),
          let cents = Int(fraction.padding(toLength: 2, withPad: "0", startingAt: 0)) else { return nil }
    let total = whole * 100 + cents
    return total > 0 && total <= 1_000_000_000_000 ? total : nil
  }
}

/// Content-free feedback: never include a server response body or Expense details.
public enum ExpenseSaveFeedback {
  public static func message(for error: Error, expenseSaved: Bool) -> String {
    if expenseSaved {
      return "The Expense was saved, but selected Pantry items were not. Resolve duplicates or deselect them before retrying."
    }
    if case let RemoteStoreError.requestFailed(statusCode) = error {
      switch statusCode {
      case 400:
        return "The Expense was rejected by the server and was not saved. Review its fields and retry."
      case 401, 403:
        return "Parent access is required to save this Expense. It was not saved."
      case 503:
        return "Expenses are temporarily unavailable. The save could not be confirmed; retry without changing the entry."
      case 500...599:
        return "The Expense server could not confirm the save. Retry without changing the entry to avoid duplicates."
      default:
        return "The Expense save could not be confirmed (HTTP \(statusCode)). Retry without changing the entry."
      }
    }
    return "The Expense save could not be confirmed. Retry without changing the entry; duplicate retries use the same ID."
  }
}

public actor RemoteExpenseStore: ExpenseStore {
  private let expensesURL: URL
  private let transport: any HTTPTransport
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
    expensesURL = baseURL.appending(path: "v1/household/expenses")
    self.transport = transport
  }

  public func list(limit: Int = 50, cursor: String? = nil) async throws -> ExpensePage {
    var url = expensesURL
    if let cursor {
      url = url.appending(queryItems: [URLQueryItem(name: "limit", value: String(limit)),
                                       URLQueryItem(name: "cursor", value: cursor)])
    }
    return try await sendAndDecode(HTTPRequest(method: .get, url: url))
  }

  public func create(id: UUID, draft: ExpenseDraft) async throws -> FamilyExpense {
    try await sendAndDecode(HTTPRequest(method: .put, url: expenseURL(id),
      headers: ["Content-Type": "application/json"], body: try encoder.encode(draft)))
  }

  public func update(id: UUID, version: Int, draft: ExpenseDraft) async throws -> FamilyExpense {
    try await sendAndDecode(HTTPRequest(method: .patch, url: expenseURL(id),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(ExpenseCorrection(draft: draft, expectedVersion: version))))
  }

  public func delete(id: UUID, version: Int) async throws {
    let response = try await transport.send(HTTPRequest(method: .delete, url: expenseURL(id),
      headers: ["Content-Type": "application/json"],
      body: try encoder.encode(ExpenseDeletion(expectedVersion: version))))
    try response.requireSuccess()
  }

  private func expenseURL(_ id: UUID) -> URL {
    expensesURL.appending(path: id.uuidString.lowercased())
  }

  private func sendAndDecode<Value: Decodable>(_ request: HTTPRequest) async throws -> Value {
    let response = try await transport.send(request)
    try response.requireSuccess()
    return try decoder.decode(Value.self, from: response.body)
  }
}

private struct ExpenseCorrection: Encodable {
  private enum CodingKeys: String, CodingKey {
    case spentOn, amountMinor, currency, category, merchant, note, expectedVersion
  }

  let spentOn: String
  let amountMinor: Int
  let currency: String
  let category: String
  let merchant: String?
  let note: String?
  let expectedVersion: Int

  init(draft: ExpenseDraft, expectedVersion: Int) {
    spentOn = draft.spentOn
    amountMinor = draft.amountMinor
    currency = draft.currency
    category = draft.category
    merchant = draft.merchant
    note = draft.note
    self.expectedVersion = expectedVersion
  }

  func encode(to encoder: Encoder) throws {
    var fields = encoder.container(keyedBy: CodingKeys.self)
    try fields.encode(spentOn, forKey: .spentOn)
    try fields.encode(amountMinor, forKey: .amountMinor)
    try fields.encode(currency, forKey: .currency)
    try fields.encode(category, forKey: .category)
    try fields.encode(merchant, forKey: .merchant)
    try fields.encode(note, forKey: .note)
    try fields.encode(expectedVersion, forKey: .expectedVersion)
  }
}

private struct ExpenseDeletion: Encodable {
  let expectedVersion: Int
}
