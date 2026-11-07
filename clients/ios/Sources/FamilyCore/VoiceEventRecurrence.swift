import Foundation

/// Converts Siri's structured repeat schedule into the recurrence model we persist.
@available(iOS 18.2, macOS 15.2, *)
public enum VoiceEventRecurrence {
    public enum ConversionError: Error {
        case unsupportedRule
    }

    public static func convert(
        _ rule: Calendar.RecurrenceRule?,
        startDate: Date
    ) throws -> EventRecurrence? {
        guard let rule else { return nil }
        guard rule.calendar.identifier == .gregorian,
              rule.months.isEmpty,
              rule.daysOfTheYear.isEmpty,
              rule.daysOfTheMonth.isEmpty,
              rule.weeks.isEmpty,
              rule.hours.isEmpty,
              rule.minutes.isEmpty,
              rule.seconds.isEmpty,
              rule.setPositions.isEmpty else {
            throw ConversionError.unsupportedRule
        }

        let recurrenceEnd: Date
        if let date = rule.end.date {
            recurrenceEnd = date
        } else if let count = rule.end.occurrences {
            var last = startDate
            for (index, date) in rule.recurrences(of: startDate).enumerated() {
                if index >= count { break }
                last = date
            }
            recurrenceEnd = last
        } else {
            recurrenceEnd = rule.calendar.date(byAdding: .month, value: 6, to: startDate)!
        }

        switch rule.frequency {
        case .daily:
            guard rule.weekdays.isEmpty else { throw ConversionError.unsupportedRule }
            return EventRecurrence(
                frequency: .daily,
                interval: rule.interval,
                endDate: recurrenceEnd,
                timeZone: rule.calendar.timeZone.identifier
            )
        case .weekly:
            let weekdays = rule.weekdays.isEmpty
                ? [weekday(for: startDate, calendar: rule.calendar)]
                : try rule.weekdays.map { weekday in
                    guard case let .every(day) = weekday else { throw ConversionError.unsupportedRule }
                    return Self.weekday(day)
                }
            return EventRecurrence(
                frequency: .weekly,
                interval: rule.interval,
                weekdays: weekdays,
                endDate: recurrenceEnd,
                timeZone: rule.calendar.timeZone.identifier
            )
        case .monthly:
            guard rule.weekdays.isEmpty else { throw ConversionError.unsupportedRule }
            return EventRecurrence(
                frequency: .monthly,
                interval: rule.interval,
                endDate: recurrenceEnd,
                timeZone: rule.calendar.timeZone.identifier
            )
        default:
            throw ConversionError.unsupportedRule
        }
    }

    private static func weekday(for date: Date, calendar: Calendar) -> EventRecurrence.Weekday {
        let value = calendar.component(.weekday, from: date)
        return [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday][value - 1]
    }

    private static func weekday(_ weekday: Locale.Weekday) -> EventRecurrence.Weekday {
        switch weekday {
        case .sunday: .sunday
        case .monday: .monday
        case .tuesday: .tuesday
        case .wednesday: .wednesday
        case .thursday: .thursday
        case .friday: .friday
        case .saturday: .saturday
        @unknown default: .monday
        }
    }
}
