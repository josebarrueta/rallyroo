import SwiftUI
import FamilyCore

struct NotificationsView: View {
    let inboxStore: any NotificationInboxStore
    let conflictStore: any ConflictNotificationStore
    let dayBriefStore: (any DayBriefStore)?
    let onUnreadCountChanged: (Int) -> Void
    @State private var inbox: [InboxNotification] = []
    @State private var conflicts: [ConflictNotification] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var presentedDayBrief: DayBrief?
    @State private var isPresentingDayBrief = false

    var body: some View {
        NavigationStack {
            List {
                RallyrooHeader(title: "Alerts", subtitle: "Updates, reminders, and changes for you.")
                    .listRowBackground(Color.clear)
                if isLoading && inbox.isEmpty && conflicts.isEmpty {
                    ProgressView("Loading alerts…")
                } else if inbox.isEmpty && conflicts.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "bell.slash").font(.title).foregroundStyle(.secondary)
                        Text("You're all caught up").font(.headline)
                        Text("New family schedule alerts will appear here.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical)
                }
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(inbox) { notification in
                    Button { Task { await markRead(notification) } } label: {
                        inboxRow(notification)
                    }
                    .buttonStyle(.plain)
                }
                .onDelete { offsets in
                    let ids = offsets.map { inbox[$0].id }
                    Task { await delete(ids) }
                }
                ForEach(conflicts.reversed()) { conflict in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Schedule conflict").font(.headline)
                            Text(conflict.message)
                            Text(conflict.createdAt.formatted()).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .navigationTitle("Alerts")
            .refreshable { await load() }
            .task { await load() }
            .onReceive(NotificationCenter.default.publisher(for: .openNotificationDestination)) { note in
                guard let destination = note.object as? InboxNotificationDestination,
                      destination.kind == .dayBrief else { return }
                Task { await openDayBrief(localDate: destination.id) }
            }
            .sheet(isPresented: $isPresentingDayBrief) {
                if let presentedDayBrief {
                    NavigationStack { DayBriefDetailView(brief: presentedDayBrief) }
                }
            }
            .toolbar {
                if !conflicts.isEmpty {
                    Button("Clear saved conflicts") {
                        Task { try? await conflictStore.clear(); conflicts = [] }
                    }
                }
            }
            .tint(AppTheme.purple)
        }
    }

    private func inboxRow(_ notification: InboxNotification) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon(for: notification.kind))
                .foregroundStyle(notification.readAt == nil ? AppTheme.purple : .secondary)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(displayTitle(for: notification)).font(.headline)
                    if notification.readAt == nil { Circle().fill(AppTheme.purple).frame(width: 8, height: 8) }
                }
                Text(displayBody(for: notification)).foregroundStyle(.primary)
                Text(notification.occurredAt.formatted()).font(.caption).foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the related item and marks this alert read")
    }

    private func displayTitle(for notification: InboxNotification) -> String {
        notification.kind == .dayBrief ? "Your Day Brief" : notification.title
    }

    private func displayBody(for notification: InboxNotification) -> String {
        guard notification.kind == .dayBrief else { return notification.body }
        let isLegacyBrief = notification.title != "Your Day Brief" || notification.body.count > 180
        return isLegacyBrief
            ? "Tap to view your weather, timeline, and reminders."
            : notification.body
    }

    private func icon(for kind: InboxNotificationKind) -> String {
        switch kind {
        case .eventOccurrence: "calendar"
        case .reminderOccurrence: "checklist"
        case .scheduleUpdate: "arrow.triangle.2.circlepath"
        case .commuteDisruption: "tram.fill"
        case .driverAssignment: "car.fill"
        case .savedConflict: "exclamationmark.triangle.fill"
        case .leaveTime: "car.side.fill"
        case .dayBrief: "sun.horizon.fill"
        }
    }

    @MainActor private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let remote = inboxStore.notifications()
            async let local = conflictStore.notifications()
            inbox = try await remote
            conflicts = try await local
            onUnreadCountChanged(inbox.filter { $0.readAt == nil }.count)
            errorMessage = nil
        } catch {
            conflicts = (try? await conflictStore.notifications()) ?? conflicts
            errorMessage = "Couldn't refresh alerts. Showing what is available."
        }
    }

    @MainActor private func delete(_ ids: [UUID]) async {
        do {
            for id in ids { try await inboxStore.delete(id: id) }
            inbox.removeAll { ids.contains($0.id) }
            onUnreadCountChanged(inbox.filter { $0.readAt == nil }.count)
        } catch {
            errorMessage = "Couldn't delete this alert."
        }
    }

    @MainActor private func markRead(_ notification: InboxNotification) async {
        if notification.destination.kind == .dayBrief {
            await openDayBrief(localDate: notification.destination.id)
        } else {
            NotificationCenter.default.post(
                name: .openNotificationDestination,
                object: notification.destination
            )
        }
        guard notification.readAt == nil else { return }
        do {
            try await inboxStore.markRead(id: notification.id)
            await load()
        } catch {
            errorMessage = "Couldn't mark this alert as read."
        }
    }

    @MainActor private func openDayBrief(localDate: String) async {
        guard let dayBriefStore else { return }
        do {
            guard let brief = try await dayBriefStore.brief(localDate: localDate) else {
                errorMessage = "This Day Brief is no longer available."
                return
            }
            presentedDayBrief = brief
            isPresentingDayBrief = true
        } catch {
            errorMessage = "Couldn't load this Day Brief."
        }
    }
}

