import SwiftUI
import UIKit
@preconcurrency import UserNotifications
import FamilyCore

private enum AppTab: Hashable { case schedule, reminders, family, alerts, settings }

#if DEBUG
private actor OccurrenceLifecycleUITestEventStore: EventStore {
    private let events: [FamilyEvent]

    init(now: Date = Date(), calendar: Calendar = .autoupdatingCurrent) {
        let day = calendar.startOfDay(for: now)
        let skippedStart = calendar.date(byAdding: .hour, value: 9, to: day)!
        let modifiedStart = calendar.date(byAdding: .hour, value: 11, to: day)!
        let skippedSeriesID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
        let modifiedSeriesID = UUID(uuidString: "10000000-0000-4000-8000-000000000002")!
        let overrideID = UUID(uuidString: "10000000-0000-4000-8000-000000000003")!
        let skippedState = ScheduleOccurrenceState(
            familyID: "ui-test-family",
            reference: ScheduleOccurrenceReference(
                kind: .event, seriesID: skippedSeriesID, scheduledAt: skippedStart
            ),
            disposition: .skipped,
            acknowledgedMemberIDs: [],
            overrideEntityID: nil,
            completedAt: nil,
            completedByMemberID: nil
        )
        let modifiedState = ScheduleOccurrenceState(
            familyID: "ui-test-family",
            reference: ScheduleOccurrenceReference(
                kind: .event, seriesID: modifiedSeriesID,
                scheduledAt: calendar.date(byAdding: .hour, value: 10, to: day)!
            ),
            disposition: .scheduled,
            acknowledgedMemberIDs: [],
            overrideEntityID: overrideID,
            completedAt: nil,
            completedByMemberID: nil
        )
        events = [
            FamilyEvent(
                id: skippedSeriesID, title: "Skipped practice", kidID: nil,
                participantIDs: [], startTime: skippedStart,
                endTime: skippedStart.addingTimeInterval(3_600), source: .manual,
                status: .confirmed,
                recurrence: EventRecurrence(frequency: .weekly, interval: 1, endDate: skippedStart),
                recurrenceSeriesID: skippedSeriesID, occurrenceStates: [skippedState]
            ),
            FamilyEvent(
                id: overrideID, title: "Modified practice", kidID: nil,
                participantIDs: [], startTime: modifiedStart,
                endTime: modifiedStart.addingTimeInterval(3_600), source: .manual,
                status: .confirmed, recurrenceSeriesID: modifiedSeriesID,
                occurrenceStates: [modifiedState]
            ),
        ]
    }

    func loadEvents() async throws -> EventSnapshot { EventSnapshot(events: events, freshness: .fresh) }
    func save(_ event: FamilyEvent, notifyParticipants: Bool, idempotencyKey: UUID) async throws -> EventMutationResult {
        throw CocoaError(.featureUnsupported)
    }
    func delete(_ event: FamilyEvent, idempotencyKey: UUID) async throws { throw CocoaError(.featureUnsupported) }
    func updateRecurringEvent(
        _ edit: RecurringEventEdit, notifyParticipants: Bool, idempotencyKey: UUID
    ) async throws -> EventMutationResult { throw CocoaError(.featureUnsupported) }
    func clearCache() async throws {}
}

private actor OccurrenceLifecycleUITestStore: OccurrenceLifecycleStore {
    func skip(_ reference: OccurrenceReference, scope: OccurrenceScope) async throws {}
    func restore(_ reference: OccurrenceReference, scope: OccurrenceScope) async throws {}
    func delete(_ reference: OccurrenceReference, scope: OccurrenceScope) async throws {}
    func acknowledge(_ reference: OccurrenceReference) async throws {}
}

