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
    private let travelPlanningStore: (any TravelPlanningStore)?
    private let dayBriefStore: (any DayBriefStore)?
    private let shoppingStore: (any ShoppingStore)?
    private let locationSearch: (any LocationSearch)?
    private let canManageFamilyPlaces: Bool
    private let canManageShoppingCatalog: Bool
    private let preferences = ConflictAlertPreferences()

    init(
        dataIsSynced: Bool = false,
        currentMemberID: String? = nil,
        calendarSourceStore: (any CalendarSourceStore)? = nil,
        memberStore: (any FamilyMemberStore)? = nil,
        commuterStore: (any CommuterStore)? = nil,
        travelPlanningStore: (any TravelPlanningStore)? = nil,
        dayBriefStore: (any DayBriefStore)? = nil,
        shoppingStore: (any ShoppingStore)? = nil,
        locationSearch: (any LocationSearch)? = nil,
        canManageFamilyPlaces: Bool = false,
        canManageShoppingCatalog: Bool = false,
        onSignOut: SignOutAction = SignOutAction({}),
        onDeleteAccount: DeleteAccountAction = DeleteAccountAction({})
    ) {
        self.dataIsSynced = dataIsSynced
        self.currentMemberID = currentMemberID
        self.calendarSourceStore = calendarSourceStore
        self.memberStore = memberStore
        self.commuterStore = commuterStore
        self.travelPlanningStore = travelPlanningStore
        self.dayBriefStore = dayBriefStore
        self.shoppingStore = shoppingStore
        self.locationSearch = locationSearch
        self.canManageFamilyPlaces = canManageFamilyPlaces
        self.canManageShoppingCatalog = canManageShoppingCatalog
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

                if let dayBriefStore {
                    Section("Daily planning") {
                        NavigationLink("Day Brief") {
                            DayBriefSettingsView(store: dayBriefStore)
                        }
                        Text("Get a private summary of your schedule, driving duties, and reminders each morning.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let shoppingStore {
                    Section("Household") {
                        NavigationLink("Shopping and Pantry") {
                            ShoppingCatalogView(
                                store: shoppingStore,
                                canManage: canManageShoppingCatalog,
                                currentMemberID: currentMemberID
                            )
                        }
                        Text("Manage store routines and the Family Pantry catalog.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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

                if let travelPlanningStore, let locationSearch {
                    Section("Places") {
                        NavigationLink("Saved places") {
                            SavedPlacesView(
                                store: travelPlanningStore,
                                locationSearch: locationSearch,
                                currentMemberID: currentMemberID,
                                canManageFamilyPlaces: canManageFamilyPlaces
                            )
                        }
                        Text("Manage reusable starting locations for travel alerts.")
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

private struct SavedPlacesView: View {
    let store: any TravelPlanningStore
    let locationSearch: any LocationSearch
    let currentMemberID: String?
    let canManageFamilyPlaces: Bool
    @State private var places: [SavedPlace] = []
    @State private var editingPlace: SavedPlace?
    @State private var isAdding = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if places.isEmpty, errorMessage == nil {
                VStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No saved places").font(.headline)
                    Text("Add a reusable origin such as Home or Work.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical)
                .accessibilityElement(children: .combine)
            }
            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            }
            ForEach(places) { place in
                Button {
                    if canEdit(place) { editingPlace = place }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(place.label).font(.headline).foregroundStyle(.primary)
                            Label(
                                place.visibility == .family ? "Shared with family" : "Only me",
                                systemImage: place.visibility == .family ? "person.2" : "person"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if canEdit(place) {
                            Image(systemName: "chevron.right")
                                .font(.caption.bold())
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint(canEdit(place) ? "Edit this saved place." : "This family place can only be changed by a parent.")
                .swipeActions {
                    if canEdit(place) {
                        Button("Delete", role: .destructive) {
                            Task { await delete(place) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Saved places")
        .toolbar {
            Button { isAdding = true } label: { Image(systemName: "plus") }
                .accessibilityLabel("Add saved place")
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $isAdding) {
            SavedPlaceEditor(
                place: nil,
                locationSearch: locationSearch,
                canShareWithFamily: canManageFamilyPlaces
            ) { draft in
                _ = try await store.createSavedPlace(draft)
                await load()
            }
        }
        .sheet(item: $editingPlace) { place in
            SavedPlaceEditor(
                place: place,
                locationSearch: locationSearch,
                canShareWithFamily: canManageFamilyPlaces
            ) { draft in
                _ = try await store.updateSavedPlace(draft, id: place.id)
                await load()
            }
        }
    }

    private func canEdit(_ place: SavedPlace) -> Bool {
        place.visibility == .family
            ? canManageFamilyPlaces
            : place.ownerMemberID == currentMemberID
    }

    private func load() async {
        do {
            places = try await store.savedPlaces()
                .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            errorMessage = nil
        } catch {
            errorMessage = "Saved places could not be loaded."
        }
    }

    private func delete(_ place: SavedPlace) async {
        do {
            try await store.deleteSavedPlace(id: place.id)
            await load()
            NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
        } catch let RemoteStoreError.requestFailed(statusCode) where statusCode == 409 {
            errorMessage = "This place is used by a travel plan. Change that plan's origin before deleting it."
        } catch {
            errorMessage = "The saved place could not be deleted."
        }
    }
}

private struct SavedPlaceEditor: View {
    let place: SavedPlace?
    let locationSearch: any LocationSearch
    let canShareWithFamily: Bool
    let onSave: (SavedPlaceDraft) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var label: String
    @State private var visibility: SavedPlaceVisibility
    @State private var address: String
    @State private var selectedWaypoint: TravelWaypoint?
    @State private var suggestions: [LocationSuggestion] = []
    @State private var isChangingAddress: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        place: SavedPlace?,
        locationSearch: any LocationSearch,
        canShareWithFamily: Bool,
        onSave: @escaping (SavedPlaceDraft) async throws -> Void
    ) {
        self.place = place
        self.locationSearch = locationSearch
        self.canShareWithFamily = canShareWithFamily
        self.onSave = onSave
        _label = State(initialValue: place?.label ?? "")
        _visibility = State(initialValue: place?.visibility ?? (canShareWithFamily ? .family : .personal))
        _address = State(initialValue: place?.waypoint.address ?? "")
        _selectedWaypoint = State(initialValue: place?.waypoint)
        _isChangingAddress = State(initialValue: place == nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Place") {
                    TextField("Name, such as Home", text: $label)
                    if canShareWithFamily {
                        Picker("Visible to", selection: $visibility) {
                            Text("Family").tag(SavedPlaceVisibility.family)
                            Text("Only me").tag(SavedPlaceVisibility.personal)
                        }
                    }
                }
                Section("Address") {
                    if isChangingAddress {
                        TextField("Street address", text: Binding(
                            get: { address },
                            set: { newValue in
                                address = newValue
                                selectedWaypoint = nil
                                suggestions = []
                            }
                        ))
                        .textContentType(.fullStreetAddress)
                        Button("Find address") { Task { await search() } }
                            .disabled(address.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                        ForEach(suggestions) { suggestion in
                            Button {
                                address = suggestion.address
                                selectedWaypoint = try? TravelWaypoint(placeID: suggestion.id)
                                suggestions = []
                            } label: {
                                Label(suggestion.address, systemImage: "mappin.and.ellipse")
                            }
                        }
                    } else {
                        Text(place?.waypoint.address ?? "Saved map location")
                        Button("Change address") {
                            address = ""
                            selectedWaypoint = nil
                            isChangingAddress = true
                        }
                    }
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle(place == nil ? "Add place" : "Edit place")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { save() }
                        .disabled(!canSave || isSaving)
                }
            }
        }
    }

    private var canSave: Bool {
        !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && waypoint != nil
    }

    private var waypoint: TravelWaypoint? {
        if let selectedWaypoint { return selectedWaypoint }
        let value = address.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : try? TravelWaypoint(address: value)
    }

    private func search() async {
        do {
            suggestions = try await locationSearch.suggestions(for: address)
            errorMessage = nil
        } catch {
            suggestions = []
            errorMessage = "Address search is unavailable. You can still save the address you entered."
        }
    }

    private func save() {
        guard let waypoint else { return }
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await onSave(SavedPlaceDraft(
                    visibility: canShareWithFamily ? visibility : .personal,
                    label: label,
                    waypoint: waypoint
                ))
                NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
                dismiss()
            } catch let RemoteStoreError.requestFailed(statusCode) where statusCode == 400 {
                errorMessage = "Another saved place already uses this name. Choose a different name."
            } catch {
                errorMessage = "The saved place could not be saved."
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
        case .error:
          source.lastError.map { "Sync failed — \($0) (previous events preserved)" } ?? "Sync failed — previous events preserved"
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
                    if let calendarRequirementMessage {
                        Label(calendarRequirementMessage, systemImage: "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
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
                    if participantIDs.isEmpty {
                        Label("Choose at least one family member.", systemImage: "person.crop.circle.badge.questionmark")
                            .font(.caption)
                            .foregroundStyle(.orange)
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
                        .disabled(importBlockReason != nil || isSaving)
                        .accessibilityHint(importBlockReason ?? "Imports this calendar subscription.")
                }
            }
        }
    }

    private var importBlockReason: String? {
        calendarRequirementMessage
            ?? (participantIDs.isEmpty ? "Choose at least one family member." : nil)
    }

    private var calendarRequirementMessage: String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Enter a calendar name."
        }
        if urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Paste a calendar subscription link."
        }
        if validatedURL == nil {
            return "Enter a valid HTTPS or webcal subscription link."
        }
        return nil
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

private struct DayBriefSettingsView: View {
    let store: any DayBriefStore
    @State private var enabled = false
    @State private var weekdayTime = Self.time(hour: 7, minute: 0)
    @State private var weekendTime = Self.time(hour: 8, minute: 30)
    @State private var earlyEventLeadMinutes = 60
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var savedMessage: String?

    var body: some View {
        Form {
            Section {
                Toggle("Morning Day Brief", isOn: $enabled)
                Text("Your private brief uses only calendar details and family responsibilities visible to you.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Delivery") {
                DatePicker("Weekdays", selection: $weekdayTime, displayedComponents: .hourAndMinute)
                DatePicker("Weekends and holidays", selection: $weekendTime, displayedComponents: .hourAndMinute)
                Picker("Before an early event", selection: $earlyEventLeadMinutes) {
                    Text("30 minutes").tag(30)
                    Text("60 minutes").tag(60)
                    Text("90 minutes").tag(90)
                }
                LabeledContent("Time zone", value: TimeZone.current.localizedName(for: .standard, locale: .current) ?? TimeZone.current.identifier)
                LabeledContent("Public holidays", value: Locale.current.region?.identifier ?? "US")
            }
            .disabled(!enabled)

            Section {
                Button(isSaving ? "Saving…" : "Save Day Brief") { save() }
                    .disabled(isLoading || isSaving)
                if let savedMessage {
                    Text(savedMessage).font(.caption).foregroundStyle(.green)
                }
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Day Brief")
        .task { await load() }
        .overlay { if isLoading { ProgressView() } }
    }

    @MainActor private func load() async {
        defer { isLoading = false }
        do {
            guard let preferences = try await store.preferences() else { return }
            enabled = preferences.enabled
            weekdayTime = Self.date(from: preferences.weekdayTime) ?? weekdayTime
            weekendTime = Self.date(from: preferences.weekendHolidayTime) ?? weekendTime
            earlyEventLeadMinutes = preferences.earlyEventLeadMinutes
        } catch {
            errorMessage = "Couldn't load Day Brief settings."
        }
    }

    private func save() {
        isSaving = true
        savedMessage = nil
        errorMessage = nil
        Task { @MainActor in
            defer { isSaving = false }
            do {
                let region = Locale.current.region?.identifier ?? "US"
                _ = try await store.savePreferences(DayBriefPreferences(
                    enabled: enabled,
                    timeZone: TimeZone.current.identifier,
                    weekdayTime: Self.string(from: weekdayTime),
                    weekendHolidayTime: Self.string(from: weekendTime),
                    earlyEventLeadMinutes: earlyEventLeadMinutes,
                    holidayRegion: region
                ))
                savedMessage = enabled ? "Your Day Brief is scheduled." : "Day Brief is off."
            } catch {
                errorMessage = "Couldn't save Day Brief settings."
            }
        }
    }

    private static func string(from date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }

    private static func date(from value: String) -> Date? {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: .now)
    }

    private static func time(hour: Int, minute: Int) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now) ?? .now
    }
}

private struct ShoppingCatalogView: View {
    let store: any ShoppingStore
    let canManage: Bool
    let currentMemberID: String?
    @State private var catalog = ShoppingCatalog(routines: [], items: [])
    @State private var evidence = ShoppingEvidence(openRequests: [], latestObservations: [])
    @State private var trips: [ShoppingTripPlan] = []
    @State private var activeTrip: ShoppingTripPlan?
    @State private var pendingTripIDs: [UUID: UUID] = [:]
    @State private var isAddingRoutine = false
    @State private var isAddingItem = false
    @State private var editingRoutine: ShoppingRoutine?
    @State private var editingItem: PantryItem?
    @State private var requestingItem: PantryItem?
    @State private var observingItem: PantryItem?
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section("Shopping routines") {
                if catalog.routines.isEmpty {
                    Text("No shopping routines yet")
                        .foregroundStyle(.secondary)
                }
                ForEach(catalog.routines) { routine in
                    if canManage {
                        Button { editingRoutine = routine } label: {
                            routineRow(routine)
                        }
                        .swipeActions {
                            Button("Delete", role: .destructive) { deleteRoutine(routine) }
                        }
                    } else {
                        routineRow(routine)
                    }
                }
            }

            Section("Shopping trips") {
                if trips.isEmpty {
                    Text("No Shopping trips yet")
                        .foregroundStyle(.secondary)
                }
                ForEach(trips) { trip in
                    Button {
                        activeTrip = trip
                    } label: {
                        VStack(alignment: .leading) {
                            Text(catalog.routines.first(where: { $0.id == trip.routineID })?.storeName ?? "Shopping trip")
                                .font(.headline)
                            Text("\(trip.plannedFor) · \(trip.status == .draft ? "Draft" : "Finalized")")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                if canManage {
                    ForEach(catalog.routines) { routine in
                        Button("Prepare \(routine.storeName) trip") {
                            prepareTrip(routine)
                        }
                    }
                }
            }

            if !evidence.openRequests.isEmpty {
                Section("Family requests") {
                    Text("\(evidence.openRequests.count) open \(evidence.openRequests.count == 1 ? "request" : "requests")")
                        .font(.subheadline.weight(.semibold))
                    ForEach(evidence.openRequests) { request in
                        requestRow(request)
                    }
                }
            }

            Section("Pantry catalog") {
                if catalog.items.isEmpty {
                    Text("No Pantry items yet")
                        .foregroundStyle(.secondary)
                }
                ForEach(catalog.items) { item in
                    VStack(alignment: .leading, spacing: 10) {
                        itemRow(item)
                        HStack {
                            Button("Request") { requestingItem = item }
                                .accessibilityLabel("Request \(item.name)")
                            Button("Update stock") { observingItem = item }
                                .accessibilityLabel("Update \(item.name) stock")
                            if canManage {
                                Button("Edit") { editingItem = item }
                            }
                        }
                        .buttonStyle(.borderless)
                    }
                    .swipeActions {
                        if canManage {
                            Button("Delete", role: .destructive) { deleteItem(item) }
                        }
                    }
                }
            }
        }
        .navigationTitle("Shopping and Pantry")
        .toolbar {
            if canManage {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { isAddingRoutine = true } label: {
                        Label("Add shopping routine", systemImage: "storefront")
                    }
                    Button { isAddingItem = true } label: {
                        Label("Add pantry item", systemImage: "plus")
                    }
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $isAddingRoutine) {
            ShoppingRoutineEditor(store: store, routine: nil) { await load() }
        }
        .sheet(item: $editingRoutine) { routine in
            ShoppingRoutineEditor(store: store, routine: routine) { await load() }
        }
        .sheet(isPresented: $isAddingItem) {
            PantryItemEditor(store: store, item: nil, routines: catalog.routines) { await load() }
        }
        .sheet(item: $editingItem) { item in
            PantryItemEditor(store: store, item: item, routines: catalog.routines) { await load() }
        }
        .sheet(item: $activeTrip) { trip in
            ShoppingTripView(store: store, trip: trip, catalog: catalog, canManage: canManage) {
                await load()
            }
        }
        .sheet(item: $requestingItem) { item in
            ShoppingRequestEditor(store: store, item: item) { await load() }
        }
        .sheet(item: $observingItem) { item in
            StockObservationEditor(store: store, item: item) { await load() }
        }
        .alert("Shopping Catalog Unavailable", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private func routineRow(_ routine: ShoppingRoutine) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(routine.storeName)
                .font(.headline)
                .foregroundStyle(.primary)
            Text(routineSummary(routine))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func itemRow(_ item: PantryItem) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(itemSummary(item))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let observation = evidence.latestObservations.first(where: { $0.itemID == item.id }) {
                    Text(stockLevelTitle(observation.level))
                        .font(.caption.bold())
                        .foregroundStyle(stockLevelColor(observation.level))
                } else {
                    Text("No stock check")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if item.critical {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Critical item")
                }
            }
        }
    }

    private func requestRow(_ request: ShoppingItemRequest) -> some View {
        let itemName = catalog.items.first(where: { $0.id == request.itemID })?.name ?? "Pantry item"
        return HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(itemName).font(.headline)
                Text(requestSummary(request))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if canManage {
                VStack(alignment: .trailing) {
                    Button("Resolve") { closeRequest(request, status: .resolved) }
                    Button("Cancel") { closeRequest(request, status: .cancelled) }
                }
                .buttonStyle(.borderless)
            } else if request.requestedByMemberID == currentMemberID {
                Button("Cancel") { closeRequest(request, status: .cancelled) }
                    .buttonStyle(.borderless)
            }
        }
    }

    @MainActor
    private func load() async {
        do {
            async let loadedCatalog = store.catalog()
            async let loadedEvidence = store.evidence()
            async let loadedTrips = store.trips()
            catalog = try await loadedCatalog
            evidence = try await loadedEvidence
            trips = try await loadedTrips
            errorMessage = nil
        } catch {
            errorMessage = "We couldn't load the Shopping catalog."
        }
    }

    private func prepareTrip(_ routine: ShoppingRoutine) {
        let id = pendingTripIDs[routine.id] ?? UUID()
        pendingTripIDs[routine.id] = id
        let date = DateFormatter()
        date.calendar = Calendar(identifier: .gregorian)
        date.dateFormat = "yyyy-MM-dd"
        let plannedFor = date.string(from: Date())
        Task {
            do {
                let trip = try await store.prepareTrip(
                    id: id, routineID: routine.id, plannedFor: plannedFor
                )
                pendingTripIDs[routine.id] = nil
                await load()
                activeTrip = trip
            } catch {
                errorMessage = "We couldn't prepare the Shopping trip. Please try again."
            }
        }
    }

    private func closeRequest(
        _ request: ShoppingItemRequest,
        status: ShoppingItemRequestStatus
    ) {
        Task {
            do {
                _ = try await store.closeRequest(id: request.id, status: status)
                await load()
            } catch {
                errorMessage = "We couldn't update that Family request."
            }
        }
    }

    private func deleteRoutine(_ routine: ShoppingRoutine) {
        Task {
            do {
                try await store.deleteRoutine(id: routine.id)
                await load()
            } catch {
                errorMessage = "We couldn't delete that Shopping routine."
            }
        }
    }

    private func deleteItem(_ item: PantryItem) {
        Task {
            do {
                try await store.deletePantryItem(id: item.id)
                await load()
            } catch {
                errorMessage = "We couldn't delete that Pantry item."
            }
        }
    }

    private func routineSummary(_ routine: ShoppingRoutine) -> String {
        let cadence = routine.intervalWeeks == 1 ? "Every week" : "Every \(routine.intervalWeeks) weeks"
        guard let weekday = routine.preferredWeekday else { return cadence }
        return "\(cadence) · \(Self.weekdayName(weekday))"
    }

    private func itemSummary(_ item: PantryItem) -> String {
        let routineNames = item.routineIDs.compactMap { id in
            catalog.routines.first(where: { $0.id == id })?.storeName
        }
        let detail = [item.category, item.unit].compactMap { $0 }.joined(separator: " · ")
        return [detail, routineNames.joined(separator: ", ")].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func requestSummary(_ request: ShoppingItemRequest) -> String {
        let quantity = request.quantity.map { "Quantity \(Self.quantityText($0))" }
        let details = [quantity, request.note].compactMap { $0 }.joined(separator: " · ")
        return details.isEmpty ? "Requested for the Family" : details
    }

    private func stockLevelTitle(_ level: StockLevel) -> String {
        switch level {
        case .enough: "Enough"
        case .low: "Low"
        case .out: "Out"
        }
    }

    private func stockLevelColor(_ level: StockLevel) -> Color {
        switch level {
        case .enough: .green
        case .low: .orange
        case .out: .red
        }
    }

    static func quantityText(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(value)
    }

    static func weekdayName(_ weekday: Int) -> String {
        guard (1...7).contains(weekday) else { return "Any day" }
        return Calendar.current.weekdaySymbols[weekday % 7]
    }
}

private struct ShoppingTripView: View {
    @Environment(\.dismiss) private var dismiss
    let store: any ShoppingStore
    let catalog: ShoppingCatalog
    let canManage: Bool
    let onSaved: @MainActor () async -> Void
    @State private var trip: ShoppingTripPlan
    @State private var decisions: [ShoppingTripDecisionInput]
    @State private var isSaving = false
    @State private var isConfirmingFinalization = false
    @State private var errorMessage: String?

    init(store: any ShoppingStore, trip: ShoppingTripPlan, catalog: ShoppingCatalog,
         canManage: Bool, onSaved: @escaping @MainActor () async -> Void) {
        self.store = store
        self.catalog = catalog
        self.canManage = canManage
        self.onSaved = onSaved
        _trip = State(initialValue: trip)
        _decisions = State(initialValue: trip.entries.map {
            ShoppingTripDecisionInput(itemID: $0.itemID, decision: $0.decision)
        })
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(catalog.routines.first(where: { $0.id == trip.routineID })?.storeName ?? "Shopping trip")
                        .font(.headline)
                    Text("Planned for \(trip.plannedFor) · \(trip.status == .draft ? "Draft" : "Finalized")")
                        .foregroundStyle(.secondary)
                    if trip.status == .draft {
                        Text("Recommendations are a starting point. Review every decision before finalizing.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach([ShoppingTripDecision.buy, .checkAtHome, .skip], id: \.rawValue) { decision in
                    Section(decisionTitle(decision)) {
                        ForEach(decisions.filter { $0.decision == decision }, id: \.itemID) { entry in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(itemName(entry.itemID)).font(.headline)
                                Text(trip.entries.first(where: { $0.itemID == entry.itemID })?.reason
                                     ?? "Added by a parent.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if canManage && trip.status == .draft {
                                    Picker("Decision for \(itemName(entry.itemID))", selection: Binding(
                                        get: { decisions.first(where: { $0.itemID == entry.itemID })?.decision ?? decision },
                                        set: { newValue in
                                            guard let index = decisions.firstIndex(where: { $0.itemID == entry.itemID }) else { return }
                                            decisions[index] = ShoppingTripDecisionInput(itemID: entry.itemID, decision: newValue)
                                        }
                                    )) {
                                        Text("Buy").tag(ShoppingTripDecision.buy)
                                        Text("Check at home").tag(ShoppingTripDecision.checkAtHome)
                                        Text("Skip").tag(ShoppingTripDecision.skip)
                                    }
                                    Button("Remove \(itemName(entry.itemID)) from trip", role: .destructive) {
                                        decisions.removeAll { $0.itemID == entry.itemID }
                                    }
                                }
                            }
                        }
                    }
                }
                if canManage && trip.status == .draft {
                    Section {
                        Menu("Add Pantry item") {
                            ForEach(catalog.items.filter { item in
                                !decisions.contains(where: { $0.itemID == item.id })
                            }) { item in
                                Button(item.name) {
                                    decisions.append(ShoppingTripDecisionInput(itemID: item.id, decision: .checkAtHome))
                                }
                            }
                        }
                        Button("Save Review") { saveReview() }
                            .disabled(!hasChanges || isSaving)
                        Button("Finalize Trip") { isConfirmingFinalization = true }
                            .disabled(hasChanges || isSaving)
                    }
                }
            }
            .navigationTitle("Shopping Trip")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog("Finalize this Shopping trip?", isPresented: $isConfirmingFinalization) {
                Button("Finalize Trip") { finalize() }
            } message: {
                Text("The Family will see your reviewed decisions. Buy requests included in the plan will be resolved.")
            }
            .alert("Shopping Trip Not Saved", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) { Button("OK", role: .cancel) {} } message: {
                Text(errorMessage ?? "Please try again.")
            }
        }
    }

    private var hasChanges: Bool {
        decisions != trip.entries.map { ShoppingTripDecisionInput(itemID: $0.itemID, decision: $0.decision) }
    }

    private func itemName(_ id: UUID) -> String {
        catalog.items.first(where: { $0.id == id })?.name ?? "Pantry item"
    }

    private func decisionTitle(_ decision: ShoppingTripDecision) -> String {
        switch decision {
        case .buy: "Buy"
        case .checkAtHome: "Check at home"
        case .skip: "Skip"
        }
    }

    private func saveReview() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                trip = try await store.reviewTrip(id: trip.id, expectedVersion: trip.version, entries: decisions)
                decisions = trip.entries.map { ShoppingTripDecisionInput(itemID: $0.itemID, decision: $0.decision) }
                await onSaved()
            } catch {
                errorMessage = "The trip may have changed. Your choices are still here; close and reopen the trip to refresh before retrying."
            }
        }
    }

    private func finalize() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                trip = try await store.finalizeTrip(id: trip.id, expectedVersion: trip.version)
                await onSaved()
            } catch {
                errorMessage = "The trip may have changed. Close and reopen it before finalizing."
            }
        }
    }
}

private struct ShoppingRoutineEditor: View {
    @Environment(\.dismiss) private var dismiss
    let store: any ShoppingStore
    let routine: ShoppingRoutine?
    let onSaved: @MainActor () async -> Void
    @State private var storeName: String
    @State private var intervalWeeks: Int
    @State private var preferredWeekday: Int
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        store: any ShoppingStore,
        routine: ShoppingRoutine?,
        onSaved: @escaping @MainActor () async -> Void
    ) {
        self.store = store
        self.routine = routine
        self.onSaved = onSaved
        _storeName = State(initialValue: routine?.storeName ?? "")
        _intervalWeeks = State(initialValue: routine?.intervalWeeks ?? 1)
        _preferredWeekday = State(initialValue: routine?.preferredWeekday ?? 0)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Store name", text: $storeName)
                    .textInputAutocapitalization(.words)
                Stepper(
                    intervalWeeks == 1 ? "Every week" : "Every \(intervalWeeks) weeks",
                    value: $intervalWeeks,
                    in: 1...52
                )
                Picker("Preferred day", selection: $preferredWeekday) {
                    Text("Any day").tag(0)
                    ForEach(1...7, id: \.self) { weekday in
                        Text(ShoppingCatalogView.weekdayName(weekday)).tag(weekday)
                    }
                }
            }
            .navigationTitle(routine == nil ? "New Routine" : "Edit Routine")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(storeName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
            .alert("Routine Not Saved", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) { Button("OK", role: .cancel) {} } message: {
                Text(errorMessage ?? "Please try again.")
            }
        }
    }

    private func save() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                _ = try await store.saveRoutine(
                    id: routine?.id ?? UUID(),
                    draft: ShoppingRoutineDraft(
                        storeName: storeName,
                        intervalWeeks: intervalWeeks,
                        preferredWeekday: preferredWeekday == 0 ? nil : preferredWeekday
                    )
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = "Check the store name and try again."
            }
        }
    }
}

private struct PantryItemEditor: View {
    @Environment(\.dismiss) private var dismiss
    let store: any ShoppingStore
    let item: PantryItem?
    let routines: [ShoppingRoutine]
    let onSaved: @MainActor () async -> Void
    @State private var name: String
    @State private var category: String
    @State private var unit: String
    @State private var critical: Bool
    @State private var expectedDurationDays: String
    @State private var minimumQuantity: String
    @State private var targetQuantity: String
    @State private var selectedRoutineIDs: Set<UUID>
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        store: any ShoppingStore,
        item: PantryItem?,
        routines: [ShoppingRoutine],
        onSaved: @escaping @MainActor () async -> Void
    ) {
        self.store = store
        self.item = item
        self.routines = routines
        self.onSaved = onSaved
        _name = State(initialValue: item?.name ?? "")
        _category = State(initialValue: item?.category ?? "")
        _unit = State(initialValue: item?.unit ?? "")
        _critical = State(initialValue: item?.critical ?? false)
        _expectedDurationDays = State(initialValue: item?.expectedDurationDays.map(String.init) ?? "")
        _minimumQuantity = State(initialValue: item?.minimumQuantity.map(Self.quantityText) ?? "")
        _targetQuantity = State(initialValue: item?.targetQuantity.map(Self.quantityText) ?? "")
        _selectedRoutineIDs = State(initialValue: Set(item?.routineIDs ?? []))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Item") {
                    TextField("Name", text: $name)
                    TextField("Category (optional)", text: $category)
                    TextField("Unit (optional)", text: $unit)
                    Toggle("Critical item", isOn: $critical)
                }
                Section("Replenishment expectations") {
                    TextField("Expected duration in days", text: $expectedDurationDays)
                        .keyboardType(.numberPad)
                    TextField("Minimum quantity", text: $minimumQuantity)
                        .keyboardType(.decimalPad)
                    TextField("Target quantity", text: $targetQuantity)
                        .keyboardType(.decimalPad)
                }
                Section("Shopping routines") {
                    if routines.isEmpty {
                        Text("Create a Shopping routine first.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(routines) { routine in
                        Toggle(routine.storeName, isOn: Binding(
                            get: { selectedRoutineIDs.contains(routine.id) },
                            set: { selected in
                                if selected { selectedRoutineIDs.insert(routine.id) }
                                else { selectedRoutineIDs.remove(routine.id) }
                            }
                        ))
                    }
                }
            }
            .navigationTitle(item == nil ? "New Pantry Item" : "Edit Pantry Item")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!isValid || isSaving)
                }
            }
            .alert("Item Not Saved", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) { Button("OK", role: .cancel) {} } message: {
                Text(errorMessage ?? "Please try again.")
            }
        }
    }

    private var isValid: Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        guard expectedDurationDays.isEmpty || Int(expectedDurationDays).map({ $0 > 0 }) == true else { return false }
        guard minimumQuantity.isEmpty || Double(minimumQuantity).map({ $0 >= 0 }) == true else { return false }
        guard targetQuantity.isEmpty || Double(targetQuantity).map({ $0 >= 0 }) == true else { return false }
        if let minimum = Double(minimumQuantity), let target = Double(targetQuantity), target < minimum {
            return false
        }
        return true
    }

    private func save() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                _ = try await store.savePantryItem(
                    id: item?.id ?? UUID(),
                    draft: PantryItemDraft(
                        name: name,
                        category: optional(category),
                        unit: optional(unit),
                        critical: critical,
                        expectedDurationDays: Int(expectedDurationDays),
                        minimumQuantity: Double(minimumQuantity),
                        targetQuantity: Double(targetQuantity),
                        routineIDs: selectedRoutineIDs.sorted { $0.uuidString < $1.uuidString }
                    )
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = "Check the item details and try again."
            }
        }
    }

    private func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func quantityText(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(value)
    }
}

