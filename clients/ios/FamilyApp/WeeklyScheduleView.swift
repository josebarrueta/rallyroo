import SwiftUI
import FamilyCore

struct WeeklyScheduleView: View {
    @StateObject private var viewModel: WeeklyScheduleViewModel
    private let allowsEditing: Bool
    private let locationSearch: any LocationSearch
    @State private var weekStart = Calendar.autoupdatingCurrent.startOfDay(for: .now)
    @State private var isAddingEvent = false
    @State private var editingEvent: FamilyEvent?
    @State private var selectedParticipantID: KidID?

    init(
        eventStore: any EventStore,
        memberStore: any FamilyMemberStore,
        notificationStore: any ConflictNotificationStore,
        allowsEditing: Bool = true,
        locationSearch: any LocationSearch = EmptyLocationSearch(),
        alertScheduler: (any EventAlertScheduler)? = nil
     ) {
        self.allowsEditing = allowsEditing
        self.locationSearch = locationSearch
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
                        Task { await viewModel.loadEvents() }
                    }
            }
            .navigationTitle("Rallyroo")
            .toolbar { toolbarContent }
            .sheet(isPresented: $isAddingEvent) {
                AddEventSheet(members: viewModel.members, locationSearch: locationSearch) {
                    try await viewModel.addEvent($0)
                }
            }
            .sheet(item: $editingEvent) { event in
                AddEventSheet(
                    event: event, members: viewModel.members, locationSearch: locationSearch,
                    onSave: { try await viewModel.addEvent($0) },
                    onDelete: { try await viewModel.deleteEvent($0) }
                )
            }
             .tint(AppTheme.purple)
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
