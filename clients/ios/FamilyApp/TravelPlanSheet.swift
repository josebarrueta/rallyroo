import SwiftUI
import FamilyCore

struct TravelPlanSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: TravelPlanViewModel
    private let readOnly: Bool

    init(
        event: FamilyEvent,
        members: [FamilyMember],
        store: any TravelPlanningStore,
        locationSearch: any LocationSearch,
        readOnly: Bool = false
    ) {
        self.readOnly = readOnly
        _model = StateObject(wrappedValue: TravelPlanViewModel(
            event: event,
            members: members,
            store: store,
            locationSearch: locationSearch
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                eventSection
                if readOnly {
                    if model.existingPlan != nil {
                        previewSection
                    } else if model.isWorking {
                        ProgressView("Loading travel details…")
                    } else {
                        Section {
                            Label("Travel details unavailable", systemImage: "car")
                            Text("No travel guidance is shared with this account.")
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    alertSection
                    originSection
                    previewSection
                    if model.existingPlan != nil {
                        Section {
                            Button("Remove travel plan", role: .destructive) {
                                Task { await model.deletePlan(); if model.didFinish { dismiss() } }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Travel plan")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(readOnly ? "Done" : "Cancel") { dismiss() }
                }
                if !readOnly {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            Task { await model.save(); if model.didFinish { dismiss() } }
                        }
                        .disabled(!model.canSave || model.isWorking)
                    }
                }
            }
            .task { await model.load(readOnly: readOnly) }
            .alert("Travel plan", isPresented: Binding(
                get: { model.message != nil },
                set: { if !$0 { model.message = nil } }
            )) {
                Button("OK") { model.message = nil }
            } message: {
                Text(model.message ?? "")
            }
        }
    }

    private var eventSection: some View {
        Section("Event") {
            Text(model.event.title).font(.headline)
            if let arrivalTime = model.event.arrivalTime {
                LabeledContent("Arrive by", value: arrivalTime.formatted(date: .abbreviated, time: .shortened))
            }
            if let location = model.event.location {
                LabeledContent("Destination", value: location)
                if let directionsURL = model.directionsURL {
                    Link(destination: directionsURL) {
                        Label("Open directions in Maps", systemImage: "map")
                    }
                    .accessibilityIdentifier("open-travel-directions")
                }
            }
        }
    }

    private var originSection: some View {
        Section("Origin") {
            Picker("Leave from", selection: $model.originChoice) {
                Text("One-time address").tag(TravelPlanViewModel.oneTimeChoice)
                ForEach(model.savedPlaces) { place in
                    Text(place.label).tag(place.id.uuidString)
                }
                if model.originChoice != TravelPlanViewModel.oneTimeChoice,
                   !model.savedPlaces.contains(where: { $0.id.uuidString == model.originChoice }) {
                    Text("Private saved place").tag(model.originChoice)
                }
            }
            .onChange(of: model.originChoice) { _ in model.originChanged() }
            if model.originChoice == TravelPlanViewModel.oneTimeChoice {
                TextField("Starting address", text: Binding(
                    get: { model.originAddress },
                    set: { model.setOriginAddress($0) }
                ))
                    .textContentType(.fullStreetAddress)
                    .accessibilityIdentifier("travelOriginAddress")
                Button("Find address") { Task { await model.searchAddresses() } }
                    .disabled(model.originAddress.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                ForEach(model.suggestions) { suggestion in
                    Button {
                        model.selectSuggestion(suggestion)
                    } label: {
                        Label(suggestion.address, systemImage: "mappin.and.ellipse")
                    }
                }
                Text("To reuse an address, add it under Settings › Saved places.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var alertSection: some View {
        Section("Alert") {
            Toggle("Leave alert", isOn: $model.leaveAlertEnabled)
                .disabled(model.eligibleMembers.isEmpty)
            if model.eligibleMembers.isEmpty {
                Text("Add an Event participant or assigned driver to enable a Leave alert.")
                    .foregroundStyle(.secondary)
            } else {
                Text("The Event participants and assigned driver will receive the alert.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var previewSection: some View {
        Section("Leave time") {
            if model.isPreviewing {
                ProgressView("Updating traffic…")
            }
            previewResult
        }
    }

    @ViewBuilder
    private var previewResult: some View {
        if let preview = model.previewResult {
            LabeledContent(
                preview.leaveNow ? "Recommendation" : "Leave at",
                value: preview.leaveNow
                    ? "Leave now"
                    : preview.leaveTime.formatted(date: .abbreviated, time: .shortened)
            )
            LabeledContent("Drive", value: model.durationText(preview.durationSeconds))
            Text(preview.attribution)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .accessibilityLabel("Google Maps")
        } else if let previewStatusMessage = model.previewStatusMessage {
            Text(previewStatusMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            Text("Select an origin to see an automatic traffic estimate.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

@MainActor
final class TravelPlanViewModel: ObservableObject {
    static let oneTimeChoice = "one-time"

    let event: FamilyEvent
    let eligibleMembers: [FamilyMember]
    @Published var savedPlaces: [SavedPlace] = []
    @Published var existingPlan: EventTravelPlan?
    @Published var originChoice = oneTimeChoice
    @Published var originAddress = ""
    @Published var suggestions: [LocationSuggestion] = []
    @Published var recipientMemberIDs = Set<String>()
    @Published var leaveAlertEnabled = true
    @Published var previewResult: TravelPreview?
    @Published var previewStatusMessage: String?
    @Published var message: String?
    @Published var isWorking = false
    @Published var isPreviewing = false
    @Published var didFinish = false

    var directionsURL: URL? {
        guard let destination = event.location else { return nil }
        let origin: String?
        if originChoice == Self.oneTimeChoice {
            origin = originAddress
        } else if let id = UUID(uuidString: originChoice) {
            origin = savedPlaces.first(where: { $0.id == id })?.waypoint.address
        } else {
            origin = nil
        }
        return MapsDirectionsURL.make(origin: origin, destination: destination)
    }

    private let store: any TravelPlanningStore
    private let locationSearch: any LocationSearch
    private var selectedOriginPlaceID: String?
    private var selectedOriginAddress: String?
    private var previewTask: Task<Void, Never>?
    private var previewGeneration = 0

    init(
        event: FamilyEvent,
        members: [FamilyMember],
        store: any TravelPlanningStore,
        locationSearch: any LocationSearch
    ) {
        self.event = event
        self.store = store
        self.locationSearch = locationSearch
        let eligibleIDs = Set(event.participantIDs + [event.driverMemberID].compactMap { $0 })
        let eligible = members.filter { eligibleIDs.contains($0.id) }
        eligibleMembers = eligible
        recipientMemberIDs = Set(eligible.map { $0.id.rawValue })
        leaveAlertEnabled = !eligible.isEmpty
    }

    var canSave: Bool {
        guard !leaveAlertEnabled || !recipientMemberIDs.isEmpty else { return false }
        if originChoice == Self.oneTimeChoice {
            let hasOrigin = selectedOriginPlaceID != nil
                || !originAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return hasOrigin
        }
        return UUID(uuidString: originChoice) != nil
    }

    func load(readOnly: Bool) async {
        isWorking = true
        do {
            async let places = store.savedPlaces()
            async let plan = store.travelPlan(for: event.id)
            savedPlaces = try await places
            if let loadedPlan = try await plan {
                existingPlan = loadedPlan
                apply(loadedPlan)
            }
            isWorking = false
            if existingPlan != nil {
                if readOnly { await previewSavedPlan() }
                else { await preview() }
            }
        } catch {
            isWorking = false
            message = "Travel planning could not be loaded."
        }
    }

    func searchAddresses() async {
        do {
            suggestions = try await locationSearch.suggestions(for: originAddress)
        } catch {
            suggestions = []
            message = "Address search is unavailable. You can still use the address you entered."
        }
    }

    func setOriginAddress(_ address: String) {
        originAddress = address
        if address != selectedOriginAddress {
            selectedOriginPlaceID = nil
            selectedOriginAddress = nil
        }
        invalidatePreview()
        schedulePreview()
    }

    func originChanged() {
        invalidatePreview()
        schedulePreview(delay: .milliseconds(150))
    }

    func selectSuggestion(_ suggestion: LocationSuggestion) {
        originAddress = suggestion.address
        selectedOriginPlaceID = suggestion.id
        selectedOriginAddress = suggestion.address
        suggestions = []
        invalidatePreview()
        schedulePreview(delay: .milliseconds(150))
    }

    func preview() async {
        guard let draft = try? makeDraft() else { return }
        previewGeneration += 1
        let generation = previewGeneration
        isPreviewing = true
        previewResult = nil
        previewStatusMessage = nil
        defer { if generation == previewGeneration { isPreviewing = false } }
        do {
            let result = try await store.previewTravelPlan(draft, for: event.id)
            guard generation == previewGeneration else { return }
            previewResult = result
        } catch let RemoteStoreError.requestFailed(statusCode) where statusCode == 503 {
            guard generation == previewGeneration else { return }
            previewStatusMessage = "Traffic is temporarily unavailable. You can still save the travel plan."
        } catch {
            guard generation == previewGeneration else { return }
            previewStatusMessage = "A traffic estimate could not be calculated right now. You can still save the travel plan."
        }
    }

    func previewSavedPlan() async {
        previewGeneration += 1
        let generation = previewGeneration
        isPreviewing = true
        previewResult = nil
        previewStatusMessage = nil
        defer { if generation == previewGeneration { isPreviewing = false } }
        do {
            let result = try await store.previewTravelPlan(for: event.id)
            guard generation == previewGeneration else { return }
            previewResult = result
        } catch let RemoteStoreError.requestFailed(statusCode) where statusCode == 503 {
            guard generation == previewGeneration else { return }
            previewStatusMessage = "Traffic is temporarily unavailable."
        } catch {
            guard generation == previewGeneration else { return }
            previewStatusMessage = "A traffic estimate could not be calculated right now."
        }
    }

    func save() async {
        guard let draft = try? makeDraft() else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await store.saveTravelPlan(draft, for: event.id)
            didFinish = true
            NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
        } catch {
            message = "The travel plan could not be saved."
        }
    }

    func deletePlan() async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await store.deleteTravelPlan(for: event.id)
            didFinish = true
            NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
        } catch {
            message = "The travel plan could not be removed."
        }
    }

    func durationText(_ seconds: Double) -> String {
        let minutes = max(1, Int((seconds / 60).rounded()))
        return "\(minutes) min"
    }

    private func apply(_ plan: EventTravelPlan) {
        recipientMemberIDs = Set(eligibleMembers.map { $0.id.rawValue })
        leaveAlertEnabled = plan.leaveAlertEnabled && !recipientMemberIDs.isEmpty
        switch plan.origin {
        case let .savedPlace(id): originChoice = id.uuidString
        case let .oneTime(waypoint):
            originChoice = Self.oneTimeChoice
            originAddress = waypoint.address ?? ""
            selectedOriginPlaceID = waypoint.placeID
            selectedOriginAddress = waypoint.address
        }
    }

    private func makeDraft() throws -> TravelPlanDraft {
        let origin: TravelPlanOrigin
        if originChoice == Self.oneTimeChoice {
            origin = .oneTime(try oneTimeWaypoint())
        } else if let id = UUID(uuidString: originChoice) {
            origin = .savedPlace(id)
        } else {
            throw TravelPlanningError.invalidWaypoint
        }
        return TravelPlanDraft.automatic(
            origin: origin,
            eligibleRecipientIDs: eligibleMembers.map { $0.id.rawValue },
            leaveAlertEnabled: leaveAlertEnabled
        )
    }

    private func invalidatePreview() {
        previewGeneration += 1
        isPreviewing = false
        previewResult = nil
        previewStatusMessage = nil
    }

    private func schedulePreview(delay: Duration = .milliseconds(700)) {
        previewTask?.cancel()
        guard canSave else { return }
        previewTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.preview()
        }
    }

    private func oneTimeWaypoint() throws -> TravelWaypoint {
        if let selectedOriginPlaceID { return try TravelWaypoint(placeID: selectedOriginPlaceID) }
        return try TravelWaypoint(address: originAddress)
    }
}
