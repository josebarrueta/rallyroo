import Foundation
import XCTest
@testable import FamilyCore

final class ConflictNotificationStoreTests: XCTestCase {
    func testStoresAndListsAConflictNotification() async throws {
        let store: any ConflictNotificationStore = LocalConflictNotificationStore(storageURL: temporaryStorageURL())
        let notification = ConflictNotification(message: "Alex's work meeting overlaps with Emma's practice.")

        try await store.save(notification)

        let savedNotifications = try await store.notifications()
        XCTAssertEqual(savedNotifications, [notification])
    }

    func testClearsStoredNotifications() async throws {
        let store: any ConflictNotificationStore = LocalConflictNotificationStore(storageURL: temporaryStorageURL())
        try await store.save(ConflictNotification(message: "Conflict"))

        try await store.clear()

        let notifications = try await store.notifications()
        XCTAssertEqual(notifications, [])
    }

    func testAccountNamespacesDoNotReadLegacyOrAnotherAccountsConflicts() async throws {
        let url = temporaryStorageURL()
        let legacy = LocalConflictNotificationStore(storageURL: url)
        let first = LocalConflictNotificationStore(storageURL: url, accountID: "account-a")
        let second = LocalConflictNotificationStore(storageURL: url, accountID: "account-b")
        try await legacy.save(ConflictNotification(message: "Unscoped legacy private message"))
        let before = try await first.notifications()
        XCTAssertTrue(before.isEmpty)
        let firstMessage = ConflictNotification(message: "Only A")
        try await first.save(firstMessage)
        let secondBefore = try await second.notifications()
        XCTAssertTrue(secondBefore.isEmpty)
        try await second.save(ConflictNotification(message: "Only B"))
        let restored = LocalConflictNotificationStore(storageURL: url, accountID: "account-a")
        let restoredMessages = try await restored.notifications()
        XCTAssertEqual(restoredMessages, [firstMessage])
        try await second.clear()
        let stillFirst = try await first.notifications()
        XCTAssertEqual(stillFirst, [firstMessage])
    }

    func testAccountIDsCannotBecomeStoragePaths() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "conflicts.json")
        let store = LocalConflictNotificationStore(storageURL: url, accountID: "../private/account")
        try await store.save(ConflictNotification(message: "Scoped"))
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(files.count, 1)
        XCTAssertTrue(files[0].hasPrefix("conflicts-"))
        XCTAssertFalse(files[0].contains("private"))
        XCTAssertFalse(files[0].contains("account"))
    }

    func testClearingAnEmptyStoreIsIdempotent() async throws {
        let store = LocalConflictNotificationStore(storageURL: temporaryStorageURL(), accountID: "empty")
        try await store.clear()
        try await store.clear()
    }

    private func temporaryStorageURL() -> URL {
        FileManager.default.temporaryDirectory.appending(path: UUID().uuidString).appendingPathExtension("json")
    }
}
