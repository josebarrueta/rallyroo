import Foundation
import XCTest
@testable import FamilyCore

final class SharedScheduleCaptureQueueTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appending(path: "shared-capture-queue-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    @MainActor
    func testInboxReceivesAQueuedImageDuringColdLaunch() throws {
        let image = Data("queued image".utf8)
        var queued: Data? = image
        let inbox = SharedScheduleCaptureInbox {
            defer { queued = nil }
            return queued
        }

        inbox.receiveNext()

        XCTAssertEqual(inbox.pendingImageData, image)
    }

    @MainActor
    func testInboxDoesNotOverwriteAnImageAwaitingReview() throws {
        let first = Data("first".utf8)
        var dequeueCount = 0
        let inbox = SharedScheduleCaptureInbox {
            dequeueCount += 1
            return Data("capture \(dequeueCount)".utf8)
        }
        inbox.pendingImageData = first

        inbox.receiveNext()

        XCTAssertEqual(inbox.pendingImageData, first)
        XCTAssertEqual(dequeueCount, 0)
    }

    func testEnqueuedImageIsConsumedExactlyOnce() throws {
        let queue = try SharedScheduleCaptureQueue(directory: directory)
        let image = try XCTUnwrap(Data(base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ))

        try queue.enqueue(image)

        XCTAssertEqual(try queue.dequeueOldest(), image)
        XCTAssertNil(try queue.dequeueOldest())
    }

    func testRejectsDataThatIsNotAnImage() throws {
        let queue = try SharedScheduleCaptureQueue(directory: directory)

        XCTAssertThrowsError(try queue.enqueue(Data("not an image".utf8))) { error in
            XCTAssertEqual(error as? SharedScheduleCaptureQueueError, .invalidImage)
        }
        XCTAssertNil(try queue.dequeueOldest())
    }

    func testBoundsPendingCaptures() throws {
        let queue = try SharedScheduleCaptureQueue(directory: directory)
        let image = try XCTUnwrap(Data(base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ))

        for _ in 0..<7 { try queue.enqueue(image) }

        var consumed = 0
        while try queue.dequeueOldest() != nil { consumed += 1 }
        XCTAssertEqual(consumed, 5)
    }
}
