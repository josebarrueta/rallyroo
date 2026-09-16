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
    private let occurrenceLifecycleStore: (any OccurrenceLifecycleStore)?

    init(
        eventStore: any EventStore,
        memberStore: any FamilyMemberStore,
        notificationStore: any ConflictNotificationStore,
        alertScheduler: (any EventAlertScheduler)? = nil,
        alertPreferences: ConflictAlertPreferences = ConflictAlertPreferences(),
        occurrenceLifecycleStore: (any OccurrenceLifecycleStore)? = nil
     ) {
        self.eventStore = eventStore
        self.memberStore = memberStore
        self.notificationStore = notificationStore
        self.alertScheduler = alertScheduler
        self.alertPreferences = alertPreferences
        self.occurrenceLifecycleStore = occurrenceLifecycleStore
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

     func updateRecurringEvent(
         _ edit: RecurringEventEdit,
        notifyParticipants: Bool,
        idempotencyKey: UUID
     ) async throws -> EventMutationResult {
        let source = events.first(where: { $0.id == edit.sourceEventID })
        let result = try await eventStore.updateRecurringEvent(
            edit,
            notifyParticipants: notifyParticipants,
            idempotencyKey: idempotencyKey
         )
        if let source { await alertScheduler?.cancel(source) }
        let snapshot = try await eventStore.loadEvents()
        events = snapshot.events.sorted { $0.startTime < $1.startTime }
        isShowingCachedEvents = snapshot.freshness == .cached
        for event in events { try? await alertScheduler?.schedule(event) }
        if !result.conflicts.isEmpty, alertPreferences.areConflictAlertsEnabled {
            let message = ConflictNotificationMessage.make(
                event: edit.editedEvent,
                conflicts: result.conflicts,
                members: members
             )
            try await notificationStore.save(ConflictNotification(message: message))
         }
        return result
     }

     func deleteEvent(_ event: FamilyEvent, idempotencyKey: UUID = UUID()) async throws {
        try await eventStore.delete(event, idempotencyKey: idempotencyKey)
        await alertScheduler?.cancel(event)
        let snapshot = try await eventStore.loadEvents()
        events = snapshot.events.sorted { $0.startTime < $1.startTime }
        isShowingCachedEvents = snapshot.freshness == .cached
     }

     // MARK: - Occurrence lifecycle

     @discardableResult
     func skipOccurrence(
         _ occurrence: EventOccurrence,
         scope: OccurrenceScope = .thisOccurrence
     ) async {
        guard let store = occurrenceLifecycleStore else { return }
        let reference = OccurrenceReference(
            kind: .event,
            seriesID: occurrence.sourceSeriesID,
            scheduledAt: occurrence.event.startTime
        )
        do {
            _ = try await store.skip(reference, scope: scope)
            await reload()
        } catch {
            errorMessage = "Could not skip occurrence."
        }
     }

     @discardableResult
     func deleteOccurrence(
         _ occurrence: EventOccurrence,
         scope: OccurrenceScope = .thisOccurrence
     ) async {
        guard let store = occurrenceLifecycleStore else { return }
        let reference = OccurrenceReference(
            kind: .event,
            seriesID: occurrence.sourceSeriesID,
            scheduledAt: occurrence.event.startTime
        )
        do {
            _ = try await store.delete(reference, scope: scope)
            await reload()
        } catch {
            errorMessage = "Could not delete occurrence."
        }
     }

     func acknowledgeOccurrence(_ occurrence: EventOccurrence) async {
        guard let store = occurrenceLifecycleStore else { return }
        let reference = OccurrenceReference(
            kind: .event,
            seriesID: occurrence.sourceSeriesID,
            scheduledAt: occurrence.event.startTime
        )
        do {
            _ = try await store.acknowledge(reference)
        } catch {
            errorMessage = "Could not acknowledge occurrence."
        }
     }

     // MARK: - Private helpers

     private func reload() async {
        do {
            let snapshot = try await eventStore.loadEvents()
            events = snapshot.events.sorted { $0.startTime < $1.startTime }
            isShowingCachedEvents = snapshot.freshness == .cached
        } catch {
            errorMessage = "Your schedule could not be loaded."
            isShowingCachedEvents = false
        }
     }
}
