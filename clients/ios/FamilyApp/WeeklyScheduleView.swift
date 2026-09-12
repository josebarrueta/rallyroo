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
    @State private var editingOccurrence: EventOccurrence?
    @State private var linkedEvent: FamilyEvent?
    @State private var linkedCalendarSourceID: String?
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

                if (allowsEditing && calendarSourceStore != nil) || commuterStore != nil {
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
            .sheet(isPresented: Binding(
                get: { linkedCalendarSourceID != nil },
                set: { if !$0 { linkedCalendarSourceID = nil } }
            )) {
                if let calendarSourceStore {
                    NavigationStack {
                        CalendarSourcesView(
                            store: calendarSourceStore,
                            memberStore: memberStore,
                            currentMemberID: currentMemberID,
                            initialSourceID: linkedCalendarSourceID
                        )
                    }
                }
            }
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
            .sheet(item: $editingOccurrence) { occurrence in
                AddEventSheet(
                    event: occurrence.event,
                    recurringSource: occurrence.sourceEvent.recurrence == nil
                        && occurrence.sourceEvent.recurrenceSeriesID == nil ? nil : occurrence.sourceEvent,
                    occurrenceStart: occurrence.event.startTime,
                    supportsWeekdayScope: supportsWeekdayScope(for: occurrence.sourceEvent),
                    members: viewModel.members,
                    locationSearch: locationSearch,
                    onSave: { event, notifyParticipants, idempotencyKey in
                        try await viewModel.addEvent(
                            event,
                            notifyParticipants: notifyParticipants,
                            idempotencyKey: idempotencyKey
                        )
                    },
                    onSaveRecurring: { edit, notifyParticipants, idempotencyKey in
                        try await viewModel.updateRecurringEvent(
                            edit,
                            notifyParticipants: notifyParticipants,
                            idempotencyKey: idempotencyKey
                        )
                    },
                    onDelete: { _, idempotencyKey in
                        try await viewModel.deleteEvent(
                            occurrence.sourceEvent,
                            idempotencyKey: idempotencyKey
                        )
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
                    CommuterSettingsView(
                        store: commuterStore,
                        canManageFamilySettings: allowsEditing
                    )
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

    private func supportsWeekdayScope(for event: FamilyEvent) -> Bool {
        let seriesID = event.recurrenceSeriesID ?? (event.recurrence == nil ? nil : event.id)
        guard let seriesID else { return false }
        return viewModel.events.contains { candidate in
            let candidateSeriesID = candidate.recurrenceSeriesID
                ?? (candidate.recurrence == nil ? nil : candidate.id)
            return candidateSeriesID == seriesID && candidate.recurrence?.frequency == .weekly
        }
    }

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
                            ForEach(ScheduleOverlapCluster.make(from: dayEvents)) { cluster in
                                if cluster.items.count == 1, let occurrence = cluster.items.first?.occurrence {
                                    eventRow(for: occurrence)
                                } else {
                                    OverlapTimeline(cluster: cluster) { occurrence in
                                        eventRow(for: occurrence, compact: true)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func eventRow(for occurrence: EventOccurrence, compact: Bool = false) -> some View {
        EventRow(
            display: ScheduleEventDisplay(
                event: occurrence.event,
                members: viewModel.members
            ),
            compact: compact
        )
        .contentShape(Rectangle())
        .onTapGesture {
            if allowsEditing && !viewModel.isShowingCachedEvents {
                if occurrence.sourceEvent.isReadOnly, calendarSourceStore != nil {
                    linkedCalendarSourceID = occurrence.sourceEvent.provenance.first?.sourceID
                } else {
                    editingOccurrence = occurrence
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

private struct ScheduleOverlapCluster: Identifiable {
    struct Item: Identifiable {
        let occurrence: EventOccurrence
        let lane: Int
        var id: String { occurrence.id }
    }

    let id: String
    let items: [Item]
    let start: Date
    let end: Date
    let laneCount: Int
    let pointsPerMinute: CGFloat

    var height: CGFloat {
        max(78, CGFloat(end.timeIntervalSince(start) / 60) * pointsPerMinute)
    }

    static func make(from occurrences: [EventOccurrence]) -> [Self] {
        let sorted = occurrences.sorted { $0.event.startTime < $1.event.startTime }
        var groups: [[EventOccurrence]] = []
        var current: [EventOccurrence] = []
        var currentEnd = Date.distantPast
        for occurrence in sorted {
            if !current.isEmpty, occurrence.event.startTime >= currentEnd {
                groups.append(current)
                current = []
                currentEnd = .distantPast
            }
            current.append(occurrence)
            currentEnd = max(currentEnd, occurrence.event.endTime)
        }
        if !current.isEmpty { groups.append(current) }
        return groups.map(makeCluster)
    }

    private static func makeCluster(_ occurrences: [EventOccurrence]) -> Self {
        var laneEnds: [Date] = []
        var assignments: [(EventOccurrence, Int)] = []
        for occurrence in occurrences {
            let lane = laneEnds.firstIndex { $0 <= occurrence.event.startTime } ?? laneEnds.count
            if lane == laneEnds.count {
                laneEnds.append(occurrence.event.endTime)
            } else {
                laneEnds[lane] = occurrence.event.endTime
            }
            assignments.append((occurrence, lane))
        }
        let start = occurrences.map(\.event.startTime).min()!
        let end = occurrences.map(\.event.endTime).max()!
        let shortestMinutes = occurrences
            .map { max(1, $0.event.endTime.timeIntervalSince($0.event.startTime) / 60) }
            .min()!
        let scale = max(1.2, 78 / CGFloat(shortestMinutes))
        return Self(
            id: occurrences[0].id,
            items: assignments.map { Item(occurrence: $0.0, lane: $0.1) },
            start: start,
            end: end,
            laneCount: laneEnds.count,
            pointsPerMinute: scale
        )
    }
}

private struct OverlapTimeline<Content: View>: View {
    let cluster: ScheduleOverlapCluster
    @ViewBuilder let content: (EventOccurrence) -> Content

    var body: some View {
        GeometryReader { geometry in
            let spacing: CGFloat = 6
            let laneWidth = (geometry.size.width - spacing * CGFloat(cluster.laneCount - 1))
                / CGFloat(cluster.laneCount)
            ZStack(alignment: .topLeading) {
                ForEach(cluster.items) { item in
                    let offsetMinutes = item.occurrence.event.startTime.timeIntervalSince(cluster.start) / 60
                    let durationMinutes = item.occurrence.event.endTime
                        .timeIntervalSince(item.occurrence.event.startTime) / 60
                    content(item.occurrence)
                        .padding(8)
                        .frame(
                            width: laneWidth,
                            height: CGFloat(durationMinutes) * cluster.pointsPerMinute,
                            alignment: .topLeading
                        )
                        .background(
                            Color.secondary.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 10)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.secondary.opacity(0.25), lineWidth: 0.5)
                        )
                        .offset(
                            x: CGFloat(item.lane) * (laneWidth + spacing),
                            y: CGFloat(offsetMinutes) * cluster.pointsPerMinute
                        )
                }
            }
        }
        .frame(height: cluster.height)
    }
}

private struct EventRow: View {
    let display: ScheduleEventDisplay
    var compact = false

    var body: some View {
        HStack(alignment: .top, spacing: compact ? 7 : 12) {
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
                Text(timeRange)
                    .font(compact ? .caption : .subheadline)
                    .foregroundStyle(.secondary)
                if !compact && display.event.isReadOnly {
                    Label(
                        display.event.provenance.map(\.sourceName).uniqued().joined(separator: " • "),
                        systemImage: "calendar.badge.clock"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                if !compact, let location = display.event.location, !location.isEmpty {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var timeRange: String {
        let start = display.event.startTime.formatted(date: .omitted, time: .shortened)
        let end = display.event.endTime.formatted(date: .omitted, time: .shortened)
        return "\(start)–\(end)"
    }
}
