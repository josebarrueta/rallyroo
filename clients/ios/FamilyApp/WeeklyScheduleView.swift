import SwiftUI
import FamilyCore

struct WeeklyScheduleView: View {
    @StateObject private var viewModel: WeeklyScheduleViewModel
    private let allowsEditing: Bool
    private let locationSearch: any LocationSearch
    private let scheduleDraftExtractor: (any ScheduleDraftExtractor)?
    private let reminderStore: (any ReminderStore)?
    private let memberStore: any FamilyMemberStore
    private let currentMemberID: String?
    private let calendarSourceStore: (any CalendarSourceStore)?
    private let commuterStore: (any CommuterStore)?
    @State private var weekStart = Calendar.autoupdatingCurrent.startOfDay(for: .now)
    @State private var isAddingEvent = false
    @State private var editingEvent: FamilyEvent?
    @State private var linkedEvent: FamilyEvent?
    @State private var selectedParticipantID: KidID?
    @State private var isCapturingSchedule = false
    @State private var scheduleUpdateNotice: String?
    @State private var connectedCalendarCount: Int?
    @State private var commuterState: CommuterState?

    init(
        eventStore: any EventStore,
        memberStore: any FamilyMemberStore,
        notificationStore: any ConflictNotificationStore,
        allowsEditing: Bool = true,
        locationSearch: any LocationSearch = EmptyLocationSearch(),
        alertScheduler: (any EventAlertScheduler)? = nil,
        scheduleDraftExtractor: (any ScheduleDraftExtractor)? = nil,
        reminderStore: (any ReminderStore)? = nil,
        currentMemberID: String? = nil,
        calendarSourceStore: (any CalendarSourceStore)? = nil,
        commuterStore: (any CommuterStore)? = nil
     ) {
        self.allowsEditing = allowsEditing
        self.locationSearch = locationSearch
        self.scheduleDraftExtractor = scheduleDraftExtractor
        self.reminderStore = reminderStore
        self.memberStore = memberStore
        self.currentMemberID = currentMemberID
        self.calendarSourceStore = calendarSourceStore
        self.commuterStore = commuterStore
        _viewModel = StateObject(
            wrappedValue: WeeklyScheduleViewModel(
                eventStore: eventStore,
                memberStore: memberStore,
                notificationStore: notificationStore,
                alertScheduler: alertScheduler
            )
         )
     }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                RallyrooHeader(
                    title: "Let's jam!",
                    subtitle: "One colorful week for the whole crew."
                )
                .padding(.bottom, 4)

                if allowsEditing, calendarSourceStore != nil || commuterStore != nil {
                    scheduleConnections
                        .padding(.horizontal)
                        .padding(.bottom, 8)
                }

                if viewModel.isShowingCachedEvents {
                    Label("Offline — showing saved schedule", systemImage: "wifi.slash")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(AppTheme.purple.opacity(0.08))
                }

