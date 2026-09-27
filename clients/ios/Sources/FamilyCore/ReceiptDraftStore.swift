import Foundation

public struct ReceiptLineSuggestion: Codable, Equatable, Sendable, Identifiable {
  public let name: String
  public let amountMinor: Int?
  public var id: String { name }
  public init(name: String, amountMinor: Int?) {
    self.name = name
    self.amountMinor = amountMinor
  }
}

public struct ReceiptExpenseDraft: Codable, Equatable, Sendable {
  public let merchant: String?
  public let spentOn: String?
  public let totalMinor: Int?
  public let currency: String?
  public let category: String?
  public let lineItems: [ReceiptLineSuggestion]
  public init(merchant: String?, spentOn: String?, totalMinor: Int?, currency: String?,
              category: String?, lineItems: [ReceiptLineSuggestion]) {
    self.merchant = merchant
    self.spentOn = spentOn
    self.totalMinor = totalMinor
    self.currency = currency
    self.category = category
    self.lineItems = lineItems
  }
}

public protocol ReceiptDraftStore: Sendable {
  func propose(ocrText: String) async throws -> ReceiptExpenseDraft
}

public actor RemoteReceiptDraftStore: ReceiptDraftStore {
  private let url: URL
  private let transport: any HTTPTransport
  public init(baseURL: URL, transport: any HTTPTransport = URLSessionHTTPTransport()) {
    url = baseURL.appending(path: "v1/household/receipt-drafts")
    self.transport = transport
  }
  public func propose(ocrText: String) async throws -> ReceiptExpenseDraft {
    let request = HTTPRequest(method: .post, url: url,
      headers: ["Content-Type": "application/json"],
      body: try JSONEncoder().encode(ReceiptOCR(ocrText: ocrText)))
    let response = try await transport.send(request)
    try response.requireSuccess()
    return try JSONDecoder().decode(ReceiptExpenseDraft.self, from: response.body)
  }
}

private struct ReceiptOCR: Encodable {
  let ocrText: String
}
