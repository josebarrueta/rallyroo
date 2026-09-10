import SwiftUI
import UIKit
@preconcurrency import UserNotifications
import FamilyCore

private enum AppTab: Hashable { case schedule, reminders, family, alerts, settings }

@main
struct FamilyActivityCoordinatorApp: App {
    @UIApplicationDelegateAdaptor(PushNotificationDelegate.self) private var pushNotificationDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .schedule
    @State private var unreadAlertCount = 0
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
    private let calendarSourceStore: (any CalendarSourceStore)?
    private let changeMonitor: (any FamilyChangeMonitor)?
    private let deviceRegistrationStore: (any DeviceRegistrationStore)?
    private let scheduleDraftExtractor: (any ScheduleDraftExtractor)?
    private let commuterStore: (any CommuterStore)?
    private let dataIsSynced: Bool

    init() {
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
            eventStore = LocalEventStore(storageURL: AppStorage.eventsURL)
            reminderStore = LocalReminderStore(storageURL: AppStorage.remindersURL)
            let localAlertScheduler = LocalReminderAlertScheduler()
            reminderAlertScheduler = localAlertScheduler
            eventAlertScheduler = localAlertScheduler
            memberStore = LocalFamilyMemberStore(storageURL: AppStorage.membersURL)
            locationSearch = EmptyLocationSearch()
            invitationStore = nil
            calendarSourceStore = nil
            changeMonitor = nil
            deviceRegistrationStore = nil
            scheduleDraftExtractor = nil
            commuterStore = nil
            inboxStore = LocalNotificationInboxStore(storageURL: AppStorage.localInboxURL)
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
                        commuterStore: session.role == .parent ? commuterStore : nil
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
                        commuterStore: session.role == .parent ? commuterStore : nil,
                        onSignOut: signOut,
                        onDeleteAccount: deleteAccount
                    )
                    .tabItem { Label("Settings", systemImage: "gearshape") }
                    .tag(AppTab.settings)
                }
                .onReceive(NotificationCenter.default.publisher(for: .openNotificationDestination)) { note in
                    guard let destination = note.object as? InboxNotificationDestination else { return }
                    switch destination.kind {
                    case .event: selectedTab = .schedule
                    case .reminder: selectedTab = .reminders
                    case .commuteSubscription, .settings: selectedTab = .settings
                    }
                }
            // No global .tint: destructive buttons stay native-red, each
            // NavigationStack applies its own screen-specific accent colour.
                .task { await monitorFamilyChanges() }
                .task { await synchronizeCalendars(for: session.role) }
                .task { await requestPushNotifications() }
                .onReceive(NotificationCenter.default.publisher(for: .didDeliverLocalInboxNotification)) { notification in
                    guard let item = notification.object as? InboxNotification else { return }
                    Task { try? await inboxStore.ingest(item) }
                }
                .onReceive(NotificationCenter.default.publisher(for: .didRegisterDeviceToken)) { notification in
                    guard let token = notification.object as? String else { return }
                    Task { try? await deviceRegistrationStore?.register(token: token) }
                }
                .onChange(of: scenePhase) { phase in
                    if phase == .active {
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

    private static var storageDirectory: URL {
        FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        .appending(path: "FamilyActivityCoordinator")
    }
}
