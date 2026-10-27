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

    func testQueuedImagesAreExcludedFromDeviceBackups() throws {
        _ = try SharedScheduleCaptureQueue(directory: directory)
        XCTAssertEqual(try directory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    @MainActor
    func testDiscardClearsMemoryAndOnlyQueueOwnedFiles() throws {
        let queue = try SharedScheduleCaptureQueue(directory: directory)
        try Data("queued".utf8).write(to: directory.appending(path: "test.rrcapture"))
        try Data("claimed".utf8).write(to: directory.appending(path: "test.processing"))
        let unrelated = directory.appending(path: "unrelated.txt")
        try Data("keep".utf8).write(to: unrelated)
        let inbox = SharedScheduleCaptureInbox(dequeue: { nil }, discardQueued: { try queue.discardAll() })
        inbox.pendingImageData = Data("private capture".utf8)
        inbox.discard()
        XCTAssertNil(inbox.pendingImageData)
        XCTAssertNil(try queue.dequeueOldest())
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["unrelated.txt"])
    }

    func testColdLaunchRejectsOtherAccountAndLegacyCapturesButKeepsFreshSignedOutShare() throws {
        let queue = try SharedScheduleCaptureQueue(directory: directory)
        let image = try captureImage()
        XCTAssertNil(try queue.dequeueOldest(for: "account-a"))
        try queue.enqueue(image)
        // New process, with no in-memory session-end callback.
        let relaunched = try SharedScheduleCaptureQueue(directory: directory)
        XCTAssertNil(try relaunched.dequeueOldest(for: "account-b"))
        try image.write(to: directory.appendingPathComponent("legacy.rrcapture"))
        XCTAssertNil(try relaunched.dequeueOldest(for: "account-b"))
        try relaunched.discardAll()
        try relaunched.enqueue(image)
        XCTAssertEqual(try relaunched.dequeueOldest(for: "account-b"), image)
    }

    func testSignedOutLaunchPreservesOwnershipOfOldCapturesAndAcceptsOnlyFreshSharesForNextLogin() throws {
        let queue = try SharedScheduleCaptureQueue(directory: directory)
        let image = try captureImage()
        XCTAssertNil(try queue.dequeueOldest(for: "account-a"))
        try queue.enqueue(image)
        try queue.markSignedOut()
        try queue.enqueue(image)
        XCTAssertEqual(try queue.dequeueOldest(for: "account-b"), image)
        XCTAssertNil(try queue.dequeueOldest(for: "account-b"))
    }

    func testColdLaunchKeepsSameAccountCaptureWithoutLeakingAccountIdentifier() throws {
        let queue = try SharedScheduleCaptureQueue(directory: directory)
        let image = try captureImage()
        let accountID = "private-account/../../name"
        XCTAssertNil(try queue.dequeueOldest(for: accountID))
        try queue.enqueue(image)
        let filenames = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertFalse(filenames.joined().contains("private-account"))
        XCTAssertFalse(try String(contentsOf: directory.appendingPathComponent(".capture-owner"), encoding: .utf8).contains(accountID))
        let relaunched = try SharedScheduleCaptureQueue(directory: directory)
        XCTAssertEqual(try relaunched.dequeueOldest(for: accountID), image)
    }

    @MainActor
    func testChangingAccountDropsAnInMemoryCaptureEvenWithoutExplicitSignOut() throws {
        let inbox = SharedScheduleCaptureInbox(
            dequeue: { XCTFail("Scoped intake must not fall back to unscoped reads"); return nil },
            discardQueued: {},
            scopedDequeue: { Data($0.utf8) }
        )
        inbox.receiveNext(for: "account-a")
        XCTAssertEqual(inbox.pendingImageData, Data("account-a".utf8))
        inbox.receiveNext(for: "account-b")
        XCTAssertEqual(inbox.pendingImageData, Data("account-b".utf8))
    }

    private func captureImage() throws -> Data {
        try XCTUnwrap(Data(base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        ))
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
