import SwiftUI
import FamilyCore

struct RemindersView: View {
    let store: any ReminderStore
    let memberStore: any FamilyMemberStore
    let alertScheduler: (any ReminderAlertScheduler)?
    let session: AuthSession

    @State private var reminders: [FamilyReminder] = []
    @State private var members: [FamilyMember] = []
    @State private var editingReminder: FamilyReminder?
    @State private var linkedReminder: FamilyReminder?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                }
                reminderSection("Overdue", reminders: openReminders.filter { $0.dueAt < startOfToday })
                reminderSection("Today", reminders: openReminders.filter { Calendar.current.isDateInToday($0.dueAt) })
                reminderSection("Upcoming", reminders: openReminders.filter { $0.dueAt >= endOfToday })
                reminderSection("Completed", reminders: reminders.filter { $0.status == .completed })
                if reminders.isEmpty, errorMessage == nil {
                    VStack(spacing: 8) {
                        Image(systemName: "checklist")
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                        Text("No reminders").font(.headline)
                        Text(session.role == .parent
                            ? "Add a responsibility with a due time—without blocking the family schedule."
                            : "Assigned reminders will appear here.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                }
            }
            .navigationTitle("Reminders")
            .toolbar {
                if session.role == .parent {
                    Button {
                        editingReminder = FamilyReminder(
                            title: "",
                            assigneeIDs: [],
                            dueAt: .now.addingTimeInterval(60 * 60),
                            alertLeadTime: .atDueTime
                        )
                    } label: {
                        Label("Add Reminder", systemImage: "plus")
                    }
                }
            }
            .task { await load() }
            .onReceive(NotificationCenter.default.publisher(for: .familyDataDidChange)) { _ in
                Task { await load() }
            }
            .onReceive(NotificationCenter.default.publisher(for: .openNotificationDestination)) { note in
                guard let destination = note.object as? InboxNotificationDestination,
                      destination.kind == .reminder else { return }
                Task {
                    await load()
                    linkedReminder = reminders.first {
                        $0.id.uuidString.lowercased() == destination.id.lowercased()
                    }
                }
            }
            .sheet(item: $linkedReminder) { reminder in
                NavigationStack {
                    List {
                        Section("Reminder") {
                            Text(reminder.title).font(.headline)
                            LabeledContent("Due", value: reminder.dueAt.formatted())
                            LabeledContent("Status", value: reminder.status == .completed ? "Completed" : "Open")
                        }
                    }
                    .navigationTitle("Reminder details")
                }
            }
            .sheet(item: $editingReminder) { reminder in
                ReminderEditorSheet(reminder: reminder, members: availableMembers) { reminder in
                    try await store.save(reminder)
                    try? await alertScheduler?.schedule(reminder)
                    await load()
                }
            }
              .tint(AppTheme.purple)
        }
    }

    @ViewBuilder
    private func reminderSection(_ title: String, reminders: [FamilyReminder]) -> some View {
        if !reminders.isEmpty {
            Section(title) {
                ForEach(reminders) { reminder in
                    ReminderRow(reminder: reminder, members: availableMembers) {
                        Task { await toggleCompletion(reminder) }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if session.role == .parent { editingReminder = reminder }
                    }
                    .swipeActions {
                        if session.role == .parent {
                            Button("Delete", role: .destructive) {
                                Task { await delete(reminder) }
                            }
                        }
                    }
                }
            }
        }
    }

    private var availableMembers: [FamilyMember] {
        if members.contains(where: { $0.id.rawValue == session.accountID }) { return members }
        return members + [FamilyMember(
            id: KidID(rawValue: session.accountID),
            name: session.displayName,
            role: session.role == .parent ? .parent : .kid,
            colorTag: "blue"
        )]
    }

    private var openReminders: [FamilyReminder] {
        reminders.filter { $0.status == .open }
    }

    private var startOfToday: Date { Calendar.current.startOfDay(for: .now) }
    private var endOfToday: Date {
        Calendar.current.date(byAdding: .day, value: 1, to: startOfToday)!
    }

    @MainActor
    private func load() async {
        do {
            async let loadedReminders = store.reminders()
            async let loadedMembers = memberStore.members()
            reminders = try await loadedReminders
            members = try await loadedMembers
            errorMessage = nil
        } catch {
            errorMessage = "Reminders could not be loaded."
        }
    }

    @MainActor
    private func toggleCompletion(_ reminder: FamilyReminder) async {
        do {
            if reminder.status == .open {
                try await store.complete(reminder, by: KidID(rawValue: session.accountID))
                await alertScheduler?.cancel(reminder)
            } else if session.role == .parent {
                try await store.reopen(reminder)
                var reopened = reminder
                reopened.status = .open
                reopened.completedAt = nil
                reopened.completedByMemberID = nil
                try? await alertScheduler?.schedule(reopened)
            }
            await load()
        } catch {
            errorMessage = "The reminder could not be updated."
        }
    }

    @MainActor
    private func delete(_ reminder: FamilyReminder) async {
        do {
            try await store.delete(reminder)
            await alertScheduler?.cancel(reminder)
            await load()
        } catch {
            errorMessage = "The reminder could not be deleted."
        }
    }
}