                daySections
                    .scrollContentBackground(.hidden)
                    .background(AppTheme.background)
                    .onAppear {
                        Task { await viewModel.loadEvents() }
                    }
                    .onReceive(NotificationCenter.default.publisher(for: .familyDataDidChange)) { _ in
                        Task {
                            await viewModel.loadEvents()
                            await loadConnectionSummaries()
                        }
                    }
                    .onReceive(NotificationCenter.default.publisher(for: .scheduleUpdateNotice)) { notification in
                        scheduleUpdateNotice = notification.userInfo?["message"] as? String
                    }
                    .onReceive(NotificationCenter.default.publisher(for: .openNotificationDestination)) { note in
                        guard let destination = note.object as? InboxNotificationDestination,
                              destination.kind == .event else { return }
                        Task {
                            await viewModel.loadEvents()
                            linkedEvent = viewModel.events.first { $0.id.uuidString.lowercased() == destination.id.lowercased() }
                        }
                    }
            }
            .navigationTitle("Rallyroo")
            .task { await loadConnectionSummaries() }
            .toolbar { toolbarContent }
            .sheet(item: $linkedEvent) { event in
                NavigationStack {
                    List {
                        Section("Event") {
                            Text(event.title).font(.headline)
                            LabeledContent("Starts", value: event.startTime.formatted())
                            LabeledContent("Ends", value: event.endTime.formatted())
                            if let location = event.location { LabeledContent("Location", value: location) }
                        }
                    }
                    .navigationTitle("Event details")
                }
            }
            .sheet(isPresented: $isAddingEvent) {
                AddEventSheet(members: viewModel.members, locationSearch: locationSearch) { event, notifyParticipants, idempotencyKey in
                    try await viewModel.addEvent(
                        event,
                        notifyParticipants: notifyParticipants,
                        idempotencyKey: idempotencyKey
                    )
                }
            }
            .sheet(isPresented: $isCapturingSchedule) {
                if allowsEditing, let scheduleDraftExtractor, let reminderStore {
                    ScheduleCaptureSheet(
                        extractor: scheduleDraftExtractor,
                        members: viewModel.members,
                        onSaveEvent: { event, notifyParticipants, idempotencyKey in
                            try await viewModel.addEvent(
                                event,
                                notifyParticipants: notifyParticipants,
                                idempotencyKey: idempotencyKey
                            )
                        },
                        onSaveReminder: { try await reminderStore.save($0) }
                    )
                }
            }
            .sheet(item: $editingEvent) { event in
                AddEventSheet(
                    event: event, members: viewModel.members, locationSearch: locationSearch,
                    onSave: { event, notifyParticipants, idempotencyKey in
                        try await viewModel.addEvent(
                            event,
                            notifyParticipants: notifyParticipants,
                            idempotencyKey: idempotencyKey
                        )
                    },
                    onDelete: { event, idempotencyKey in
                        try await viewModel.deleteEvent(event, idempotencyKey: idempotencyKey)
                    }
                )
            }
            .alert("Event status", isPresented: Binding(
                get: { scheduleUpdateNotice != nil },
                set: { if !$0 { scheduleUpdateNotice = nil } }
            )) {
                Button("OK") { scheduleUpdateNotice = nil }
            } message: {
                Text(scheduleUpdateNotice ?? "")
            }
             .tint(AppTheme.purple)
        }
    }

    // MARK: - Connections

    private var scheduleConnections: some View {
        HStack(spacing: 10) {
            if let calendarSourceStore {
                NavigationLink {
                    CalendarSourcesView(
                        store: calendarSourceStore,
                        memberStore: memberStore,
                        currentMemberID: currentMemberID
                    )
                } label: {
                    connectionCard(
                        title: "Calendars",
                        subtitle: calendarSubtitle,
                        systemImage: "calendar.badge.plus"
                    )
                }
                .accessibilityIdentifier("schedule-connected-calendars")
            }
            if let commuterStore {
                NavigationLink {
                    CommuterSettingsView(store: commuterStore)
                } label: {
                    connectionCard(
                        title: "Commute",
                        subtitle: commuterSubtitle,
                        systemImage: "train.side.front.car"
                    )
                }
                .accessibilityIdentifier("schedule-commute-alerts")
            }
        }
        .buttonStyle(.plain)
    }

    private func connectionCard(title: String, subtitle: String, systemImage: String) -> some View {
        HStack(spacing: 9) {
            Image(systemName: systemImage)
                .foregroundStyle(AppTheme.purple)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.bold())
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption.bold())
                .foregroundStyle(.tertiary)
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private var calendarSubtitle: String {
        guard let connectedCalendarCount else { return "Manage sources" }
        if connectedCalendarCount == 0 { return "Connect a calendar" }
        return "\(connectedCalendarCount) connected"
    }

    private var commuterSubtitle: String {
        guard let commuterState else { return "Manage alerts" }
        guard let installation = commuterState.installation else { return "Set up alerts" }
        if installation.status == .disabled { return "Alerts paused" }
        if [.degraded, .stale].contains(commuterState.providerStatus.catalog.state)
            || [.degraded, .stale].contains(commuterState.providerStatus.realtime.state) {
            return "Service needs attention"
        }
        let active = commuterState.subscriptions.filter { $0.status == .active }.count
        if active == 0 { return "Add an alert" }
        return active == 1 ? "1 active alert" : "\(active) active alerts"
    }

    private func loadConnectionSummaries() async {
        if let calendarSourceStore {
            connectedCalendarCount = (try? await calendarSourceStore.sources().count) ?? nil
        }
        if let commuterStore {
            commuterState = try? await commuterStore.state()
        }
    }

    // MARK: - Day sections

    @ViewBuilder
    private var daySections: some View {
        if let errorMessage = viewModel.errorMessage {
            List {
                Label(errorMessage, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            }
        } else {
            List {
                ForEach(daysInWeek, id: \.self) { day in
                    Section(day.formatted(.dateTime.weekday(.wide).month().day())) {
                        let dayEvents = events(on: day)
                        if dayEvents.isEmpty {
                            Text("No activities").foregroundStyle(.secondary)
                        } else {
                            ForEach(dayEvents) { occurrence in
                                EventRow(
                                    display: ScheduleEventDisplay(
                                        event: occurrence.event,
                                        members: viewModel.members
                                    )
                                )
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    if allowsEditing && !viewModel.isShowingCachedEvents
                                        && !occurrence.sourceEvent.isReadOnly {
                                        editingEvent = occurrence.sourceEvent
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarLeading) {
            Button("Today") {
                weekStart = startOfToday
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { moveWeek(by: -1) } label: { Image(systemName: "chevron.left") }
            Button { moveWeek(by: 1) } label: { Image(systemName: "chevron.right") }
            Menu {
                Button("All family members") { selectedParticipantID = nil }
                ForEach(viewModel.members) { member in
                    Button(member.name) { selectedParticipantID = member.id }
                }
            } label: {
                Image(systemName: "line.3.horizontal.decrease.circle")
            }
            if allowsEditing && !viewModel.isShowingCachedEvents {
                if scheduleDraftExtractor != nil, reminderStore != nil {
                    Button("Create with AI", systemImage: "sparkles") {
                        isCapturingSchedule = true
                    }
                }
                Button { isAddingEvent = true } label: { Image(systemName: "plus") }
            }
        }
    }

    // MARK: - Computed helpers

    private var startOfToday: Date {
        Calendar.autoupdatingCurrent.startOfDay(for: .now)
    }

    private var daysInWeek: [Date] {
        let calendar = Calendar.autoupdatingCurrent
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: weekStart) }
    }

    private var weekOccurrences: [EventOccurrence] {
        EventOccurrenceExpander.occurrences(
            of: viewModel.events,
            in: DateInterval(
                start: weekStart,
                end: Calendar.autoupdatingCurrent.date(byAdding: .day, value: 7, to: weekStart)!
            )
        )
    }

    private func events(on day: Date) -> [EventOccurrence] {
        let calendar = Calendar.autoupdatingCurrent
        return weekOccurrences.filter {
            calendar.isDate($0.event.startTime, inSameDayAs: day)
                && (selectedParticipantID == nil || $0.event.participantIDs.contains(selectedParticipantID!))
        }
    }

    private func moveWeek(by offset: Int) {
        weekStart = Calendar.autoupdatingCurrent.date(byAdding: .weekOfYear, value: offset, to: weekStart)!
    }
}

// MARK: - Row & helpers

private extension Sequence where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}

private struct EventRow: View {
    let display: ScheduleEventDisplay

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(familyColorTag: display.primaryColorTag))
                .frame(width: 5)
            VStack(alignment: .leading, spacing: 4) {
                Text(display.event.title).font(.headline)
                if !display.participantNames.isEmpty {
                    Text(display.participantNames.joined(separator: " • "))
                        .font(.subheadline)
                        .foregroundStyle(Color(familyColorTag: display.primaryColorTag))
                }
                Text(display.event.startTime.formatted(date: .omitted, time: .shortened))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if display.event.isReadOnly {
                    Label(
                        display.event.provenance.map(\.sourceName).uniqued().joined(separator: " • "),
                        systemImage: "calendar.badge.clock"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                if let location = display.event.location, !location.isEmpty {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