private struct DayBriefDetailView: View {
    let brief: DayBrief
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(brief.title)
                        .font(.title2.bold())
                    Text(formattedLocalDate)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(displaySummary)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
            } header: {
                Text("At a glance")
            }
            if let weather = brief.facts.weather {
                Section {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: weatherSymbol(weather.conditionCode))
                            .font(.title2)
                            .foregroundStyle(AppTheme.purple)
                            .frame(width: 34)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(weatherDescription(weather.conditionCode))
                                .font(.headline)
                            Text("High \(fahrenheit(weather.highTemperatureCelsius))°F · Low \(fahrenheit(weather.lowTemperatureCelsius))°F")
                            if weather.precipitationChance > 0 {
                                Text("\(Int((weather.precipitationChance * 100).rounded()))% chance of precipitation")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Weather at \(weather.locationLabel)")
                } footer: {
                    HStack {
                        Text(weather.attribution.serviceName)
                        Spacer()
                        Link("Weather data sources & legal", destination: weather.attribution.legalPageURL)
                            .accessibilityIdentifier("day-brief-weather-sources")
                    }
                }
            }
            if !brief.facts.events.isEmpty {
                Section("Timeline") {
                    ForEach(Array(brief.facts.events.enumerated()), id: \.offset) { _, event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.title).font(.headline)
                            Text(formattedTime(event.startTime))
                            if event.roles.contains(.driver) {
                                Label("You drive", systemImage: "car.fill")
                                    .foregroundStyle(.secondary)
                            }
                            if let location = event.location, !location.isEmpty {
                                Text(location).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            if !brief.facts.reminders.isEmpty {
                Section("Reminders") {
                    ForEach(brief.facts.reminders, id: \.id) { reminder in
                        LabeledContent(
                            reminder.title,
                            value: formattedTime(reminder.dueAt)
                        )
                    }
                }
            }
        }
        .navigationTitle("Day Brief")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private var displaySummary: String {
        let candidate = brief.summary ?? brief.body
        let normalizedCandidate = candidate.localizedLowercase
        let repeatsTitle = (brief.facts.events.map(\.title) + brief.facts.reminders.map(\.title))
            .contains { normalizedCandidate.contains($0.localizedLowercase) }
        let repeatsClockTime = candidate.range(
            of: #"\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)?\b"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
        let repeatsWeather = brief.facts.weather != nil && candidate.contains("°")
        return repeatsTitle || repeatsClockTime || repeatsWeather ? paceSummary : candidate
    }

    private var paceSummary: String {
        let calendar = localCalendar
        let hours = brief.facts.events.map { calendar.component(.hour, from: $0.startTime) }
            + brief.facts.reminders.map { calendar.component(.hour, from: $0.dueAt) }
        if hours.isEmpty { return "Your day looks open." }
        let morning = hours.filter { $0 < 12 }.count
        let afternoon = hours.filter { $0 >= 12 && $0 < 17 }.count
        let evening = hours.count - morning - afternoon
        if morning >= 2 && afternoon <= 1 {
            return "Your morning is busy, with a more relaxed afternoon."
        }
        if morning == 1 && afternoon == 0 && evening == 0 {
            return "Your morning has one commitment, with the rest of the day looking open."
        }
        if morning == 0 && afternoon >= 2 {
            return "Your morning looks relaxed, with a busier afternoon."
        }
        if morning == 0 && afternoon == 1 && evening == 0 {
            return "Your morning looks relaxed, with one commitment this afternoon."
        }
        if evening > morning + afternoon {
            return "The earlier part of your day looks lighter, with more happening this evening."
        }
        return "Your plans are spread across the day."
    }

    private var formattedLocalDate: String {
        let formatter = DateFormatter()
        formatter.calendar = localCalendar
        formatter.timeZone = localCalendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: brief.localDate) else { return brief.localDate }
        formatter.dateStyle = .full
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    private var localCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: brief.timeZone) ?? .current
        return calendar
    }

    private func formattedTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        formatter.timeZone = localCalendar.timeZone
        return formatter.string(from: date)
    }

    private func fahrenheit(_ celsius: Double) -> Int {
        Int((celsius * 9 / 5 + 32).rounded())
    }

    private func weatherDescription(_ conditionCode: String) -> String {
        switch conditionCode.localizedLowercase {
        case "clear": "Clear skies"
        case "mostlyclear": "Mostly clear skies"
        case "partlycloudy": "Partly cloudy"
        case "mostlycloudy": "Mostly cloudy"
        case "cloudy": "Cloudy"
        default:
            conditionCode.replacingOccurrences(
                of: "([a-z])([A-Z])",
                with: "$1 $2",
                options: .regularExpression
            ).capitalized
        }
    }

    private func weatherSymbol(_ conditionCode: String) -> String {
        let code = conditionCode.localizedLowercase
        if code.contains("thunder") { return "cloud.bolt.rain.fill" }
        if code.contains("snow") || code.contains("flurr") { return "cloud.snow.fill" }
        if code.contains("rain") || code.contains("drizz") || code.contains("shower") {
            return "cloud.rain.fill"
        }
        if code.contains("cloud") { return "cloud.sun.fill" }
        return "sun.max.fill"
    }
}
