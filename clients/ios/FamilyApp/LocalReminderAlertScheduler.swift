import FamilyCore
import Foundation
@preconcurrency import UserNotifications

actor LocalReminderAlertScheduler: ReminderAlertScheduler, EventAlertScheduler {
     // UNUserNotificationCenter is a thread-safe singleton; nonisolated(unsafe) lets Swift 6
     // know it is safe to reference across the actor boundary without copying.
    nonisolated(unsafe) private let notificationCenter = UNUserNotificationCenter.current()

    func schedule(_ reminder: FamilyReminder) async throws {
        await cancel(reminder)
        guard reminder.status == .open, let leadTime = reminder.alertLeadTime else { return }

        // Check authorization status without prompting — the prompt is requested
        // at app startup via requestPushNotifications(). If the user has not
        // granted permission we do not schedule a local notification.
        let settings = await notificationCenter.notificationSettings()
        guard settings.authorizationStatus == .authorized ||
              settings.authorizationStatus == .provisional ||
              settings.authorizationStatus == .ephemeral else { return }

        let fireAt = reminder.dueAt.addingTimeInterval(-Double(leadTime.rawValue * 60))
        guard fireAt > .now else { return }

        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = "Reminder due. Open Rallyroo to review."
        content.sound = .default
        content.userInfo = [
            "reminderID": reminder.id.uuidString,
            "notificationID": UUID().uuidString,
            "notificationKind": "reminder_occurrence",
        ]
        let interval = max(1, fireAt.timeIntervalSinceNow)
        try await notificationCenter.add(UNNotificationRequest(
            identifier: identifier(for: reminder),
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
         ))
     }

    func cancel(_ reminder: FamilyReminder) async {
        notificationCenter.removePendingNotificationRequests(withIdentifiers: [identifier(for: reminder)])
     }

    func schedule(_ event: FamilyEvent) async throws {
        await cancel(event)
        guard let leadTime = event.alertLeadTime else { return }
        let settings = await notificationCenter.notificationSettings()
        guard settings.authorizationStatus == .authorized ||
              settings.authorizationStatus == .provisional ||
              settings.authorizationStatus == .ephemeral else { return }

        let rangeEnd = (event.recurrence?.endDate ?? event.startTime).addingTimeInterval(1)
        guard rangeEnd > .now else { return }
        let occurrences = EventOccurrenceExpander.occurrences(
            of: [event],
            in: DateInterval(start: .now, end: rangeEnd)
        ).prefix(50)
        for occurrence in occurrences {
            let fireAt = occurrence.event.startTime
                .addingTimeInterval(-Double(leadTime.rawValue * 60))
            guard fireAt > .now else { continue }
            let content = UNMutableNotificationContent()
            content.title = event.title
            content.body = eventAlertBody(leadTime)
            content.sound = .default
            content.userInfo = [
                "eventID": event.id.uuidString,
                "occurrenceStart": occurrence.event.startTime.ISO8601Format(),
                "notificationID": UUID().uuidString,
                "notificationKind": "event_occurrence",
            ]
            try await notificationCenter.add(UNNotificationRequest(
                identifier: identifier(for: event, occurrenceStart: occurrence.event.startTime),
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(
                    timeInterval: max(1, fireAt.timeIntervalSinceNow),
                    repeats: false
                )
            ))
        }
    }

    func cancel(_ event: FamilyEvent) async {
        let prefix = eventIdentifierPrefix(event)
        let identifiers = await notificationCenter.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(prefix) }
        notificationCenter.removePendingNotificationRequests(withIdentifiers: identifiers)
    }

    private func eventAlertBody(_ leadTime: EventAlertLeadTime) -> String {
        switch leadTime {
        case .atStart: "Event starting now."
        case .fiveMinutes: "Event starts in 5 minutes."
        case .fifteenMinutes: "Event starts in 15 minutes."
        case .oneHour: "Event starts in 1 hour."
        case .oneDay: "Event starts in 1 day."
        }
    }

    private func identifier(for reminder: FamilyReminder) -> String {
        "rallyroo.reminder.\(reminder.id.uuidString.lowercased())"
    }

    private func eventIdentifierPrefix(_ event: FamilyEvent) -> String {
        "rallyroo.event.\(event.id.uuidString.lowercased())."
    }

    private func identifier(for event: FamilyEvent, occurrenceStart: Date) -> String {
        eventIdentifierPrefix(event) + String(Int(occurrenceStart.timeIntervalSince1970))
    }
}
