import Combine
import Foundation
import FamilyCore

@MainActor
final class WeeklyScheduleViewModel: ObservableObject {
    @Published private(set) var events: [FamilyEvent] = []
    @Published private(set) var members: [FamilyMember] = []
    @Published private(set) var errorMessage: String?
    @Published private(set) var isShowingCachedEvents = false

    private let eventStore: any EventStore
    private let memberStore: any FamilyMemberStore
    private let notificationStore: any ConflictNotificationStore
    private let alertScheduler: (any EventAlertScheduler)?
    private let alertPreferences: ConflictAlertPreferences

    init(
        eventStore: any EventStore,
        memberStore: any FamilyMemberStore,
        notificationStore: any ConflictNotificationStore,
        alertScheduler: (any EventAlertScheduler)? = nil,
        alertPreferences: ConflictAlertPreferences = ConflictAlertPreferences()
    ) {
        self.eventStore = eventStore
        self.memberStore = memberStore
        self.notificationStore = notificationStore
        self.alertScheduler = alertScheduler
        self.alertPreferences = alertPreferences
    }

    func loadEvents() async {
        do {
            let snapshot = try await eventStore.loadEvents()
            events = snapshot.events.sorted { $0.startTime < $1.startTime }
            isShowingCachedEvents = snapshot.freshness == .cached
            for event in events {
                try? await alertScheduler?.schedule(event)
            }
            do {
                members = try await memberStore.members().sorted { $0.name < $1.name }
            } catch where snapshot.freshness == .cached {
                // Event titles and times remain useful offline even when member refresh fails.
            }
            errorMessage = nil
        } catch {
            errorMessage = "Your schedule could not be loaded."
            isShowingCachedEvents = false
        }
    }

    func addEvent(
        _ event: FamilyEvent,
        notifyParticipants: Bool = true,
        idempotencyKey: UUID = UUID()
    ) async throws -> EventMutationResult {
        let result = try await eventStore.save(
            event,
            notifyParticipants: notifyParticipants,
            idempotencyKey: idempotencyKey
        )
        let conflicts = result.conflicts
        try? await alertScheduler?.schedule(event)
        if !conflicts.isEmpty, alertPreferences.areConflictAlertsEnabled {
            let message = ConflictNotificationMessage.make(
                event: event,
                conflicts: conflicts,
                members: members
            )
            try await notificationStore.save(ConflictNotification(message: message))
        }
        let snapshot = try await eventStore.loadEvents()
        events = snapshot.events.sorted { $0.startTime < $1.startTime }
        isShowingCachedEvents = snapshot.freshness == .cached
        return result
    }

    func deleteEvent(_ event: FamilyEvent, idempotencyKey: UUID = UUID()) async throws {
        try await eventStore.delete(event, idempotencyKey: idempotencyKey)
        await alertScheduler?.cancel(event)
        let snapshot = try await eventStore.loadEvents()
        events = snapshot.events.sorted { $0.startTime < $1.startTime }
        isShowingCachedEvents = snapshot.freshness == .cached
    }
}
