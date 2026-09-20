import Combine
import Foundation
import ImageIO

public extension Notification.Name {
    static let sharedScheduleCaptureReceived = Notification.Name("sharedScheduleCaptureReceived")
}

@MainActor
public final class SharedScheduleCaptureInbox: ObservableObject {
    @Published public var pendingImageData: Data?

    private let dequeue: () throws -> Data?

    public init(dequeue: @escaping () throws -> Data? = {
        try SharedScheduleCaptureQueue.appGroup().dequeueOldest()
    }) {
        self.dequeue = dequeue
    }

    public func receiveNext() {
        guard pendingImageData == nil else { return }
        pendingImageData = try? dequeue()
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
        let destination = directory
            .appending(path: "\(Date.now.timeIntervalSince1970)-\(UUID().uuidString).rrcapture")
        try imageData.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    public func dequeueOldest() throws -> Data? {
        for source in try queuedCaptureURLs() {
            let claimed = directory.appending(path: "\(UUID().uuidString).processing")
            do {
                try FileManager.default.moveItem(at: source, to: claimed)
            } catch {
                continue
            }
            defer { try? FileManager.default.removeItem(at: claimed) }
            let data = try Data(contentsOf: claimed, options: .mappedIfSafe)
            try validate(data)
            return data
        }
        return nil
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
