import SwiftUI
import FamilyCore

struct AddEventSheet: View {
    let onSave: (FamilyEvent, Bool, UUID) async throws -> EventMutationResult
    let onDelete: ((FamilyEvent, UUID) async throws -> Void)?
    let members: [FamilyMember]

    private let existingEvent: FamilyEvent?
    private let locationSearch: any LocationSearch
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var selectedParticipantIDs: Set<KidID>
    @State private var startTime: Date
    @State private var endTime: Date
    @State private var alertChoice: EventAlertChoice
    @State private var location: String
    @State private var driver: String
    @State private var repeatOption: RepeatOption
    @State private var recurrenceEndDate: Date
    @State private var selectedWeekdays: Set<EventRecurrence.Weekday>
    @State private var isSaving = false
    @State private var alertMessage = ""
    @State private var dismissAfterAlert = false
    @State private var isShowingAlert = false
    @State private var isShowingDeleteConfirmation = false
    @State private var isShowingNotifyPrompt = false
    @State private var locationSuggestions: [LocationSuggestion] = []
    @State private var locationSearchMessage: String?
    @State private var mutationID = UUID()
    @State private var deletionID = UUID()

    init(
        event: FamilyEvent? = nil,
        prefill: ActivityEventPrefill? = nil,
        members: [FamilyMember],
        locationSearch: any LocationSearch = EmptyLocationSearch(),
        onSave: @escaping (FamilyEvent, Bool, UUID) async throws -> EventMutationResult,
        onDelete: ((FamilyEvent, UUID) async throws -> Void)? = nil
    ) {
        existingEvent = event
        self.onSave = onSave
        self.onDelete = onDelete
        self.members = members
        self.locationSearch = locationSearch
        _title = State(initialValue: event?.title ?? prefill?.title ?? "")
        _selectedParticipantIDs = State(initialValue: Set(
            event?.participantIDs ?? event?.kidID.map { [$0] } ?? prefill?.participantIDs ?? []
        ))
        _startTime = State(initialValue: event?.startTime ?? .now)
        _endTime = State(initialValue: event?.endTime ?? .now.addingTimeInterval(60 * 60))
        _alertChoice = State(initialValue: event.map {
            EventAlertChoice(leadTime: $0.alertLeadTime)
        } ?? .atStart)
        _location = State(initialValue: event?.location ?? "")
        _driver = State(initialValue: event?.driver ?? "")
        _repeatOption = State(initialValue: RepeatOption(recurrence: event?.recurrence))
        _recurrenceEndDate = State(initialValue: event?.recurrence?.endDate ?? Calendar.current.date(
            byAdding: .month,
            value: 6,
            to: event?.startTime ?? .now
        )!)
        _selectedWeekdays = State(initialValue: Set(
            event?.recurrence?.weekdays ?? [Self.weekday(for: event?.startTime ?? .now)]
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Activity") {
                    TextField("Title", text: $title)
                    ForEach(members) { member in
                        Toggle(member.name, isOn: participantBinding(for: member.id))
                    }
                }

                Section("Time") {
                    DatePicker("Starts", selection: $startTime)
                    DatePicker("Ends", selection: $endTime)
                    Picker("Alert", selection: $alertChoice) {
                        ForEach(EventAlertChoice.allCases) { choice in
                            Text(choice.title).tag(choice)
                        }
                    }
                    Picker("Repeat", selection: $repeatOption) {
                        ForEach(RepeatOption.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    if repeatOption == .weekly || repeatOption == .biweekly {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("On")
                                .font(.subheadline)
                            HStack(spacing: 6) {
                                ForEach(EventRecurrence.Weekday.allCases, id: \.rawValue) { weekday in
                                    Button(weekday.shortTitle) {
                                        if selectedWeekdays.contains(weekday) && selectedWeekdays.count > 1 {
                                            selectedWeekdays.remove(weekday)
                                        } else {
                                            selectedWeekdays.insert(weekday)
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .tint(selectedWeekdays.contains(weekday) ? AppTheme.purple : .secondary)
                                    .accessibilityLabel(weekday.title)
                                    .accessibilityAddTraits(selectedWeekdays.contains(weekday) ? .isSelected : [])
                                }
                            }
                        }
                    }
                    if repeatOption != .never {
                        DatePicker(
                            "Repeat until",
                            selection: $recurrenceEndDate,
                            in: startTime...latestRecurrenceEndDate,
                            displayedComponents: .date
                        )
                    }
                }

                Section("Details") {
                    TextField("Location", text: $location)
                    ForEach(locationSuggestions.filter { $0.address != location }) { suggestion in
                        Button {
                            location = suggestion.address
                            locationSuggestions = []
                            locationSearchMessage = nil
                        } label: {
                            Label(suggestion.address, systemImage: "mappin.and.ellipse")
                                .foregroundStyle(.primary)
                        }
                    }
                    if let locationSearchMessage {
                        Label(locationSearchMessage, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    TextField("Driver", text: $driver)
                }
            }
            .navigationTitle(existingEvent == nil ? "Add Event" : "Edit Event")
            .onChange(of: startTime) { newStartTime in
                recurrenceEndDate = min(max(recurrenceEndDate, newStartTime), latestRecurrenceEndDate)
                if repeatOption != .weekly && repeatOption != .biweekly {
                    selectedWeekdays = [Self.weekday(for: newStartTime)]
                }
            }
            .task(id: location) {
                let query = location.trimmingCharacters(in: .whitespacesAndNewlines)
                guard query.count >= 2 else {
                    locationSuggestions = []
                    locationSearchMessage = nil
                    return
                }
                do {
                    try await Task.sleep(for: .milliseconds(250))
                    guard !Task.isCancelled else { return }
                    locationSuggestions = try await locationSearch.suggestions(for: query)
                    locationSearchMessage = nil
                } catch is CancellationError {
                    return
                } catch {
                    locationSuggestions = []
                    locationSearchMessage = "Location suggestions are unavailable. You can still enter a location manually."
                }
            }
            .toolbar {
                if existingEvent != nil, onDelete != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Delete", role: .destructive) {
                            isShowingDeleteConfirmation = true
                        }
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        isShowingNotifyPrompt = true
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
            .alert("Notify family?", isPresented: $isShowingNotifyPrompt) {
                Button("Yes, notify") {
                    save(notifyParticipants: true)
                }
                .keyboardShortcut(.defaultAction)
                Button("Save without notifying") {
                    save(notifyParticipants: false)
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Send one immediate schedule-update notification to the selected participants? This is separate from the scheduled event alert.")
            }
            .alert("Event status", isPresented: $isShowingAlert) {
                Button("OK") {
                    if dismissAfterAlert {
                        dismiss()
                    }
                }
            } message: {
                Text(alertMessage)
            }
            .confirmationDialog(
                "Delete this event?",
                isPresented: $isShowingDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    delete()
                }
            } message: {
                Text("This cannot be undone.")
            }
        }
    }

    private func save(notifyParticipants: Bool) {
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                let result = try await onSave(event, notifyParticipants, mutationID)
                let deliveryMessage = ScheduleUpdateNotificationMessage.make(
                    for: result.notificationOutcome
                ) ?? ""
                if result.conflicts.isEmpty && deliveryMessage.isEmpty {
                    dismiss()
                } else {
                    let conflictMessage = result.conflicts.isEmpty ? "" : ConflictNotificationMessage.make(
                        event: event,
                        conflicts: result.conflicts,
                        members: members
                    )
                    alertMessage = [conflictMessage, deliveryMessage]
                        .filter { !$0.isEmpty }
                        .joined(separator: "\n\n")
                    dismissAfterAlert = true
                    isShowingAlert = true
                }
            } catch EventValidationError.endTimeMustFollowStartTime {
                alertMessage = "The end time must be after the start time."
                dismissAfterAlert = false
                isShowingAlert = true
            } catch {
                alertMessage = "The event could not be saved."
                dismissAfterAlert = false
                isShowingAlert = true
            }
        }
    }

    private func delete() {
        guard let existingEvent, let onDelete else {
            return
        }

        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await onDelete(existingEvent, deletionID)
                dismiss()
            } catch {
                alertMessage = "The event could not be deleted."
                dismissAfterAlert = false
                isShowingAlert = true
            }
        }
    }

