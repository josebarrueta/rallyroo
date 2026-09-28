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
      body: try JSONEncoder().encode(ReceiptOCR(ocrText: ocrText)),
      timeoutInterval: 90)
    let response = try await transport.send(request)
    try response.requireSuccess()
    return try JSONDecoder().decode(ReceiptExpenseDraft.self, from: response.body)
  }
}

/// Human-readable, content-free feedback for a rejected receipt proposal.
/// Never interpolate provider responses or the recognized receipt text.
public enum ReceiptProposalFeedback {
  public static func message(for error: Error) -> String {
    if case let RemoteStoreError.requestFailed(statusCode) = error {
      switch statusCode {
      case 400, 413:
        return "The receipt text was rejected. Try a clearer photo or enter the Expense manually; no photo was saved."
      case 422:
        return "The AI proposed more than 100 items. Try a shorter receipt or enter the Expense manually; no photo was saved."
      case 429:
        return "Too many receipt scans. Please wait before trying again; no photo was saved."
      case 502:
        return "The AI could not return a valid proposal. Try again or enter the Expense manually; no photo was saved."
      case 503:
        return "Receipt AI is unavailable right now. Try again later or enter the Expense manually; no photo was saved."
      case 504:
        return "Receipt AI took too long. Try again or enter the Expense manually; no photo was saved."
      default: break
      }
    }
    if let urlError = error as? URLError, urlError.code == .timedOut {
      return "Receipt AI took too long. Try again or enter the Expense manually; no photo was saved."
    }
    return "The receipt proposal could not be loaded. Try again or enter the Expense manually; no photo was saved."
  }
}

private struct ReceiptOCR: Encodable {
  let ocrText: String
}
