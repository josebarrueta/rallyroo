import Combine
import Foundation
import CryptoKit
import ImageIO

public extension Notification.Name {
    static let sharedScheduleCaptureReceived = Notification.Name("sharedScheduleCaptureReceived")
}

@MainActor
public final class SharedScheduleCaptureInbox: ObservableObject {
    @Published public var pendingImageData: Data?

    private let dequeue: () throws -> Data?
    private let discardQueued: () throws -> Void
    private let scopedDequeue: ((String) throws -> Data?)?
    private var activeAccountID: String?

    public convenience init() {
        self.init(
            dequeue: { try SharedScheduleCaptureQueue.appGroup().dequeueOldest() },
            discardQueued: { try SharedScheduleCaptureQueue.appGroup().discardAll() },
            scopedDequeue: { try SharedScheduleCaptureQueue.appGroup().dequeueOldest(for: $0) }
        )
    }

    public convenience init(dequeue: @escaping () throws -> Data?) {
        self.init(dequeue: dequeue, discardQueued: { try SharedScheduleCaptureQueue.appGroup().discardAll() })
    }

    public init(
        dequeue: @escaping () throws -> Data?,
        discardQueued: @escaping () throws -> Void,
        scopedDequeue: ((String) throws -> Data?)? = nil
    ) {
        self.dequeue = dequeue
        self.discardQueued = discardQueued
        self.scopedDequeue = scopedDequeue
    }

    public func discard() {
        activeAccountID = nil
        pendingImageData = nil
        try? discardQueued()
    }

    public func receiveNext() {
        guard pendingImageData == nil else { return }
        pendingImageData = try? dequeue()
    }

    public func receiveNext(for accountID: String) {
        if let activeAccountID, activeAccountID != accountID { pendingImageData = nil }
        activeAccountID = accountID
        guard pendingImageData == nil else { return }
        if let scopedDequeue {
            pendingImageData = try? scopedDequeue(accountID)
        } else {
            pendingImageData = try? dequeue()
        }
    }
}

public enum SharedScheduleCaptureQueueError: Error, Equatable, Sendable {
    case appGroupUnavailable
    case invalidImage
    case imageTooLarge
}

public struct SharedScheduleCaptureQueue: Sendable {
    public static let appGroupIdentifier = "group.dev.rallyroo.app"
    private static let maximumImageBytes = 20 * 1_024 * 1_024
    private static let maximumPixelCount = 50_000_000
    private static let maximumQueuedImages = 5

    private let directory: URL

    public init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var resourceURL = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try resourceURL.setResourceValues(values)
    }

    public static func appGroup() throws -> Self {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) else {
            throw SharedScheduleCaptureQueueError.appGroupUnavailable
        }
        return try Self(
            directory: container.appending(path: "SharedScheduleCaptures", directoryHint: .isDirectory)
        )
    }

    public func enqueue(_ imageData: Data) throws {
        try validate(imageData)
        try pruneIfNeeded()
        let owner = try sharingOwner() ?? "signed-out"
        let destination = directory
            .appending(path: "\(Date.now.timeIntervalSince1970)-\(UUID().uuidString)--\(owner).rrcapture")
        try imageData.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    public func dequeueOldest() throws -> Data? {
        try dequeueOldest(allowedOwner: nil)
    }

    /// Bind newly shared images to this account, and reject other-account and
    /// legacy unscoped captures. Explicitly signed-out shares belong to the next login.
    public func dequeueOldest(for accountID: String) throws -> Data? {
        let owner = SHA256.hash(data: Data(accountID.utf8)).map { String(format: "%02x", $0) }.joined()
        try Data(owner.utf8).write(to: ownerURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return try dequeueOldest(allowedOwner: owner)
    }

    private func dequeueOldest(allowedOwner: String?) throws -> Data? {
        for source in try queuedCaptureURLs() {
            let claimed = directory.appending(path: "\(UUID().uuidString).processing")
            do {
                try FileManager.default.moveItem(at: source, to: claimed)
            } catch {
                continue
            }
            defer { try? FileManager.default.removeItem(at: claimed) }
            if let allowedOwner {
                let components = source.deletingPathExtension().lastPathComponent.components(separatedBy: "--")
                guard components.count == 2,
                      components[1] == allowedOwner || components[1] == "signed-out" else { continue }
            }
            let data = try Data(contentsOf: claimed, options: .mappedIfSafe)
            try validate(data)
            return data
        }
        return nil
    }

    public func discardAll() throws {
        if FileManager.default.fileExists(atPath: ownerURL.path) {
            try FileManager.default.removeItem(at: ownerURL)
        }
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            if url.pathExtension == "rrcapture" || url.pathExtension == "processing" {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    private var ownerURL: URL { directory.appendingPathComponent(".capture-owner") }

    private func sharingOwner() throws -> String? {
        do {
            let data = try Data(contentsOf: ownerURL)
            guard let owner = String(data: data, encoding: .utf8),
                  owner.count == 64, owner.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else {
                throw SharedScheduleCaptureQueueError.invalidImage
            }
            return owner
        } catch CocoaError.fileReadNoSuchFile {
            return nil
        }
    }

    private func pruneIfNeeded() throws {
        let captures = try queuedCaptureURLs()
        let excessCount = max(0, captures.count - Self.maximumQueuedImages + 1)
        for capture in captures.prefix(excessCount) {
            try? FileManager.default.removeItem(at: capture)
        }
    }

    private func queuedCaptureURLs() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        .filter { $0.pathExtension == "rrcapture" }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private func validate(_ data: Data) throws {
        guard !data.isEmpty else { throw SharedScheduleCaptureQueueError.invalidImage }
        guard data.count <= Self.maximumImageBytes else {
            throw SharedScheduleCaptureQueueError.imageTooLarge
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber,
              width.intValue > 0,
              height.intValue > 0,
              width.intValue <= Self.maximumPixelCount / height.intValue else {
            throw SharedScheduleCaptureQueueError.invalidImage
        }
    }
}