private struct ShoppingRequestEditor: View {
    @Environment(\.dismiss) private var dismiss
    let store: any ShoppingStore
    let item: PantryItem
    let onSaved: @MainActor () async -> Void
    @State private var quantity = ""
    @State private var note = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(item.name) {
                    TextField("Quantity (optional)", text: $quantity)
                        .keyboardType(.decimalPad)
                    TextField("Note (optional)", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                }
                Text("A request asks the Family to consider this item. A parent still finalizes the Shopping trip.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Request Item")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Request") { save() }
                        .disabled(!isValid || isSaving)
                }
            }
            .alert("Request Not Saved", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) { Button("OK", role: .cancel) {} } message: {
                Text(errorMessage ?? "Please try again.")
            }
        }
    }

    private var isValid: Bool {
        quantity.isEmpty || Double(quantity).map { $0 > 0 } == true
    }

    private func save() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                _ = try await store.requestItem(
                    id: UUID(),
                    draft: ShoppingItemRequestDraft(
                        itemID: item.id,
                        quantity: Double(quantity),
                        note: optional(note)
                    )
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = "We couldn't save that Family request."
            }
        }
    }

    private func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private struct StockObservationEditor: View {
    @Environment(\.dismiss) private var dismiss
    let store: any ShoppingStore
    let item: PantryItem
    let onSaved: @MainActor () async -> Void
    @State private var level: StockLevel = .enough
    @State private var quantity = ""
    @State private var note = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(item.name) {
                    Picker("Stock", selection: $level) {
                        Text("Enough").tag(StockLevel.enough)
                        Text("Low").tag(StockLevel.low)
                        Text("Out").tag(StockLevel.out)
                    }
                    .pickerStyle(.segmented)
                    TextField("Exact quantity (optional)", text: $quantity)
                        .keyboardType(.decimalPad)
                    TextField("Note (optional)", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                }
                Text("This is timestamped evidence, not a permanent inventory count.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Update Stock")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!isValid || isSaving)
                }
            }
            .alert("Stock Not Updated", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) { Button("OK", role: .cancel) {} } message: {
                Text(errorMessage ?? "Please try again.")
            }
        }
    }

    private var isValid: Bool {
        quantity.isEmpty || Double(quantity).map { $0 >= 0 } == true
    }

    private func save() {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                _ = try await store.observeStock(
                    id: UUID(),
                    itemID: item.id,
                    input: StockObservationInput(
                        level: level,
                        quantity: Double(quantity),
                        note: optional(note)
                    )
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = "We couldn't update that Stock observation."
            }
        }
    }

    private func optional(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
