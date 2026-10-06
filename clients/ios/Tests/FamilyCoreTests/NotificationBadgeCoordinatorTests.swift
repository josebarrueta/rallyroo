import Foundation
import XCTest
@testable import FamilyCore

@MainActor
final class NotificationBadgeCoordinatorTests: XCTestCase {
    func testLaunchReadDeleteSignOutAndAccountSwitchUseAbsoluteCounts() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let inbox = LocalNotificationInboxStore(storageURL: directory.appendingPathComponent("inbox.json"))
        let first = record(), second = record()
        try await inbox.ingest(first)
        try await inbox.ingest(second)
        var writes: [Int] = []
        let badge = NotificationBadgeCoordinator { writes.append($0) }
        badge.beginSession(accountID: "one")
        await badge.reconcile(inbox: inbox, accountID: "one")
        XCTAssertEqual(badge.unreadCount, 2)
        XCTAssertEqual(writes.last, 2)
        try await inbox.markRead(id: first.id)
        await badge.reconcile(inbox: inbox, accountID: "one")
        XCTAssertEqual(writes.last, 1)
        try await inbox.delete(id: second.id)
        await badge.reconcile(inbox: inbox, accountID: "one")
        XCTAssertEqual(writes.last, 0)
        try await inbox.ingest(record())
        await badge.reconcile(inbox: inbox, accountID: "one")
        XCTAssertEqual(writes.last, 1)
        badge.endSession() // Used for both sign-out and account deletion.
        XCTAssertEqual(writes.last, 0)
        await badge.reconcile(inbox: inbox, accountID: "one")
        XCTAssertEqual(writes.last, 0)
        badge.beginSession(accountID: "two")
        await badge.reconcile(inbox: EmptyNotificationInboxStore(), accountID: "two")
        XCTAssertEqual(badge.unreadCount, 0)
        XCTAssertEqual(writes.last, 0)
    }

    func testMarkingEveryAlertReadClearsTheBadge() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let inbox = LocalNotificationInboxStore(storageURL: directory.appendingPathComponent("inbox.json"))
        let records = [record(), record(), record()]
        for item in records { try await inbox.ingest(item) }
        var writes: [Int] = []
        let badge = NotificationBadgeCoordinator { writes.append($0) }
        badge.beginSession(accountID: "one")
        await badge.reconcile(inbox: inbox, accountID: "one")
        for item in records {
            try await inbox.markRead(id: item.id)
            await badge.reconcile(inbox: inbox, accountID: "one")
        }
        XCTAssertEqual(writes, [0, 3, 2, 1, 0])
        try await inbox.ingest(record())
        await badge.reconcile(inbox: inbox, accountID: "one")
        try await inbox.markAllRead()
        await badge.reconcile(inbox: inbox, accountID: "one")
        XCTAssertEqual(writes.last, 0)
        XCTAssertEqual(badge.displayedCount, 0)
    }

    func testCapRetainsInternalCountAndRepeatedRefreshIsIdempotent() async {
        var writes: [Int] = []
        let badge = NotificationBadgeCoordinator { writes.append($0) }
        let inbox = CountedBadgeInbox(count: 123)
        badge.beginSession(accountID: "one")
        await badge.reconcile(inbox: inbox, accountID: "one")
        await badge.reconcile(inbox: inbox, accountID: "one")
        XCTAssertEqual(badge.unreadCount, 123)
        XCTAssertEqual(badge.displayedCount, 99)
        XCTAssertEqual(writes, [0, 99, 99])
    }

    func testFailedRefreshDoesNotClearKnownUnreadCount() async {
        var writes: [Int] = []
        let badge = NotificationBadgeCoordinator { writes.append($0) }
        badge.beginSession(accountID: "one")
        await badge.reconcile(inbox: CountedBadgeInbox(count: 4), accountID: "one")
        await badge.reconcile(inbox: CountedBadgeInbox(count: nil), accountID: "one")
        XCTAssertEqual(badge.unreadCount, 4)
        XCTAssertEqual(writes.last, 4)
    }

    func testInFlightRefreshCannotRestorePreviousAccountsBadgeAfterSignOut() async {
        var writes: [Int] = []
        let badge = NotificationBadgeCoordinator { writes.append($0) }
        let inbox = SuspendedBadgeInbox()
        badge.beginSession(accountID: "one")
        let pending = Task { await badge.reconcile(inbox: inbox, accountID: "one") }
        await inbox.waitUntilRequested()
        badge.endSession()
        badge.beginSession(accountID: "two")
        await inbox.finish(count: 7)
        await pending.value
        XCTAssertEqual(badge.unreadCount, 0)
        XCTAssertEqual(writes.last, 0)
    }

    private func record() -> InboxNotification {
        InboxNotification(id: UUID(), kind: .scheduleUpdate, title: "Update", body: "Review it.",
                          destination: .init(kind: .event, id: "event"), occurredAt: .now, readAt: nil)
    }
}

private struct CountedBadgeInbox: NotificationInboxStore {
    let count: Int?
    func unreadCount() async throws -> Int {
        guard let count else { throw URLError(.notConnectedToInternet) }
        return count
    }
    func notifications() async throws -> [InboxNotification] { [] }
    func markRead(id: UUID) async throws {}
    func delete(id: UUID) async throws {}
    func ingest(_ notification: InboxNotification) async throws {}
}

private actor SuspendedBadgeInbox: NotificationInboxStore {
    private var continuation: CheckedContinuation<Int, Never>?
    func unreadCount() async throws -> Int {
        await withCheckedContinuation { continuation = $0 }
    }
    func waitUntilRequested() async {
        while continuation == nil { await Task.yield() }
    }
    func finish(count: Int) { continuation?.resume(returning: count); continuation = nil }
    func notifications() async throws -> [InboxNotification] { [] }
    func markRead(id: UUID) async throws {}
    func delete(id: UUID) async throws {}
    func ingest(_ notification: InboxNotification) async throws {}
}
