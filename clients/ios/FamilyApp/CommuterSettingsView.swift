import FamilyCore
import SwiftUI

struct CommuterSettingsView: View {
    @StateObject private var model: CommuterSettingsModel
    @State private var isAddingSubscription = false
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
        .sheet(isPresented: $isAddingSubscription) {
            AddCommuteSubscriptionView(stops: model.catalog?.stops ?? []) { draft in
                await model.createSubscription(draft)
            }
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
                        isAddingSubscription = true
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
            }
            Text(subscriptionSummary(subscription))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Label(
                subscription.visibility == .personal ? "Personal" : "Shared with Family",
                systemImage: subscription.visibility == .personal ? "person.fill" : "person.2.fill"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
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
        let window = "\(formatMinutes(subscription.windowStartMinutes))–\(formatMinutes(subscription.windowEndMinutes))"
        let weekdays = subscription.serviceWeekdays.map(shortWeekday).joined(separator: ", ")
        let kinds = subscription.alertKinds.map { $0 == .delay ? "delays" : "cancellations" }
            .joined(separator: " + ")
        let threshold = subscription.alertKinds.contains(.delay)
            ? " · \(subscription.minimumDelayMinutes)+ min"
            : ""
        return "\(direction) · \(window) · \(weekdays) · \(kinds)\(threshold)"
    }
}

private struct AddCommuteSubscriptionView: View {
    let stops: [CaltrainStop]
    let onSave: (CommuteSubscriptionDraft) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var direction = CaltrainDirection.northbound
    @State private var originStopID = ""
    @State private var destinationStopID = ""
    @State private var selectedWeekdays = Set(1...5)
    @State private var windowStart = Self.date(hour: 7, minute: 30)
    @State private var windowEnd = Self.date(hour: 9, minute: 0)
    @State private var visibility = CommuteSubscriptionVisibility.personal
    @State private var alertDelays = true
    @State private var alertCancellations = true
    @State private var minimumDelayMinutes = 15
    @State private var isSaving = false
    @State private var saveFailed = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Trip") {
                    Picker("Direction", selection: $direction) {
                        Text("Northbound").tag(CaltrainDirection.northbound)
                        Text("Southbound").tag(CaltrainDirection.southbound)
                    }
                    Picker("From", selection: $originStopID) {
                        Text("Select a station").tag("")
                        ForEach(directionalStops) { stop in
                            Text(stop.stationName).tag(stop.id)
                        }
                    }
                    Picker("To", selection: $destinationStopID) {
                        Text("Select a station").tag("")
                        ForEach(directionalStops) { stop in
                            Text(stop.stationName).tag(stop.id)
                        }
                    }
                    if hasInvalidTravelDirection {
                        Text("Choose a destination in the selected direction of travel.")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("Days and time") {
                    weekdayPicker
                    DatePicker("Start", selection: $windowStart, displayedComponents: .hourAndMinute)
                    DatePicker("End", selection: $windowEnd, displayedComponents: .hourAndMinute)
                    if windowStartMinutes >= windowEndMinutes {
                        Text("End must be after start.")
                            .font(.caption)
                            .foregroundStyle(.red)
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
            .navigationTitle("Add commute alert")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: direction) { _ in
                originStopID = ""
                destinationStopID = ""
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

    private var weekdayPicker: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
            ForEach(1...7, id: \.self) { weekday in
                let isSelected = selectedWeekdays.contains(weekday)
                Button {
                    if isSelected {
                        selectedWeekdays.remove(weekday)
                    } else {
                        selectedWeekdays.insert(weekday)
                    }
                } label: {
                    Text(compactWeekday(weekday))
                        .font(.caption.bold())
                        .frame(maxWidth: .infinity, minHeight: 30)
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

    private var directionalStops: [CaltrainStop] {
        stops.filter { $0.direction == direction }
            .sorted { $0.stationName.localizedCaseInsensitiveCompare($1.stationName) == .orderedAscending }
    }

    private var originStop: CaltrainStop? {
        directionalStops.first { $0.id == originStopID }
    }

    private var destinationStop: CaltrainStop? {
        directionalStops.first { $0.id == destinationStopID }
    }

    private var hasInvalidTravelDirection: Bool {
        guard let originStop, let destinationStop else { return false }
        switch direction {
        case .northbound: return destinationStop.latitude <= originStop.latitude
        case .southbound: return destinationStop.latitude >= originStop.latitude
        case .unknown: return true
        }
    }

    private var canSave: Bool {
        !originStopID.isEmpty
            && !destinationStopID.isEmpty
            && originStopID != destinationStopID
            && !hasInvalidTravelDirection
            && !selectedWeekdays.isEmpty
            && windowStartMinutes < windowEndMinutes
            && (alertDelays || alertCancellations)
    }

    private var windowStartMinutes: Int { minutesSinceMidnight(windowStart) }
    private var windowEndMinutes: Int { minutesSinceMidnight(windowEnd) }

    private func save() {
        guard canSave else { return }
        var kinds: [CommuteAlertKind] = []
        if alertDelays { kinds.append(.delay) }
        if alertCancellations { kinds.append(.cancellation) }
        let draft = CommuteSubscriptionDraft(
            visibility: visibility,
            routeID: "*",
            directionID: direction.rawValue,
            originStopID: originStopID,
            destinationStopID: destinationStopID,
            serviceWeekdays: selectedWeekdays.sorted(),
            windowStartMinutes: windowStartMinutes,
            windowEndMinutes: windowEndMinutes,
            alertKinds: kinds,
            minimumDelayMinutes: minimumDelayMinutes
        )
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

    private static func date(hour: Int, minute: Int) -> Date {
        Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now) ?? .now
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
