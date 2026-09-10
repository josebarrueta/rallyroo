import UIKit
@preconcurrency import UserNotifications
import FamilyCore

final class PushNotificationDelegate: NSObject, UIApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(name: .didRegisterDeviceToken, object: token)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        postLocalInboxRecord(from: notification)
        NotificationCenter.default.post(name: .notificationInboxDidChange, object: nil)
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        postLocalInboxRecord(from: response.notification)
        NotificationCenter.default.post(name: .notificationInboxDidChange, object: nil)
        let data = response.notification.request.content.userInfo
        let destination: InboxNotificationDestination?
        if let rawKind = data["destinationKind"] as? String,
           let kind = InboxNotificationDestination.Kind(rawValue: rawKind),
           let id = data["destinationID"] as? String {
            destination = .init(kind: kind, id: id)
        } else if let id = data["eventID"] as? String {
            destination = .init(kind: .event, id: id)
        } else if let id = data["reminderID"] as? String {
            destination = .init(kind: .reminder, id: id)
        } else if let id = data["subscriptionID"] as? String {
            destination = .init(kind: .commuteSubscription, id: id)
        } else {
            destination = nil
        }
        if let destination {
            NotificationCenter.default.post(name: .openNotificationDestination, object: destination)
        }
    }

    private func postLocalInboxRecord(from notification: UNNotification) {
        let content = notification.request.content
        let data = content.userInfo
        guard let rawID = data["notificationID"] as? String,
              let id = UUID(uuidString: rawID),
              let rawKind = data["notificationKind"] as? String,
              let kind = InboxNotificationKind(rawValue: rawKind) else { return }
        let destination: InboxNotificationDestination?
        if let eventID = data["eventID"] as? String {
            destination = .init(kind: .event, id: eventID)
        } else if let reminderID = data["reminderID"] as? String {
            destination = .init(kind: .reminder, id: reminderID)
        } else {
            destination = nil
        }
        guard let destination else { return }
        NotificationCenter.default.post(
            name: .didDeliverLocalInboxNotification,
            object: InboxNotification(
                id: id, kind: kind, title: content.title, body: content.body,
                destination: destination, occurredAt: notification.date, readAt: nil
            )
        )
    }
}

extension Notification.Name {
    static let didRegisterDeviceToken = Notification.Name("didRegisterDeviceToken")
    static let openNotificationDestination = Notification.Name("openNotificationDestination")
    static let didDeliverLocalInboxNotification = Notification.Name("didDeliverLocalInboxNotification")
    static let notificationInboxDidChange = Notification.Name("notificationInboxDidChange")
}