    private var event: FamilyEvent {
        FamilyEvent(
            id: existingEvent?.id ?? UUID(),
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            kidID: selectedParticipantIDs.first,
            participantIDs: Array(selectedParticipantIDs),
            startTime: startTime,
            endTime: endTime,
            location: optionalText(location),
            driver: optionalText(driver),
            source: existingEvent?.source ?? .manual,
            status: existingEvent?.status ?? .confirmed,
            alertLeadTime: alertChoice.leadTime,
            recurrence: repeatOption.recurrence(
                ending: recurrenceEndDate,
                weekdays: selectedWeekdays.sorted()
            )
        )
    }

    private func participantBinding(for memberID: KidID) -> Binding<Bool> {
        Binding(
            get: { selectedParticipantIDs.contains(memberID) },
            set: { isSelected in
                if isSelected {
                    selectedParticipantIDs.insert(memberID)
                } else {
                    selectedParticipantIDs.remove(memberID)
                }
            }
        )
    }

    private var latestRecurrenceEndDate: Date {
        Calendar.autoupdatingCurrent.date(byAdding: .day, value: 732, to: startTime)!
    }

    private static func weekday(for date: Date, calendar: Calendar = .autoupdatingCurrent) -> EventRecurrence.Weekday {
        let value = calendar.component(.weekday, from: date)
        return EventRecurrence.Weekday(rawValue: value == 1 ? 7 : value - 1) ?? .monday
    }