private actor ShoppingUITestStore: ShoppingStore {
    private let routineID = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    private var routines: [ShoppingRoutine]
    private var items: [PantryItem]

    init() {
        let timestamp = Date(timeIntervalSince1970: 1_791_187_200)
        routines = [ShoppingRoutine(
            id: routineID, familyID: "ui-test-family", storeName: "Neighborhood Market",
            intervalWeeks: 1, preferredWeekday: 6, createdByMemberID: "parent",
            createdAt: timestamp, updatedAt: timestamp
        )]
        items = [PantryItem(
            id: UUID(uuidString: "20000000-0000-4000-8000-000000000001")!,
            familyID: "ui-test-family", name: "Oat milk", category: "Dairy alternatives",
            unit: "cartons", critical: true, expectedDurationDays: 7,
            minimumQuantity: 1, targetQuantity: 2, routineIDs: [routineID],
            createdByMemberID: "parent", createdAt: timestamp, updatedAt: timestamp
        )]
    }

    func catalog() async throws -> ShoppingCatalog {
        ShoppingCatalog(routines: routines, items: items)
    }

    func saveRoutine(id: UUID, draft: ShoppingRoutineDraft) async throws -> ShoppingRoutine {
        let timestamp = Date()
        let saved = ShoppingRoutine(
            id: id, familyID: "ui-test-family", storeName: draft.storeName,
            intervalWeeks: draft.intervalWeeks, preferredWeekday: draft.preferredWeekday,
            createdByMemberID: "parent", createdAt: timestamp, updatedAt: timestamp
        )
        routines.removeAll { $0.id == id }
        routines.append(saved)
        return saved
    }

    func deleteRoutine(id: UUID) async throws { routines.removeAll { $0.id == id } }

    func savePantryItem(id: UUID, draft: PantryItemDraft) async throws -> PantryItem {
        let timestamp = Date()
        let saved = PantryItem(
            id: id, familyID: "ui-test-family", name: draft.name, category: draft.category,
            unit: draft.unit, critical: draft.critical,
            expectedDurationDays: draft.expectedDurationDays,
            minimumQuantity: draft.minimumQuantity, targetQuantity: draft.targetQuantity,
            routineIDs: draft.routineIDs, createdByMemberID: "parent",
            createdAt: timestamp, updatedAt: timestamp
        )
        items.removeAll { $0.id == id }
        items.append(saved)
        return saved
    }

    func deletePantryItem(id: UUID) async throws { items.removeAll { $0.id == id } }
}
#endif

@main
struct FamilyActivityCoordinatorApp: App {
    @UIApplicationDelegateAdaptor(PushNotificationDelegate.self) private var pushNotificationDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .schedule
    @State private var unreadAlertCount = 0
    @StateObject private var sharedCaptureInbox = SharedScheduleCaptureInbox()
    private let eventStore: any EventStore
    private let memberStore: any FamilyMemberStore
    private let notificationStore: any ConflictNotificationStore
    private let inboxStore: any NotificationInboxStore
    private let reminderStore: any ReminderStore
    private let reminderAlertScheduler: (any ReminderAlertScheduler)?
    private let eventAlertScheduler: (any EventAlertScheduler)?
    private let authentication: any Authentication
    private let locationSearch: any LocationSearch
    private let invitationStore: (any FamilyInvitationStore)?
    private let occurrenceLifecycleStore: (any OccurrenceLifecycleStore)?
    private let calendarSourceStore: (any CalendarSourceStore)?
    private let changeMonitor: (any FamilyChangeMonitor)?
    private let deviceRegistrationStore: (any DeviceRegistrationStore)?
    private let scheduleDraftExtractor: (any ScheduleDraftExtractor)?
    private let commuterStore: (any CommuterStore)?
    private let travelPlanningStore: (any TravelPlanningStore)?
    private let dayBriefStore: (any DayBriefStore)?
    private let shoppingStore: (any ShoppingStore)?
    private let dataIsSynced: Bool