private struct ReminderRow: View {
    let reminder: FamilyReminder
    let members: [FamilyMember]
    let onToggle: () -> Void

    var body: some View {
        HStack {
            Button(action: onToggle) {
                Image(systemName: reminder.status == .completed ? "checkmark.circle.fill" : "circle")
                    .imageScale(.large)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(reminder.status == .completed ? "Reopen reminder" : "Complete reminder")

            VStack(alignment: .leading, spacing: 4) {
                Text(reminder.title)
                    .strikethrough(reminder.status == .completed)
                Text(reminder.dueAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(assigneeNames)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var assigneeNames: String {
        reminder.assigneeIDs.compactMap { id in
            members.first(where: { $0.id == id })?.name
        }.joined(separator: ", ")
    }
}

private struct ReminderEditorSheet: View {
    let reminder: FamilyReminder
    let members: [FamilyMember]
    let onSave: (FamilyReminder) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var assigneeIDs: Set<KidID>
    @State private var dueAt = Date.now.addingTimeInterval(60 * 60)
    @State private var alertChoice: ReminderAlertChoice = .none
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        reminder: FamilyReminder,
        members: [FamilyMember],
        onSave: @escaping (FamilyReminder) async throws -> Void
    ) {
        self.reminder = reminder
        self.members = members
        self.onSave = onSave
        _title = State(initialValue: reminder.title)
        _assigneeIDs = State(initialValue: reminder.assigneeIDs.isEmpty && members.count == 1
            ? [members[0].id]
            : Set(reminder.assigneeIDs))
        _dueAt = State(initialValue: reminder.dueAt)
        _alertChoice = State(initialValue: ReminderAlertChoice(leadTime: reminder.alertLeadTime))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Reminder") {
                    TextField("Title", text: $title)
                    DatePicker("Due", selection: $dueAt)
                    Picker("Alert", selection: $alertChoice) {
                        ForEach(ReminderAlertChoice.allCases) { choice in
                            Text(choice.title).tag(choice)
                        }
                    }
                }
                Section("Assignees") {
                    ForEach(members) { member in
                        Toggle(member.name, isOn: Binding(
                            get: { assigneeIDs.contains(member.id) },
                            set: { selected in
                                if selected { assigneeIDs.insert(member.id) }
                                else { assigneeIDs.remove(member.id) }
                            }
                        ))
                    }
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle(reminder.title.isEmpty ? "Add Reminder" : "Edit Reminder")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || assigneeIDs.isEmpty || isSaving)
                }
            }
                   .tint(AppTheme.purple)
        }
    }

    private func save() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                var updatedReminder = reminder
                updatedReminder.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
                updatedReminder.assigneeIDs = Array(assigneeIDs)
                updatedReminder.dueAt = dueAt
                updatedReminder.alertLeadTime = alertChoice.leadTime
                try await onSave(updatedReminder)
                dismiss()
            } catch {
                errorMessage = "The reminder could not be saved."
            }
        }
    }
}

private enum ReminderAlertChoice: Int, CaseIterable, Identifiable {
    case none = -1
    case atDueTime = 0
    case fiveMinutes = 5
    case fifteenMinutes = 15
    case oneHour = 60
    case oneDay = 1_440

    init(leadTime: ReminderAlertLeadTime?) {
        self = leadTime.flatMap { Self(rawValue: $0.rawValue) } ?? .none
    }

    var id: Int { rawValue }
    var leadTime: ReminderAlertLeadTime? { rawValue < 0 ? nil : ReminderAlertLeadTime(rawValue: rawValue) }

    var title: String {
        switch self {
        case .none: "None"
        case .atDueTime: "At due time"
        case .fiveMinutes: "5 minutes before"
        case .fifteenMinutes: "15 minutes before"
        case .oneHour: "1 hour before"
        case .oneDay: "1 day before"
        }
    }
}
