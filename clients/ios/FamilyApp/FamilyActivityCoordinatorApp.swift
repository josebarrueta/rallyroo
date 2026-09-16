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
    private let travelPlanningStore: (any TravelPlanningStore)?
    private let sharedCaptureQueue: SharedScheduleCaptureQueue?
    private let dataIsSynced: Bool
    private let occurrenceLifecycleStore: (any OccurrenceLifecycleStore)?

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
            travelPlanningStore = nil
            occurrenceLifecycleStore = nil
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
            travelPlanningStore = RemoteTravelPlanningStore(
                baseURL: baseURL,
                transport: authenticatedTransport
             )
            occurrenceLifecycleStore = RemoteOccurrenceLifecycleStore(
                baseURL: baseURL,
                transport: authenticatedTransport,
                authToken: {
                    let session = try? await remoteAuthentication.currentSession()
                    return session?.accessToken
                 }
             )
            inboxStore = RemoteNotificationInboxStore(
                baseURL: baseURL,
                transport: authenticatedTransport,
                cacheURL: AppStorage.remoteNotificationsCacheURL,
                accountID: { try await remoteAuthentication.currentSession()?.accountID }
             )
         }
        notificationStore = LocalConflictNotificationStore(storageURL: AppStorage.notificationsURL)
        sharedCaptureQueue = try? SharedScheduleCaptureQueue.appGroup()
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
                        occurrenceLifecycleStore: occurrenceLifecycleStore
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
                    AlertsView(
                        notificationStore: notificationStore,
                        inboxStore: inboxStore,
                        familyMemberStore: memberStore
                     )
                     .tabItem { Label("Alerts", systemImage: "bell") }
                     .tag(AppTab.alerts)
                    SettingsView(
                        session: session,
                        dataIsSynced: dataIsSynced,
                        authentication: authentication,
                        deviceRegistrationStore: deviceRegistrationStore,
                        changeMonitor: changeMonitor,
                        travelPlanningStore: travelPlanningStore,
                        onSignOut: signOut,
                        onDeleteAccount: deleteAccount
                     )
                     .tabItem { Label("Settings", systemImage: "gear") }
                     .tag(AppTab.settings)
                 }
                .onChange(of: unreadAlertCount) { _, _ in
                    if #available(iOS 16, *) {
                         UIApplication.shared.applicationIconBadgeNumber = 0
                     } else {
                         UIApplication.shared.applicationIconBadgeNumber = 0
                     }
                }
             }
        }
        .onChange(of: scenePhase) { phase in
            switch phase {
            case .active:
                NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
                if let deviceRegistrationStore {
                    Task {
                        do {
                            _ = try await deviceRegistrationStore.register()
                        } catch {
                            // Non-fatal: the device will re-register on the next launch.
                        }
                     }
                }
            case .background:
                try? await eventStore.flushCache()
            case .inactive:
                break
            }
        }
     }
 }