    private func optionalText(_ value: String) -> String? {
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedValue.isEmpty ? nil : trimmedValue
    }
}

private enum EventAlertChoice: Int, CaseIterable, Identifiable {
    case none = -1
    case atStart = 0
    case fiveMinutes = 5
    case fifteenMinutes = 15
    case oneHour = 60
    case oneDay = 1_440

    init(leadTime: EventAlertLeadTime?) {
        self = leadTime.flatMap { Self(rawValue: $0.rawValue) } ?? .none
    }

    var id: Int { rawValue }
    var leadTime: EventAlertLeadTime? {
        rawValue < 0 ? nil : EventAlertLeadTime(rawValue: rawValue)
    }

    var title: String {
        switch self {
        case .none: "None"
        case .atStart: "At start"
        case .fiveMinutes: "5 minutes before"
        case .fifteenMinutes: "15 minutes before"
        case .oneHour: "1 hour before"
        case .oneDay: "1 day before"
        }
    }
}

private enum RepeatOption: String, CaseIterable, Identifiable {
    case never
    case daily
    case weekly
    case biweekly
    case monthly

    var id: String { rawValue }

    var title: String {
        switch self {
        case .never: "Never"
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .biweekly: "Every two weeks"
        case .monthly: "Monthly"
        }
    }

    init(recurrence: EventRecurrence?) {
        guard let recurrence else { self = .never; return }
        switch (recurrence.frequency, recurrence.interval) {
        case (.daily, 1): self = .daily
        case (.weekly, 1): self = .weekly
        case (.weekly, 2): self = .biweekly
        case (.monthly, 1): self = .monthly
        default: self = .never
        }
    }

    func recurrence(
        ending endDate: Date,
        weekdays: [EventRecurrence.Weekday]
    ) -> EventRecurrence? {
        switch self {
        case .never: nil
        case .daily: EventRecurrence(frequency: .daily, endDate: endDate)
        case .weekly: EventRecurrence(frequency: .weekly, weekdays: weekdays, endDate: endDate)
        case .biweekly: EventRecurrence(frequency: .weekly, interval: 2, weekdays: weekdays, endDate: endDate)
        case .monthly: EventRecurrence(frequency: .monthly, endDate: endDate)
        }
    }
}

private extension EventRecurrence.Weekday {
    var title: String {
        switch self {
        case .monday: "Monday"
        case .tuesday: "Tuesday"
        case .wednesday: "Wednesday"
        case .thursday: "Thursday"
        case .friday: "Friday"
        case .saturday: "Saturday"
        case .sunday: "Sunday"
        }
    }

    var shortTitle: String { String(title.prefix(2)) }
}
