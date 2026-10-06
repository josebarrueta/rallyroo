import Combine
import Foundation

/// Both badge surfaces use an absolute inbox count. Failures retain the last known count.
@MainActor
public final class NotificationBadgeCoordinator: ObservableObject {
    public static let displayCap = 99
    @Published public private(set) var unreadCount = 0
    public var displayedCount: Int { min(Self.displayCap, max(0, unreadCount)) }
    private var accountID: String?
    private var generation = 0
    private let updateBadge: @MainActor (Int) -> Void

    public init(updateBadge: @escaping @MainActor (Int) -> Void) {
        self.updateBadge = updateBadge
    }

    public func beginSession(accountID: String) {
        guard self.accountID != accountID else { return }
        generation += 1
        self.accountID = accountID
        apply(0)
    }

    public func endSession() {
        generation += 1
        accountID = nil
        apply(0)
    }

    public func reconcile(inbox: any NotificationInboxStore, accountID: String) async {
        guard self.accountID == accountID else { return }
        generation += 1
        let requestGeneration = generation
        do {
            let count = try await inbox.unreadCount()
            guard self.accountID == accountID, requestGeneration == generation, !Task.isCancelled else { return }
            apply(count)
        } catch {
            // Permission/network failures must not break Alerts or fabricate a zero count.
        }
    }

    private func apply(_ count: Int) {
        unreadCount = max(0, count)
        updateBadge(displayedCount)
    }
}
