import SwiftUI
import FamilyCore

struct SettingsView: View {
    let dataIsSynced: Bool
    let onSignOut: SignOutAction
    let onDeleteAccount: DeleteAccountAction
    private let currentMemberID: String?
    private let calendarSourceStore: (any CalendarSourceStore)?
    private let memberStore: (any FamilyMemberStore)?
    private let commuterStore: (any CommuterStore)?
    private let preferences = ConflictAlertPreferences()

    init(
        dataIsSynced: Bool = false,
        currentMemberID: String? = nil,
        calendarSourceStore: (any CalendarSourceStore)? = nil,
        memberStore: (any FamilyMemberStore)? = nil,
        commuterStore: (any CommuterStore)? = nil,
        onSignOut: SignOutAction = SignOutAction({}),
        onDeleteAccount: DeleteAccountAction = DeleteAccountAction({})
    ) {
        self.dataIsSynced = dataIsSynced
        self.currentMemberID = currentMemberID
        self.calendarSourceStore = calendarSourceStore
        self.memberStore = memberStore
        self.commuterStore = commuterStore
        self.onSignOut = onSignOut
        self.onDeleteAccount = onDeleteAccount
    }
    @State private var conflictAlertsEnabled = true
    @State private var isConfirmingSignOut = false
    @State private var isConfirmingAccountDeletion = false
    @State private var isDeletingAccount = false
    @State private var accountDeletionError: String?
    @State private var linkedCommuteSubscriptionID: String?
    @State private var isOpeningLinkedCommute = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Notifications") {
                    Toggle("Save conflict alerts", isOn: $conflictAlertsEnabled)
                        .onChange(of: conflictAlertsEnabled) { newValue in
                            preferences.areConflictAlertsEnabled = newValue
                        }
                    Text("Immediate conflict warnings still appear while adding an event.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let calendarSourceStore, let memberStore {
                    Section("Calendars") {
                        NavigationLink("Connected calendars") {
                            CalendarSourcesView(
                                store: calendarSourceStore,
                                memberStore: memberStore,
                                currentMemberID: currentMemberID
                            )
                        }
                        Text("Add TeamSnap, school, sports, or other iCalendar subscription links.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let commuterStore {
                    Section("Transit") {
                        NavigationLink("Commuter module") {
                            CommuterSettingsView(
                                store: commuterStore,
                                canManageFamilySettings: memberStore != nil
                            )
                        }
                        Text("Get alerts for Caltrain delays and cancellations.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("About") {
                    LabeledContent("App", value: "Rallyroo")
                    LabeledContent("Data", value: dataIsSynced ? "Synced" : "Stored on this device")
                }

                Section("Account") {
                    Button("Sign Out") {
                        isConfirmingSignOut = true
                    }
                    if dataIsSynced {
                        Button("Delete Account", role: .destructive) {
                            isConfirmingAccountDeletion = true
                        }
                        .disabled(isDeletingAccount)
                    }
                }
            }
            .navigationTitle("Settings")
            .onReceive(NotificationCenter.default.publisher(for: .openNotificationDestination)) { note in
                guard let destination = note.object as? InboxNotificationDestination,
                      destination.kind == .commuteSubscription,
                      commuterStore != nil else { return }
                linkedCommuteSubscriptionID = destination.id
                isOpeningLinkedCommute = true
            }
            .sheet(isPresented: $isOpeningLinkedCommute) {
                if let commuterStore {
                    NavigationStack {
                        CommuterSettingsView(
                            store: commuterStore,
                            initialSubscriptionID: linkedCommuteSubscriptionID,
                            canManageFamilySettings: memberStore != nil
                        )
                    }
                }
            }
            .confirmationDialog(
                "Sign out of Rallyroo?",
                isPresented: $isConfirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign Out", role: .destructive) {
                    onSignOut.perform()
                }
                .accessibilityIdentifier("confirm-sign-out")
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You can sign in again at any time.")
            }
            .confirmationDialog(
                "Permanently delete your account?",
                isPresented: $isConfirmingAccountDeletion,
                titleVisibility: .visible
            ) {
                Button("Delete Account", role: .destructive) {
                    deleteAccount()
                }
                .accessibilityIdentifier("confirm-delete-account")
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your profile and login will be permanently deleted. If yours is the family's last account, its events and connected calendars will also be deleted.")
            }
            .alert(
                "Account Not Deleted",
                isPresented: Binding(
                    get: { accountDeletionError != nil },
                    set: { if !$0 { accountDeletionError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(accountDeletionError ?? "Please try again.")
            }
            .onAppear {
                conflictAlertsEnabled = preferences.areConflictAlertsEnabled
            }
        }
    }

    private func deleteAccount() {
        isDeletingAccount = true
        Task {
            defer { isDeletingAccount = false }
            do {
                try await onDeleteAccount.perform()
            } catch {
                accountDeletionError = "We couldn't confirm account deletion. Please contact Rallyroo support before signing in again."
            }
        }
    }
}

struct CalendarSourcesView: View {
    let store: any CalendarSourceStore
    let memberStore: any FamilyMemberStore
    let currentMemberID: String?
    let initialSourceID: String?
    @State private var sources: [CalendarSourceConnection] = []
    @State private var members: [FamilyMember] = []
    @State private var isAdding = false
    @State private var errorMessage: String?

    init(
        store: any CalendarSourceStore,
        memberStore: any FamilyMemberStore,
        currentMemberID: String?,
        initialSourceID: String? = nil
    ) {
        self.store = store
        self.memberStore = memberStore
        self.currentMemberID = currentMemberID
        self.initialSourceID = initialSourceID
    }

    var body: some View {
        List {
            Text("Calendar imports are one-way and read-only in Rallyroo. Changes must be made in the source calendar.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            }
            ForEach(sources) { source in
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(source.name).font(.headline)
                        if source.id.uuidString.lowercased() == initialSourceID?.lowercased() {
                            Spacer()
                            Label("Selected event source", systemImage: "link")
                                .font(.caption2)
                                .foregroundStyle(AppTheme.purple)
                        }
                    }
                    Text(participantNames(for: source))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Label(
                        source.visibility == .personal ? "Personal" : "Shared with family",
                        systemImage: source.visibility == .personal ? "person" : "person.2"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Label(statusText(source), systemImage: statusIcon(source.status))
                        .font(.caption)
                        .foregroundStyle(source.status == .error ? .red : .secondary)
                }
                .swipeActions(edge: .leading) {
                    Button("Sync") { Task { await synchronize(source) } }
                        .tint(AppTheme.purple)
                    if source.ownerMemberID == currentMemberID {
                        Button(source.visibility == .personal ? "Share" : "Make Personal") {
                            Task { await toggleVisibility(source) }
                        }
                        .tint(AppTheme.mint)
                    }
                }
                .swipeActions {
                    Button("Delete", role: .destructive) {
                        Task { await delete(source) }
                    }
                }
            }
        }
        .navigationTitle("Calendars")
        .toolbar {
            Button { isAdding = true } label: { Image(systemName: "plus") }
                .disabled(members.isEmpty)
        }
        .task { await load() }
        .sheet(isPresented: $isAdding) {
            AddCalendarSourceView(members: members) { name, url, participantIDs, visibility in
                _ = try await store.connect(
                    name: name,
                    url: url,
                    participantIDs: participantIDs,
                    visibility: visibility
                )
                await load()
                NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
            }
        }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            async let loadedSources = store.sources()
            async let loadedMembers = memberStore.members()
            sources = try await loadedSources
            members = try await loadedMembers
            errorMessage = nil
        } catch {
            errorMessage = "Calendar connections could not be loaded."
        }
    }

    private func synchronize(_ source: CalendarSourceConnection) async {
        do {
            _ = try await store.synchronize(source)
            await load()
            NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
        } catch {
            await load()
            errorMessage = "The calendar could not be synchronized."
        }
    }

    private func toggleVisibility(_ source: CalendarSourceConnection) async {
        do {
            _ = try await store.updateVisibility(
                source,
                visibility: source.visibility == .personal ? .family : .personal
            )
            await load()
            NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
        } catch {
            errorMessage = "Calendar visibility could not be changed."
        }
    }

    private func delete(_ source: CalendarSourceConnection) async {
        do {
            try await store.delete(source)
            await load()
            NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
        } catch {
            errorMessage = "The calendar could not be removed."
        }
    }

    private func participantNames(for source: CalendarSourceConnection) -> String {
        members.filter { source.participantIDs.contains($0.id) }
            .map(\.name)
            .joined(separator: " • ")
    }

    private func statusText(_ source: CalendarSourceConnection) -> String {
        switch source.status {
        case .pending: "Waiting for first sync"
        case .ready: source.lastSyncedAt.map { "Updated \($0.formatted(.relative(presentation: .named)))" } ?? "Ready"
        case .error: "Sync failed — previous events preserved"
        }
    }

    private func statusIcon(_ status: CalendarSourceStatus) -> String {
        switch status {
        case .pending: "clock"
        case .ready: "checkmark.circle"
        case .error: "exclamationmark.triangle"
        }
    }
}

private struct AddCalendarSourceView: View {
    let members: [FamilyMember]
    let onAdd: (String, URL, [KidID], CalendarSourceVisibility) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var urlText = ""
    @State private var participantIDs = Set<KidID>()
    @State private var visibility = CalendarSourceVisibility.family
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Calendar") {
                    TextField("Name, such as Emma TeamSnap", text: $name)
                    TextField("Calendar subscription link", text: $urlText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }
                Section("Visibility") {
                    Picker("Who can see imported events?", selection: $visibility) {
                        Text("Personal").tag(CalendarSourceVisibility.personal)
                        Text("Shared with family").tag(CalendarSourceVisibility.family)
                    }
                    .pickerStyle(.segmented)
                    Text(visibility == .personal
                         ? "Only you can see events imported from this calendar."
                         : "Everyone in your family can see imported events.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("Family members") {
                    ForEach(members) { member in
                        Toggle(member.name, isOn: Binding(
                            get: { participantIDs.contains(member.id) },
                            set: { selected in
                                if selected { participantIDs.insert(member.id) }
                                else { participantIDs.remove(member.id) }
                            }
                        ))
                    }
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle("Import Calendar")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Importing…" : "Import") { add() }
                        .disabled(validatedURL == nil || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || participantIDs.isEmpty || isSaving)
                }
            }
        }
    }

    private var validatedURL: URL? {
        let value = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: value) else { return nil }
        if components.scheme?.lowercased() == "webcal" {
            components.scheme = "https"
        }
        guard components.scheme?.lowercased() == "https",
              components.host != nil else { return nil }
        return components.url
    }

    private func add() {
        guard let validatedURL else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await onAdd(
                    name.trimmingCharacters(in: .whitespacesAndNewlines),
                    validatedURL,
                    Array(participantIDs),
                    visibility
                )
                dismiss()
            } catch {
                errorMessage = "The calendar could not be added. Check the subscription link and try again."
            }
        }
    }
}
