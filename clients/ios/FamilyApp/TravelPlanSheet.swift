import SwiftUI
import FamilyCore

struct TravelPlanSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: TravelPlanViewModel

    init(
        event: FamilyEvent,
        members: [FamilyMember],
        store: any TravelPlanningStore,
        locationSearch: any LocationSearch
    ) {
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
                originSection
                timingSection
                recipientSection
                previewSection
                if model.existingPlan != nil {
                    Section {
                        Button("Remove travel plan", role: .destructive) {
                            Task { await model.deletePlan(); if model.didFinish { dismiss() } }
                        }
                    }
                }
            }
            .navigationTitle("Travel plan")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await model.save(); if model.didFinish { dismiss() } }
                    }
                    .disabled(!model.canSave || model.isWorking)
                }
            }
            .task { await model.load() }
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
                Toggle("Save this origin", isOn: $model.shouldSaveOrigin)
                if model.shouldSaveOrigin {
                    TextField("Place name", text: $model.savedPlaceLabel)
                    Picker("Visible to", selection: $model.savedPlaceVisibility) {
                        Text("Family").tag(SavedPlaceVisibility.family)
                        Text("Only me").tag(SavedPlaceVisibility.personal)
                    }
                }
            }
        }
    }

    private var timingSection: some View {
        Section("Timing") {
            Stepper("Preparation: \(model.preparationMinutes) min", value: $model.preparationMinutes, in: 0...180, step: 5)
            Picker("Traffic estimate", selection: $model.trafficPreference) {
                Text("Best estimate").tag(TrafficPreference.bestGuess)
                Text("Extra cautious").tag(TrafficPreference.pessimistic)
            }
            if !model.eligibleMembers.isEmpty {
                Toggle("Leave alert", isOn: $model.leaveAlertEnabled)
            }
        }
    }

    private var recipientSection: some View {
        Section("Alert recipients") {
            ForEach(model.eligibleMembers) { member in
                Toggle(member.name, isOn: Binding(
                    get: { model.recipientMemberIDs.contains(member.id.rawValue) },
                    set: { model.setRecipient(member.id.rawValue, selected: $0) }
                ))
            }
            if model.eligibleMembers.isEmpty {
                Text("Add an Event participant or assigned driver before planning travel.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var previewSection: some View {
        Section("Leave time") {
            Button(model.isPreviewing ? "Calculating…" : "Calculate with traffic") {
                Task { await model.preview() }
            }
            .disabled(!model.canSave || model.isWorking)
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
            } else {
                Text("Traffic guidance is a preview and may change before departure.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
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
    @Published var shouldSaveOrigin = false
    @Published var savedPlaceLabel = ""
    @Published var savedPlaceVisibility = SavedPlaceVisibility.family
    @Published var preparationMinutes = 15
    @Published var trafficPreference = TrafficPreference.bestGuess
    @Published var recipientMemberIDs = Set<String>()
    @Published var leaveAlertEnabled = true
    @Published var previewResult: TravelPreview?
    @Published var message: String?
    @Published var isWorking = false
    @Published var isPreviewing = false
    @Published var didFinish = false

    private let store: any TravelPlanningStore
    private let locationSearch: any LocationSearch
    private var selectedOriginPlaceID: String?
    private var selectedOriginAddress: String?

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
            let validSavedPlace = !shouldSaveOrigin
                || !savedPlaceLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return hasOrigin && validSavedPlace
        }
        return UUID(uuidString: originChoice) != nil
    }

    func load() async {
        isWorking = true
        defer { isWorking = false }
        do {
            async let places = store.savedPlaces()
            async let plan = store.travelPlan(for: event.id)
            savedPlaces = try await places
            if let loadedPlan = try await plan {
                existingPlan = loadedPlan
                apply(loadedPlan)
            }
        } catch {
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
        previewResult = nil
    }

    func selectSuggestion(_ suggestion: LocationSuggestion) {
        originAddress = suggestion.address
        selectedOriginPlaceID = suggestion.id
        selectedOriginAddress = suggestion.address
        suggestions = []
        previewResult = nil
    }

    func setRecipient(_ id: String, selected: Bool) {
        if selected { recipientMemberIDs.insert(id) }
        else { recipientMemberIDs.remove(id) }
        previewResult = nil
    }

    func preview() async {
        guard let draft = try? makeDraft() else { return }
        isPreviewing = true
        previewResult = nil
        defer { isPreviewing = false }
        do {
            previewResult = try await store.previewTravelPlan(draft, for: event.id)
        } catch let RemoteStoreError.requestFailed(statusCode) where statusCode == 503 {
            message = "Traffic estimates are temporarily unavailable. You can still save the travel plan."
        } catch {
            message = "A leave time could not be calculated right now."
        }
    }

    func save() async {
        guard var draft = try? makeDraft() else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            if shouldSaveOrigin, originChoice == Self.oneTimeChoice {
                let place = try await store.createSavedPlace(SavedPlaceDraft(
                    visibility: savedPlaceVisibility,
                    label: savedPlaceLabel,
                    waypoint: try oneTimeWaypoint()
                ))
                draft = TravelPlanDraft(
                    origin: .savedPlace(place.id),
                    preparationMinutes: draft.preparationMinutes,
                    trafficPreference: draft.trafficPreference,
                    recipientMemberIDs: draft.recipientMemberIDs,
                    leaveAlertEnabled: draft.leaveAlertEnabled
                )
            }
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
        preparationMinutes = plan.preparationMinutes
        trafficPreference = plan.trafficPreference
        recipientMemberIDs = Set(plan.recipientMemberIDs)
        leaveAlertEnabled = plan.leaveAlertEnabled
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
        return TravelPlanDraft(
            origin: origin,
            preparationMinutes: preparationMinutes,
            trafficPreference: trafficPreference,
            recipientMemberIDs: recipientMemberIDs.sorted(),
            leaveAlertEnabled: leaveAlertEnabled
        )
    }

    private func oneTimeWaypoint() throws -> TravelWaypoint {
        if let selectedOriginPlaceID { return try TravelWaypoint(placeID: selectedOriginPlaceID) }
        return try TravelWaypoint(address: originAddress)
    }
}