    init() {
        #if DEBUG
        if ProcessInfo.processInfo.environment["RALLYROO_UI_TEST_RESET_STORAGE"] == "1" {
            AppStorage.resetForUITesting()
        }
        #endif

        let configuration: AppConfiguration
        do {
            configuration = try AppConfiguration.load()
        } catch {
            fatalError("Invalid Rallyroo configuration: \(error)")
        }

        dataIsSynced = configuration.dataMode == .remote
        switch configuration.dataMode {
        case .local:
            AppStorage.resetForUnifiedFamilyMembersIfNeeded()
            authentication = LocalAuthentication()
            #if DEBUG
            let testsOccurrenceLifecycle = ProcessInfo.processInfo.environment[
                "RALLYROO_UI_TEST_OCCURRENCE_LIFECYCLE"
            ] == "1"
            eventStore = testsOccurrenceLifecycle
                ? OccurrenceLifecycleUITestEventStore()
                : LocalEventStore(storageURL: AppStorage.eventsURL)
            #else
            eventStore = LocalEventStore(storageURL: AppStorage.eventsURL)
            #endif
            reminderStore = LocalReminderStore(storageURL: AppStorage.remindersURL)
            let localAlertScheduler = LocalReminderAlertScheduler()
            reminderAlertScheduler = localAlertScheduler
            eventAlertScheduler = localAlertScheduler
            memberStore = LocalFamilyMemberStore(storageURL: AppStorage.membersURL)
            locationSearch = EmptyLocationSearch()
            invitationStore = nil
            #if DEBUG
            occurrenceLifecycleStore = testsOccurrenceLifecycle ? OccurrenceLifecycleUITestStore() : nil
            #else
            occurrenceLifecycleStore = nil
            #endif
            calendarSourceStore = nil
            changeMonitor = nil
            deviceRegistrationStore = nil
            scheduleDraftExtractor = nil
            commuterStore = nil
            travelPlanningStore = nil
            #if DEBUG
            let usesDayBriefUITest = ProcessInfo.processInfo.environment["RALLYROO_UI_TEST_DAY_BRIEF"] == "1"
            dayBriefStore = usesDayBriefUITest ? DayBriefUITestStore() : nil
            shoppingStore = ProcessInfo.processInfo.environment["RALLYROO_UI_TEST_SHOPPING"] == "1"
                ? ShoppingUITestStore()
                : nil
            inboxStore = usesDayBriefUITest
                ? DayBriefUITestInboxStore()
                : LocalNotificationInboxStore(storageURL: AppStorage.localInboxURL)
            #else
            dayBriefStore = nil
            shoppingStore = nil
            inboxStore = LocalNotificationInboxStore(storageURL: AppStorage.localInboxURL)
            #endif
        case .remote:
            guard let baseURL = configuration.remoteBaseURL else {
                fatalError("Remote mode requires a base URL")
            }
            let transport = URLSessionHTTPTransport()
            let remoteAuthentication = RemoteAuthentication(baseURL: baseURL, transport: transport)
            let authenticatedTransport = AuthenticatedHTTPTransport(
                transport: transport,
                authentication: remoteAuthentication
            )
            authentication = remoteAuthentication
            eventStore = RemoteEventStore(
                baseURL: baseURL,
                transport: authenticatedTransport,
                cacheURL: AppStorage.remoteEventsCacheURL,
                accountID: { try await remoteAuthentication.currentSession()?.accountID }
            )
            reminderStore = RemoteReminderStore(baseURL: baseURL, transport: authenticatedTransport)
            // Hosted alerts notify participants and assignees through APNs. Scheduling
            // a second local alert would duplicate pushes and survive remote edits.
            reminderAlertScheduler = nil
            eventAlertScheduler = nil
            memberStore = RemoteFamilyMemberStore(baseURL: baseURL, transport: authenticatedTransport)
            occurrenceLifecycleStore = RemoteOccurrenceLifecycleStore(
                baseURL: baseURL,
                transport: authenticatedTransport,
                authToken: { try await remoteAuthentication.currentSession()?.accessToken }
              )
            locationSearch = RemoteLocationSearch(baseURL: baseURL, transport: authenticatedTransport)
            invitationStore = RemoteFamilyInvitationStore(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            calendarSourceStore = RemoteCalendarSourceStore(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            changeMonitor = RemoteFamilyChangeMonitor(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            deviceRegistrationStore = RemoteDeviceRegistrationStore(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            scheduleDraftExtractor = RemoteScheduleDraftExtractor(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            commuterStore = RemoteCommuterStore(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            travelPlanningStore = RemoteTravelPlanningStore(
                baseURL: baseURL,
                transport: authenticatedTransport
              )
            dayBriefStore = RemoteDayBriefStore(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            shoppingStore = RemoteShoppingStore(
                baseURL: baseURL,
                transport: authenticatedTransport
            )

            inboxStore = RemoteNotificationInboxStore(
                baseURL: baseURL,
                transport: authenticatedTransport,
                cacheURL: AppStorage.remoteNotificationsCacheURL,
                accountID: { try await remoteAuthentication.currentSession()?.accountID }
            )
        }
        notificationStore = LocalConflictNotificationStore(storageURL: AppStorage.notificationsURL)
    }

    var body: some Scene {
        WindowGroup {
            SessionGateView(
                authentication: authentication,
                onSessionEnded: { try? await eventStore.clearCache() }
            ) { session, signOut, deleteAccount in
                TabView(selection: $selectedTab) {
                    WeeklyScheduleView(
                        eventStore: eventStore,
                        memberStore: memberStore,
                        notificationStore: notificationStore,
                        allowsEditing: session.role == .parent,
                        locationSearch: locationSearch,
                        alertScheduler: eventAlertScheduler,
                        scheduleDraftExtractor: scheduleDraftExtractor,
                        reminderStore: reminderStore,
                        currentMemberID: session.accountID,
                        calendarSourceStore: session.role == .parent ? calendarSourceStore : nil,
                        commuterStore: commuterStore,
                        travelPlanningStore: travelPlanningStore,
                        occurrenceLifecycleStore: occurrenceLifecycleStore,
                        incomingSharedCaptureImageData: $sharedCaptureInbox.pendingImageData
                    )
                    .tabItem { Label("Schedule", systemImage: "calendar") }
                    .tag(AppTab.schedule)
                    RemindersView(
                        store: reminderStore,
                        memberStore: memberStore,
                        alertScheduler: reminderAlertScheduler,
                        session: session
                    )
                    .tabItem { Label("Reminders", systemImage: "checklist") }
                    .tag(AppTab.reminders)
                    if session.role == .parent {
                        FamilyMembersView(
                            memberStore: memberStore,
                            eventStore: eventStore,
                            reminderStore: reminderStore,
                            locationSearch: locationSearch,
                            invitationStore: invitationStore
                        )
                            .tabItem { Label("Family", systemImage: "person.2") }
                            .tag(AppTab.family)
                    }
                    NotificationsView(
                        inboxStore: inboxStore,
                        conflictStore: notificationStore,
                        dayBriefStore: session.role == .parent ? dayBriefStore : nil,
                        onUnreadCountChanged: { unreadAlertCount = $0 }
                    )
                    .tabItem { Label("Alerts", systemImage: "bell") }
                    .badge(unreadAlertCount)
                    .tag(AppTab.alerts)
                    SettingsView(
                        dataIsSynced: dataIsSynced,
                        currentMemberID: session.accountID,
                        calendarSourceStore: session.role == .parent ? calendarSourceStore : nil,
                        memberStore: session.role == .parent ? memberStore : nil,
                        commuterStore: commuterStore,
                        travelPlanningStore: travelPlanningStore,
                        dayBriefStore: session.role == .parent ? dayBriefStore : nil,
                        shoppingStore: shoppingStore,
                        canManageShoppingCatalog: session.role == .parent,
                        onSignOut: signOut,
                        onDeleteAccount: deleteAccount
                    )
                    .tabItem { Label("Settings", systemImage: "gearshape") }
                    .tag(AppTab.settings)
                }
                .onReceive(NotificationCenter.default.publisher(for: .openNotificationDestination)) { note in
                    guard let destination = note.object as? InboxNotificationDestination else { return }
                    switch destination.kind {
                    case .event:
                     do {
                      selectedTab = .schedule
                      if let occ = destination.occurrenceStart {
                        NotificationCenter.default.post(name: .focusOccurrenceStart, object: occ)
                        }
                       }
                    case .reminder: selectedTab = .reminders
                    case .commuteSubscription, .settings: selectedTab = .settings
                    case .dayBrief: selectedTab = .alerts
                    }
                }
            // No global .tint: destructive buttons stay native-red, each
            // NavigationStack applies its own screen-specific accent colour.
                .task {
                    sharedCaptureInbox.receiveNext()
                    await monitorFamilyChanges()
                }
                .task {
                    unreadAlertCount = ((try? await inboxStore.notifications()) ?? [])
                        .filter { $0.readAt == nil }.count
                }
                .task { await synchronizeCalendars(for: session.role) }
                .task { await requestPushNotifications() }
                .onReceive(NotificationCenter.default.publisher(for: .didDeliverLocalInboxNotification)) { notification in
                    guard let item = notification.object as? InboxNotification else { return }
                    Task {
                        try? await inboxStore.ingest(item)
                        unreadAlertCount = ((try? await inboxStore.notifications()) ?? [])
                            .filter { $0.readAt == nil }.count
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .notificationInboxDidChange)) { _ in
                    Task {
                        unreadAlertCount = ((try? await inboxStore.notifications()) ?? [])
                            .filter { $0.readAt == nil }.count
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .didRegisterDeviceToken)) { notification in
                    guard let token = notification.object as? String else { return }
                    Task { try? await deviceRegistrationStore?.register(token: token) }
                }
                .onChange(of: scenePhase) { phase in
                    if phase == .active {
                        sharedCaptureInbox.receiveNext()
                        NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
                    }
                }
            }
        }
    }

    @MainActor
    private func requestPushNotifications() async {
        // Always request local notification permission—reminders need it in both modes.
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
          )) == true
        if granted {
            if deviceRegistrationStore != nil {
                // Remote mode: also register for APNs
                UIApplication.shared.registerForRemoteNotifications()
                }
             }
        }
    private func synchronizeCalendars(for role: AccountRole) async {
        guard role == .parent, let calendarSourceStore else { return }
        while !Task.isCancelled {
            if let sources = try? await calendarSourceStore.sources() {
                let staleBefore = Date.now.addingTimeInterval(-15 * 60)
                let stale = sources.filter { source in
                    source.lastSyncedAt.map { $0 < staleBefore } ?? true
                }
                var changed = false
                for source in stale {
                    if (try? await calendarSourceStore.synchronize(source)) != nil {
                        changed = true
                    }
                }
                if changed {
                    await MainActor.run {
                        NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
                    }
                }
            }
            try? await Task.sleep(for: .seconds(15 * 60))
        }
    }

    private func monitorFamilyChanges() async {
        guard let changeMonitor else { return }
        _ = try? await changeMonitor.hasChanges()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled else { return }
            if (try? await changeMonitor.hasChanges()) == true {
                await MainActor.run {
                    NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
                }
            }
        }
    }
}

extension Notification.Name {
    static let familyDataDidChange = Notification.Name("familyDataDidChange")
    static let scheduleUpdateNotice = Notification.Name("scheduleUpdateNotice")
    static let focusOccurrenceStart = Notification.Name("focusOccurrenceStart")
}

enum AppStorage {
    static var eventsURL: URL {
        storageDirectory
            .appendingPathComponent("events")
            .appendingPathExtension("json")
    }

    static var remoteEventsCacheURL: URL {
        storageDirectory.appendingPathComponent("remote-events-cache").appendingPathExtension("json")
    }

    static var localInboxURL: URL {
        storageDirectory.appendingPathComponent("notification-inbox").appendingPathExtension("json")
    }

    static var remoteNotificationsCacheURL: URL {
        storageDirectory.appendingPathComponent("remote-notifications-cache").appendingPathExtension("json")
    }

    static var notificationsURL: URL {
        storageDirectory.appendingPathComponent("conflicts").appendingPathExtension("json")
    }

    static var remindersURL: URL {
        storageDirectory.appendingPathComponent("reminders").appendingPathExtension("json")
    }

    static var membersURL: URL {
        storageDirectory
            .appendingPathComponent("members")
            .appendingPathExtension("json")
    }

    static func resetForUnifiedFamilyMembersIfNeeded() {
        let resetKey = "didResetForStringMemberIDs"
        guard !UserDefaults.standard.bool(forKey: resetKey) else { return }
        try? FileManager.default.removeItem(at: storageDirectory)
        UserDefaults.standard.set(true, forKey: resetKey)
    }

    #if DEBUG
    static func resetForUITesting() {
        guard FileManager.default.fileExists(atPath: storageDirectory.path) else {
            return
        }

        do {
            try FileManager.default.removeItem(at: storageDirectory)
        } catch {
            fatalError("Unable to reset UI test storage: \(error)")
        }
    }
    #endif

    private static var storageDirectory: URL {
        FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        .appending(path: "FamilyActivityCoordinator")
    }
}

#if DEBUG
private actor DayBriefUITestStore: DayBriefStore {
    private var savedPreferences: DayBriefPreferences?

    func preferences() async throws -> DayBriefPreferences? {
        savedPreferences
    }

    func savePreferences(_ preferences: DayBriefPreferences) async throws -> DayBriefPreferences {
        savedPreferences = preferences
        return preferences
    }

    func brief(localDate: String) async throws -> DayBrief? {
        guard localDate == "2026-09-21" else { return nil }
        return DayBrief(
            localDate: localDate,
            timeZone: "America/Los_Angeles",
            facts: DayBriefFacts(
                events: [
                    DayBriefEventFact(
                        id: "school-dropoff",
                        title: "School drop-off",
                        scheduledAt: Date(timeIntervalSince1970: 1_790_003_700),
                        startTime: Date(timeIntervalSince1970: 1_790_003_700),
                        endTime: Date(timeIntervalSince1970: 1_790_005_500),
                        location: "Lincoln Elementary",
                        roles: [.driver]
                    )
                ],
                reminders: []
            ),
            title: "Sunday at a glance",
            body: "You drive to school drop-off this morning."
        )
    }
}

private actor DayBriefUITestInboxStore: NotificationInboxStore {
    private var records = [
        InboxNotification(
            id: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!,
            kind: .dayBrief,
            title: "Your Day Brief",
            body: "You have one driving responsibility.",
            destination: .init(kind: .dayBrief, id: "2026-09-21"),
            occurredAt: Date(timeIntervalSince1970: 1_790_000_000),
            readAt: nil
        )
    ]

    func notifications() async throws -> [InboxNotification] { records }

    func markRead(id: UUID) async throws {
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        let item = records[index]
        records[index] = InboxNotification(
            id: item.id,
            kind: item.kind,
            title: item.title,
            body: item.body,
            destination: item.destination,
            occurredAt: item.occurredAt,
            readAt: .now
        )
    }

    func delete(id: UUID) async throws {
        records.removeAll { $0.id == id }
    }

    func ingest(_ notification: InboxNotification) async throws {
        records.append(notification)
    }
}
#endif
