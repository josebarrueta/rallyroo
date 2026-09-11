import FamilyCore
import Foundation
@preconcurrency import UserNotifications

actor LocalReminderAlertScheduler: ReminderAlertScheduler, EventAlertScheduler {
    nonisolated(unsafe) private let notificationCenter = UNUserNotificationCenter.current()

    // MARK: - Reminder

    func schedule(_ reminder: FamilyReminder) async throws {
        await cancel(reminder)
        guard reminder.status == .open, let leadTime = reminder.alertLeadTime else { return }

        let settings = await notificationCenter.notificationSettings()
        guard settings.authorizationStatus == .authorized ||
              settings.authorizationStatus == .provisional ||
              settings.authorizationStatus == .ephemeral else { return }

         // Recurring: schedule an alert for each upcoming occurrence.
         // One-time (recurrence == nil): single alert.
        if reminder.hasRecurrence, let recurrence = reminder.recurrence {
            let range = DateInterval(start: .now, end: recurrence.endDate.addingTimeInterval(60))
            let occurrences = ReminderOccurrenceExpander.occurrences(of: [reminder], in: range).prefix(30)
            for occ in occurrences {
                let fireAt = occ.occurrenceDueAt.addingTimeInterval(-Double(leadTime.rawValue * 60))
                guard fireAt > .now else { continue }
                try await scheduleOccurrence(for: reminder, at: occ.occurrenceDueAt, leadTime: leadTime)
             }
        } else {
            let fireAt = reminder.dueAt.addingTimeInterval(-Double(leadTime.rawValue * 60))
            guard fireAt > .now else { return }
            try await scheduleOccurrence(for: reminder, at: reminder.dueAt, leadTime: leadTime)
        }
     }

    func cancel(_ reminder: FamilyReminder) async {
        if reminder.hasRecurrence {
               // Cancel all pending occurrence identifiers for this series.
            let prefix = "rallyroo.reminder." + reminder.id.uuidString.lowercased() + "."
            let pending = await notificationCenter.pendingNotificationRequests()
                 .map(\.identifier)
                 .filter { $0.hasPrefix(prefix) }
            notificationCenter.removePendingNotificationRequests(withIdentifiers: pending)
         } else {
            notificationCenter.removePendingNotificationRequests(
                withIdentifiers: [occurrenceIdentifier(for: reminder, dueAt: reminder.dueAt)]
             )
        }
     }

    private func scheduleOccurrence(
        for reminder: FamilyReminder,
        at dueAt: Date,
        leadTime: ReminderAlertLeadTime
     ) async throws {
        let content = UNMutableNotificationContent()
        content.title = reminder.title
        content.body = "Reminder due. Open Rallyroo to review."
        content.sound = .default
        content.userInfo = [
            "reminderID": reminder.id.uuidString.lowercased(),
            "occurrenceDue": dueAt.ISO8601Format(),
            "notificationID": UUID().uuidString,
            "notificationKind": "reminder_occurrence",
        ]
        let interval = max(
            1,
            (dueAt.addingTimeInterval(-Double(leadTime.rawValue * 60))).timeIntervalSinceNow
        )
        try await notificationCenter.add(
            UNNotificationRequest(
                identifier: occurrenceIdentifier(for: reminder, dueAt: dueAt),
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            )
        )
    }

    // MARK: - Event

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
            try await notificationCenter.add(
                UNNotificationRequest(
                    identifier: identifier(for: event, occurrenceStart: occurrence.event.startTime),
                    content: content,
                    trigger: UNTimeIntervalNotificationTrigger(
                        timeInterval: max(1, fireAt.timeIntervalSinceNow),
                        repeats: false
                    )
                )
            )
        }
     }

    func cancel(_ event: FamilyEvent) async {
        let prefix = eventIdentifierPrefix(event)
        let identifiers = await notificationCenter.pendingNotificationRequests()
            .map(\.identifier)
            .filter { $0.hasPrefix(prefix) }
        notificationCenter.removePendingNotificationRequests(withIdentifiers: identifiers)
     }

    // MARK: - Identifiers

    private func occurrenceIdentifier(for reminder: FamilyReminder, dueAt: Date) -> String {
        "rallyroo.reminder.\(reminder.id.uuidString.lowercased()).\(Int(dueAt.timeIntervalSince1970))"
     }

    private func identifier(for reminder: FamilyReminder) -> String {
        occurrenceIdentifier(for: reminder, dueAt: reminder.dueAt)
     }

    private func eventIdentifierPrefix(_ event: FamilyEvent) -> String {
        "rallyroo.event.\(event.id.uuidString.lowercased())."
     }

    private func identifier(for event: FamilyEvent, occurrenceStart: Date) -> String {
        eventIdentifierPrefix(event) + String(Int(occurrenceStart.timeIntervalSince1970))
     }

    // MARK: - Alert Body

    private func eventAlertBody(_ leadTime: EventAlertLeadTime) -> String {
        switch leadTime {
        case .atStart: "Event starting now."
        case .fiveMinutes: "Event starts in 5 minutes."
        case .fifteenMinutes: "Event starts in 15 minutes."
        case .thirtyMinutes: "Event starts in 30 minutes."
        case .fortyFiveMinutes: "Event starts in 45 minutes."
        case .oneHour: "Event starts in 1 hour."
        case .oneDay: "Event starts in 1 day."
         }
     }
}
