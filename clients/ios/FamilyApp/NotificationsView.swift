import SwiftUI
import FamilyCore

struct NotificationsView: View {
    let inboxStore: any NotificationInboxStore
    let conflictStore: any ConflictNotificationStore
    let onUnreadCountChanged: (Int) -> Void
    @State private var inbox: [InboxNotification] = []
    @State private var conflicts: [ConflictNotification] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                RallyrooHeader(title: "Alerts", subtitle: "Updates, reminders, and changes for you.")
                    .listRowBackground(Color.clear)
                if isLoading && inbox.isEmpty && conflicts.isEmpty {
                    ProgressView("Loading alerts…")
                } else if inbox.isEmpty && conflicts.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "bell.slash").font(.title).foregroundStyle(.secondary)
                        Text("You're all caught up").font(.headline)
                        Text("New family schedule alerts will appear here.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical)
                }
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(inbox) { notification in
                    Button { Task { await markRead(notification) } } label: {
                        inboxRow(notification)
                    }
                    .buttonStyle(.plain)
                }
                ForEach(conflicts.reversed()) { conflict in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Schedule conflict").font(.headline)
                            Text(conflict.message)
                            Text(conflict.createdAt.formatted()).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .navigationTitle("Alerts")
            .refreshable { await load() }
            .task { await load() }
            .toolbar {
                if !conflicts.isEmpty {
                    Button("Clear saved conflicts") {
                        Task { try? await conflictStore.clear(); conflicts = [] }
                    }
                }
            }
            .tint(AppTheme.purple)
        }
    }

    private func inboxRow(_ notification: InboxNotification) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon(for: notification.kind))
                .foregroundStyle(notification.readAt == nil ? AppTheme.purple : .secondary)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(notification.title).font(.headline)
                    if notification.readAt == nil { Circle().fill(AppTheme.purple).frame(width: 8, height: 8) }
                }
                Text(notification.body).foregroundStyle(.primary)
                Text(notification.occurredAt.formatted()).font(.caption).foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
    }

    private func icon(for kind: InboxNotificationKind) -> String {
        switch kind {
        case .eventOccurrence: "calendar"
        case .reminderOccurrence: "checklist"
        case .scheduleUpdate: "arrow.triangle.2.circlepath"
        case .commuteDisruption: "tram.fill"
        case .driverAssignment: "car.fill"
        case .savedConflict: "exclamationmark.triangle.fill"
        }
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let remote = inboxStore.notifications()
            async let local = conflictStore.notifications()
            inbox = try await remote
            conflicts = try await local
            onUnreadCountChanged(inbox.filter { $0.readAt == nil }.count)
            errorMessage = nil
        } catch {
            conflicts = (try? await conflictStore.notifications()) ?? conflicts
            errorMessage = "Couldn't refresh alerts. Showing what is available."
        }
    }

    @MainActor private func markRead(_ notification: InboxNotification) async {
        NotificationCenter.default.post(
            name: .openNotificationDestination,
            object: notification.destination
        )
        guard notification.readAt == nil else { return }
        do {
            try await inboxStore.markRead(id: notification.id)
            await load()
        } catch {
            errorMessage = "Couldn't mark this alert as read."
        }
    }
}
