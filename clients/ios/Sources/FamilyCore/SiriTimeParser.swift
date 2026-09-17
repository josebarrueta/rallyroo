import Foundation

/// Parses simple natural-language time and day strings for Siri event creation.
///
/// The parser deliberately handles a small, predictable set of inputs
/// (weekday names, named periods like "morning"/"evening", and 12/24-hour
/// clock strings). Anything outside that set returns `nil` so the intent can
/// fall back to a sensible default instead of creating a badly-timed event.
public enum SiriTimeParser {

     /// Parses "monday", "tuesday", … "sunday", "today", "tomorrow".
     /// Returns a `Date` at the start of the given weekday in local time.
     /// Returns `nil` for unrecognized input.
    public static func parseDay(from string: String) -> Date? {
        let now = Calendar.current.startOfDay(for: .now)
        let nowWeekday = Calendar.current.component(.weekday, from: now)
        let targetWeekday = targetWeekIndex(from: string)
        guard let targetWeekday else { return nil }

        let offset = (targetWeekday - nowWeekday + 7) % 7
         // For "today" we want today's start; for other days we want the next
        // occurrence of that weekday (7 days ahead if it's been that day already
        // this week relative to now).
        let resolvedNow = offset == 0 ? now : now.addingTimeInterval(TimeInterval(offset * 86400))
        return resolvedNow
         }

      /// Parses "5pm", "3:30pm", "morning", "noon", "evening", "night", "18".
     /// Returns a `Date` with the hour set on the same day as `relativeTo`.
     /// Returns `nil` for unrecognized input.
    public static func parseTime(from string: String, relativeTo date: Date) -> Date? {
        guard let hour = parseHour(from: string) else { return nil }

        var components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour],
          from: date
          )
        components.hour = hour
        components.minute = 0
        return Calendar.current.date(from: components)
        }

     // MARK: Private helpers

      private static func targetWeekIndex(from string: String) -> Int? {
         // Calendar weekday: 1=Sunday, 2=Monday, …, 7=Saturday
        switch string.lowercased() {
        case "today":
            return Calendar.current.component(.weekday, from: .now)
        case "tomorrow":
            let wd = Calendar.current.component(.weekday, from: .now)
            return wd == 7 ? 1 : wd + 1
        case "sunday":      return 1
        case "monday":      return 2
        case "tuesday",
             "tues":        return 3
        case "wednesday",
             "weds",
             "wed":         return 4
        case "thursday",
             "thurs",
             "thu":         return 5
        case "friday",
             "fri":         return 6
        case "saturday",
             "sat":         return 7
        default:
            return nil
         }
       }

       /// Parses an hour value from a free-form time string.
     ///
     /// - "5pm" / "5 pm"  → 17
     /// - "5am"           → 5
     /// - "12am"          → 0
     /// - "12pm"          → 12
     /// - "18"/"18:30"    → 18
     /// - "morning"       → 9
     /// - "noon"/"midday" → 12
     /// - "afternoon"     → 15
     /// - "evening"       → 19
     /// - "night"         → 22
       /// Returns `nil` for unrecognized input.
    public static func parseHour(from string: String) -> Int? {
        let lowered = string.lowercased()

        switch lowered {
        case "morning":
            return 9
        case "noon", "midday":
            return 12
        case "afternoon":
            return 15
        case "evening":
            return 19
        case "night":
            return 22
        default:
            break
         }

            // Extract the leading numeric portion from the string.
            // e.g. "5pm" -> 5, "12am" -> 12, "18:00" -> 18
        let digitString = String(lowered.prefix(while: { $0.isNumber }))
        guard let parsedHour = Int(digitString) else { return nil }


        var result = parsedHour
        if lowered.contains("pm") && parsedHour < 12 {
            result += 12
            }
        if lowered.contains("am") && parsedHour == 12 {
            result = 0
            }

        guard (0...23).contains(result) else { return nil }
        return result
        }
}
