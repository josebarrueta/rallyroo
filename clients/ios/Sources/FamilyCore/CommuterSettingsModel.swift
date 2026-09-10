import Combine
import Foundation

@MainActor
public final class CommuterSettingsModel: ObservableObject {
    @Published public private(set) var state: CommuterState?
    @Published public private(set) var catalog: CaltrainCatalog?
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var isLoading = false
    @Published public private(set) var isMutating = false

    private let store: any CommuterStore

    public init(store: any CommuterStore) {
        self.store = store
    }

    public func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            state = try await store.state()
            catalog = try? await store.catalog()
            errorMessage = nil
        } catch {
            state = nil
            catalog = nil
            errorMessage = "The Commuter module could not be loaded."
        }
    }

    @discardableResult
    public func enable() async -> Bool {
        guard beginMutation() else { return false }
        defer { isMutating = false }
        do {
            _ = try await store.enable()
            await reloadAfterMutation()
            return true
        } catch {
            errorMessage = "Commuter could not be enabled."
            return false
        }
    }

    @discardableResult
    public func disable() async -> Bool {
        guard beginMutation() else { return false }
        defer { isMutating = false }
        do {
            try await store.disable()
            await reloadAfterMutation()
            return true
        } catch {
            errorMessage = "Commuter could not be paused."
            return false
        }
    }

    @discardableResult
    public func removeModule() async -> Bool {
        guard beginMutation() else { return false }
        defer { isMutating = false }
        do {
            try await store.removeModule()
            await reloadAfterMutation()
            return true
        } catch {
            errorMessage = "Commuter could not be removed."
            return false
        }
    }

    public func searchJourneys(
        _ search: CaltrainJourneySearch
    ) async -> CaltrainJourneySearchResult? {
        do {
            let result = try await store.searchJourneys(search)
            errorMessage = nil
            return result
        } catch {
            errorMessage = "Train schedules could not be loaded."
            return nil
        }
    }

    @discardableResult
    public func createSubscription(_ draft: CommuteSubscriptionDraft) async -> Bool {
        guard beginMutation() else { return false }
        defer { isMutating = false }
        do {
            _ = try await store.createSubscription(draft)
            await reloadAfterMutation()
            return true
        } catch {
            errorMessage = "The commute alert could not be saved."
            return false
        }
    }

    @discardableResult
    public func updateSubscription(
        _ subscription: CommuteSubscription,
        with draft: CommuteSubscriptionDraft
    ) async -> Bool {
        guard beginMutation() else { return false }
        defer { isMutating = false }
        do {
            _ = try await store.updateSubscription(draft, for: subscription)
            await reloadAfterMutation()
            return true
        } catch {
            errorMessage = "The commute alert could not be updated."
            return false
        }
    }

    @discardableResult
    public func toggleStatus(of subscription: CommuteSubscription) async -> Bool {
        guard beginMutation() else { return false }
        defer { isMutating = false }
        let status: CommuteSubscriptionStatus = subscription.status == .active ? .paused : .active
        do {
            _ = try await store.setStatus(status, for: subscription)
            await reloadAfterMutation()
            return true
        } catch {
            errorMessage = "The commute alert could not be updated."
            return false
        }
    }

    @discardableResult
    public func remove(_ subscription: CommuteSubscription) async -> Bool {
        guard beginMutation() else { return false }
        defer { isMutating = false }
        do {
            try await store.remove(subscription)
            await reloadAfterMutation()
            return true
        } catch {
            errorMessage = "The commute alert could not be removed."
            return false
        }
    }

    public func clearError() {
        errorMessage = nil
    }

    private func beginMutation() -> Bool {
        guard !isMutating else { return false }
        isMutating = true
        errorMessage = nil
        return true
    }

    private func reloadAfterMutation() async {
        state = try? await store.state()
        catalog = try? await store.catalog()
    }
}
