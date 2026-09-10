import FamilyCore
import SwiftUI

struct CommuterSettingsView: View {
    @StateObject private var model: CommuterSettingsModel
    @State private var subscriptionEditor: CommuteSubscriptionEditor?
    @State private var isConfirmingRemoval = false

    init(store: any CommuterStore) {
        _model = StateObject(wrappedValue: CommuterSettingsModel(store: store))
    }

    var body: some View {
        Group {
            if model.isLoading, model.state == nil {
                ProgressView("Loading Commuter…")
            } else if let state = model.state {
                List {
                    installationSection(state.installation)
                    providerSection(state.providerStatus)
                    subscriptionsSection(state)
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "train.side")
                        .font(.largeTitle)
                    Text("Commuter unavailable")
                        .font(.headline)
                    Text("Check your connection and try again.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Retry") { Task { await model.load() } }
                }
                .padding()
            }
        }
        .navigationTitle("Commuter")
        .task { await model.load() }
        .refreshable { await model.load() }
        .onReceive(NotificationCenter.default.publisher(for: .familyDataDidChange)) { _ in
            Task { await model.load() }
        }
        .overlay(alignment: .center) {
            if model.isMutating {
                ProgressView()
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .alert(
            "Commuter",
            isPresented: Binding(
                get: { model.errorMessage != nil },
                set: { if !$0 { model.clearError() } }
            )
        ) {
            Button("OK", role: .cancel) { model.clearError() }
        } message: {
            Text(model.errorMessage ?? "Please try again.")
        }
        .confirmationDialog(
            "Remove Commuter?",
            isPresented: $isConfirmingRemoval,
            titleVisibility: .visible
        ) {
            Button("Remove Commuter", role: .destructive) {
                Task { _ = await model.removeModule() }
            }
            .accessibilityIdentifier("confirm-remove-commuter")
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("All commute alerts will be deleted. Events created from commute plans are not affected.")
        }
        .sheet(item: $subscriptionEditor) { editor in
            AddCommuteSubscriptionView(
                stops: model.catalog?.stops ?? [],
                subscription: editor.subscription,
                onSearch: { search in await model.searchJourneys(search) },
                onSave: { draft in
                    if let subscription = editor.subscription {
                        return await model.updateSubscription(subscription, with: draft)
                    }
                    return await model.createSubscription(draft)
                }
            )
        }
    }

    @ViewBuilder
    private func installationSection(_ installation: CommuterInstallation?) -> some View {
        Section("Installation") {
            switch installation?.status {
            case .enabled:
                Label("Enabled", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Button("Disable Commuter") {
                    Task { _ = await model.disable() }
                }
                Button("Remove Commuter", role: .destructive) {
                    isConfirmingRemoval = true
                }
            case .disabled:
                Label("Disabled — alerts are paused", systemImage: "pause.circle.fill")
                    .foregroundStyle(.orange)
                Button("Enable Commuter") {
                    Task { _ = await model.enable() }
                }
                Button("Remove Commuter", role: .destructive) {
                    isConfirmingRemoval = true
                }
            case nil:
                Text("Enable Caltrain commute alerts for this Family. Configuration is shared, while each alert can be personal or Family-visible.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Enable Commuter") {
                    Task { _ = await model.enable() }
                }
            }
        }
        .disabled(model.isMutating)
    }

    private func providerSection(_ status: CommuterProviderStatus) -> some View {
        Section("Provider status") {
            providerRow("Station catalog", status: status.catalog)
            providerRow("Realtime", status: status.realtime)
            Text("Provider health is separate from whether Commuter is installed or enabled. Transit data provided by 511.org.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func providerRow(
        _ title: String,
        status: CommuterProviderFeedStatus
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Label(healthLabel(status.state), systemImage: healthIcon(status.state))
                    .font(.caption)
                    .foregroundStyle(healthColor(status.state))
            }
            if let lastSuccessAt = status.lastSuccessAt {
                Text("Last good update \(lastSuccessAt.formatted(.relative(presentation: .named)))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func subscriptionsSection(_ state: CommuterState) -> some View {
        Section {
            if state.subscriptions.isEmpty {
                Text(state.installation == nil
                     ? "Enable Commuter to add an alert."
                     : "No commute alerts yet.")
                    .foregroundStyle(.secondary)
            }
            ForEach(state.subscriptions) { subscription in
                subscriptionRow(subscription)
            }
        } header: {
            HStack {
                Text("Commute alerts")
                Spacer()
                if state.installation?.status == .enabled {
                    Button {
                        subscriptionEditor = CommuteSubscriptionEditor(subscription: nil)
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .accessibilityLabel("Add commute alert")
                    .disabled(model.isMutating || model.catalog?.stops.isEmpty != false)
                }
            }
        } footer: {
            if state.installation?.status == .enabled, model.catalog?.stops.isEmpty != false {
                Text("A last-good station catalog is required before an alert can be added.")
            }
        }
    }

    private func subscriptionRow(_ subscription: CommuteSubscription) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(subscriptionTitle(subscription))
                    .font(.headline)
                Spacer()
                if subscription.status == .paused {
                    Label("Paused", systemImage: "pause.circle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.tertiary)
            }
            Text(subscriptionSummary(subscription))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if subscription.scheduleAvailability == .needsReselection {
                Label("Schedule changed — delete and choose this train again", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            Label(
                subscription.visibility == .personal ? "Personal" : "Shared with Family",
                systemImage: subscription.visibility == .personal ? "person.fill" : "person.2.fill"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            subscriptionEditor = CommuteSubscriptionEditor(subscription: subscription)
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens this commute alert for editing")
        .swipeActions(edge: .leading) {
            Button(subscription.status == .active ? "Pause" : "Resume") {
                Task { _ = await model.toggleStatus(of: subscription) }
            }
            .tint(subscription.status == .active ? .orange : .green)
        }
        .swipeActions {
            Button("Delete", role: .destructive) {
                Task { _ = await model.remove(subscription) }
            }
        }
    }

    private func subscriptionTitle(_ subscription: CommuteSubscription) -> String {
        let stops = model.catalog?.stops ?? []
        let origin = stops.first { $0.id == subscription.originStopID }?.stationName
            ?? "Origin station"
        let destination = stops.first { $0.id == subscription.destinationStopID }?.stationName
            ?? "Destination station"
        return "\(origin) → \(destination)"
    }

    private func subscriptionSummary(_ subscription: CommuteSubscription) -> String {
        let direction = subscription.directionID == CaltrainDirection.northbound.rawValue
            ? "Northbound" : "Southbound"
        let window: String
        if let departure = subscription.scheduledDepartureMinutes,
           let arrival = subscription.scheduledArrivalMinutes {
            window = "\(formatMinutes(departure)) → \(formatMinutes(arrival))"
        } else {
            window = "\(formatMinutes(subscription.windowStartMinutes))–\(formatMinutes(subscription.windowEndMinutes))"
        }
        let weekdays = subscription.serviceWeekdays.map(shortWeekday).joined(separator: ", ")
        let kinds = subscription.alertKinds.map { $0 == .delay ? "delays" : "cancellations" }
            .joined(separator: " + ")
        let threshold = subscription.alertKinds.contains(.delay)
            ? " · \(subscription.minimumDelayMinutes)+ min"
            : ""
        return "\(direction) · \(window) · \(weekdays) · \(kinds)\(threshold)"
    }
}

private struct CommuteSubscriptionEditor: Identifiable {
    let id = UUID()
    let subscription: CommuteSubscription?
}

private struct AddCommuteSubscriptionView: View {
    let stops: [CaltrainStop]
    let subscription: CommuteSubscription?
    let onSearch: (CaltrainJourneySearch) async -> CaltrainJourneySearchResult?
    let onSave: (CommuteSubscriptionDraft) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @StateObject private var selection = CommuterScheduleSelection()
    @State private var visibility = CommuteSubscriptionVisibility.personal
    @State private var alertDelays = true
    @State private var alertCancellations = true
    @State private var minimumDelayMinutes = 15
    @State private var isSearching = false
    @State private var isSaving = false
    @State private var saveFailed = false
    @State private var didPrepareForEditing = false

    init(
        stops: [CaltrainStop],
        subscription: CommuteSubscription? = nil,
        onSearch: @escaping (CaltrainJourneySearch) async -> CaltrainJourneySearchResult?,
        onSave: @escaping (CommuteSubscriptionDraft) async -> Bool
    ) {
        self.stops = stops
        self.subscription = subscription
        self.onSearch = onSearch
        self.onSave = onSave
        _visibility = State(initialValue: subscription?.visibility ?? .personal)
        _alertDelays = State(initialValue: subscription?.alertKinds.contains(.delay) ?? true)
        _alertCancellations = State(initialValue: subscription?.alertKinds.contains(.cancellation) ?? true)
        _minimumDelayMinutes = State(initialValue: subscription?.minimumDelayMinutes ?? 15)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Trip") {
                    Picker("From", selection: originBinding) {
                        Text("Select a station").tag("")
                        ForEach(stationChoices) { station in
                            Text(station.name).tag(station.id)
                        }
                    }
                    Picker("To", selection: destinationBinding) {
                        Text("Select a station").tag("")
                        ForEach(destinationChoices) { station in
                            Text(station.name).tag(station.id)
                        }
                    }
                    .disabled(selection.originStationID == nil)
                }

                Section("Schedule days") {
                    Picker("Schedule", selection: dayGroupBinding) {
                        Text("Choose").tag(Optional<CommuteScheduleDayGroup>.none)
                        Text("Weekdays").tag(Optional(CommuteScheduleDayGroup.weekdays))
                        Text("Weekends").tag(Optional(CommuteScheduleDayGroup.weekends))
                    }
                    .pickerStyle(.segmented)
                    .disabled(selection.originStationID == nil || selection.destinationStationID == nil)

                    if selection.dayGroup != nil {
                        weekdayPicker
                        Text(selection.dayGroup == .weekdays
                             ? "Choose your commute days from Monday through Friday."
                             : "Choose Saturday, Sunday, or both.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Scheduled train") {
                    if isSearching {
                        HStack {
                            ProgressView()
                            Text("Loading available trains…")
                                .foregroundStyle(.secondary)
                        }
                    } else if selection.searchRequest == nil {
                        Text("Choose From, To, a schedule, and at least one commute day.")
                            .foregroundStyle(.secondary)
                    } else if selection.journeyOptions.isEmpty {
                        Text("No train runs at the same scheduled time on every selected day.")
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Departure", selection: journeyBinding) {
                            Text("Select a train").tag("")
                            ForEach(selection.journeyOptions) { option in
                                Text(
                                    "\(formatMinutes(option.departureMinutes)) · arrives \(formatMinutes(option.arrivalMinutes))"
                                )
                                .tag(option.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .accessibilityHint("Choose a scheduled origin departure")
                    }
                    if let health = selection.scheduleStatus?.state,
                       health == .degraded || health == .stale {
                        Label("Showing the last available Caltrain schedule.", systemImage: "clock.badge.exclamationmark")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    if let selected = selection.selectedJourney {
                        LabeledContent("Arrival", value: formatMinutes(selected.arrivalMinutes))
                            .accessibilityHint("Arrival is determined by the selected train")
                    }
                }

                Section("Alert me about") {
                    Toggle("Delays", isOn: $alertDelays)
                    Toggle("Cancellations", isOn: $alertCancellations)
                    if alertDelays {
                        Picker("Minimum delay", selection: $minimumDelayMinutes) {
                            ForEach([5, 10, 15, 20, 30], id: \.self) { minutes in
                                Text("\(minutes) minutes").tag(minutes)
                            }
                        }
                    }
                    if !alertDelays, !alertCancellations {
                        Text("Select at least one alert type.")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("Visibility") {
                    Picker("Visibility", selection: $visibility) {
                        Text("Personal").tag(CommuteSubscriptionVisibility.personal)
                        Text("Family").tag(CommuteSubscriptionVisibility.family)
                    }
                    .pickerStyle(.segmented)
                    Text(visibility == .personal
                         ? "Only your devices receive these alerts."
                         : "Everyone in your Family can see this commute and receive its alerts.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if saveFailed {
                    Section {
                        Label("The commute alert could not be saved. Please try again.", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(subscription == nil ? "Add commute alert" : "Edit commute alert")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                guard !didPrepareForEditing, let subscription else { return }
                didPrepareForEditing = true
                selection.prepareForEditing(subscription, stops: stops)
                refreshJourneys()
            }
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

    private var originBinding: Binding<String> {
        Binding(
            get: { selection.originStationID ?? "" },
            set: { value in
                selection.selectOrigin(value.isEmpty ? nil : value)
                refreshJourneys()
            }
        )
    }

    private var destinationBinding: Binding<String> {
        Binding(
            get: { selection.destinationStationID ?? "" },
            set: { value in
                selection.selectDestination(value.isEmpty ? nil : value)
                refreshJourneys()
            }
        )
    }

    private var journeyBinding: Binding<String> {
        Binding(
            get: { selection.selectedJourney?.id ?? "" },
            set: { journeyID in
                guard let option = selection.journeyOptions.first(where: { $0.id == journeyID }) else { return }
                selection.selectJourney(option)
            }
        )
    }

    private var dayGroupBinding: Binding<CommuteScheduleDayGroup?> {
        Binding(
            get: { selection.dayGroup },
            set: { value in
                guard let value else { return }
                selection.selectDayGroup(value)
                refreshJourneys()
            }
        )
    }

    private var weekdayPicker: some View {
        HStack(spacing: 8) {
            ForEach(selection.availableWeekdays, id: \.self) { weekday in
                let isSelected = selection.selectedWeekdays.contains(weekday)
                Button {
                    selection.toggleWeekday(weekday)
                    refreshJourneys()
                } label: {
                    Text(compactWeekday(weekday))
                        .font(.caption.bold())
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .foregroundStyle(isSelected ? .white : .primary)
                        .background(
                            isSelected ? AppTheme.purple : Color.secondary.opacity(0.15),
                            in: Circle()
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(longWeekday(weekday))
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }

    private var stationChoices: [CaltrainStationChoice] {
        CommuterScheduleSelection.stationChoices(from: stops)
    }

    private var destinationChoices: [CaltrainStationChoice] {
        stationChoices.filter { $0.id != selection.originStationID }
    }

    private var canSave: Bool {
        selection.selectedJourney != nil && (alertDelays || alertCancellations)
    }

    private func refreshJourneys() {
        guard let intent = selection.searchIntent else {
            isSearching = false
            return
        }
        isSearching = true
        Task {
            let result = await onSearch(intent.request)
            guard intent == selection.searchIntent else { return }
            if let result {
                selection.applySearchResult(result, for: intent)
            }
            isSearching = false
        }
    }

    private func save() {
        var kinds: [CommuteAlertKind] = []
        if alertDelays { kinds.append(.delay) }
        if alertCancellations { kinds.append(.cancellation) }
        guard let draft = selection.subscriptionDraft(
            visibility: visibility,
            alertKinds: kinds,
            minimumDelayMinutes: minimumDelayMinutes
        ) else { return }
        isSaving = true
        saveFailed = false
        Task {
            let succeeded = await onSave(draft)
            isSaving = false
            if succeeded {
                dismiss()
            } else {
                saveFailed = true
            }
        }
    }
}
private func minutesSinceMidnight(_ date: Date) -> Int {
    let components = Calendar.current.dateComponents([.hour, .minute], from: date)
    return (components.hour ?? 0) * 60 + (components.minute ?? 0)
}

private func formatMinutes(_ minutes: Int) -> String {
    DateComponents(calendar: .current, hour: minutes / 60, minute: minutes % 60)
        .date?
        .formatted(date: .omitted, time: .shortened) ?? ""
}

private func shortWeekday(_ weekday: Int) -> String {
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][safe: weekday - 1] ?? ""
}

private func compactWeekday(_ weekday: Int) -> String {
    ["M", "Tu", "W", "Th", "F", "Sa", "Su"][safe: weekday - 1] ?? ""
}

private func longWeekday(_ weekday: Int) -> String {
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][safe: weekday - 1] ?? ""
}

private func healthLabel(_ health: CommuterProviderHealth) -> String {
    switch health {
    case .unavailable: "Unavailable"
    case .healthy: "Healthy"
    case .degraded: "Degraded"
    case .stale: "Stale"
    }
}

private func healthIcon(_ health: CommuterProviderHealth) -> String {
    switch health {
    case .unavailable: "xmark.circle.fill"
    case .healthy: "checkmark.circle.fill"
    case .degraded: "exclamationmark.circle.fill"
    case .stale: "clock.fill"
    }
}

private func healthColor(_ health: CommuterProviderHealth) -> Color {
    switch health {
    case .unavailable: .red
    case .healthy: .green
    case .degraded: .orange
    case .stale: .secondary
    }
}

private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
