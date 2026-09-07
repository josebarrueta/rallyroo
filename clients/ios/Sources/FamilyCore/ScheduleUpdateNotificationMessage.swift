public enum ScheduleUpdateNotificationMessage {
    public static func make(for outcome: ScheduleUpdateNotificationOutcome) -> String? {
        switch outcome {
        case .queuedForRetry:
            return make(queuedCount: 1, noRecipientCount: 0)
        case .noRecipients:
            return make(queuedCount: 0, noRecipientCount: 1)
        case .sent, .notRequested:
            return nil
        }
    }

    public static func make(queuedCount: Int, noRecipientCount: Int) -> String? {
        var messages: [String] = []
        if queuedCount > 0 {
            messages.append(queuedCount == 1
                ? "notification queued for retry."
                : "\(queuedCount) notifications queued for retry.")
        }
        if noRecipientCount > 0 {
            messages.append(noRecipientCount == 1
                ? "no participant devices are registered for one Event."
                : "some Events have no registered participant devices.")
        }
        guard !messages.isEmpty else { return nil }
        let detail = messages.joined(separator: " ")
        return "Saved; " + detail.prefix(1).uppercased() + String(detail.dropFirst())
    }
}
