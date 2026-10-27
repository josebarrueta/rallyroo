import Foundation
import CryptoKit

public struct ConflictNotification: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let message: String
    public let createdAt: Date

    public init(id: UUID = UUID(), message: String, createdAt: Date = .now) {
        self.id = id
        self.message = message
        self.createdAt = createdAt
    }
}

public protocol ConflictNotificationStore: Sendable {
    func save(_ notification: ConflictNotification) async throws
    func clear() async throws
    func notifications() async throws -> [ConflictNotification]
}

public actor LocalConflictNotificationStore: ConflictNotificationStore {
    private let storageURL: URL
    public init(storageURL: URL, accountID: String? = nil) {
        if let accountID {
            let digest = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
            self.storageURL = storageURL.deletingLastPathComponent()
                .appendingPathComponent("\(storageURL.deletingPathExtension().lastPathComponent)-\(digest).json")
        } else {
            self.storageURL = storageURL
        }
    }
    public func save(_ notification: ConflictNotification) async throws {
        var saved = try await notifications()
        saved.append(notification)
        try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(saved).write(to: storageURL, options: .atomic)
    }
    public func clear() async throws {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return }
        try FileManager.default.removeItem(at: storageURL)
    }
    public func notifications() async throws -> [ConflictNotification] {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return [] }
        return try JSONDecoder().decode([ConflictNotification].self, from: Data(contentsOf: storageURL))
    }
}
