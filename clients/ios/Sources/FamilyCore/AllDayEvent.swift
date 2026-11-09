import Foundation

/// Date-only Gregorian bounds. The exclusive end and stable anchor time zone are
/// persisted; display projection never rewrites the stored scheduling instants.
public struct EventAllDay: Codable, Equatable, Sendable {
    public let startDate: String
    public let endDate: String
    public let timeZone: String

    public enum ValidationError: Error, Equatable, Sendable { case invalidDates }
    private enum CodingKeys: String, CodingKey { case startDate, endDate, timeZone }

    public init(startDate: String, endDate: String, timeZone: String) throws {
        guard let zone = TimeZone(identifier: timeZone), startDate < endDate,
              let start = Self.date(startDate, in: zone, strict: true),
              let end = Self.date(endDate, in: zone, strict: true), end > start else {
            throw ValidationError.invalidDates
        }
        self.startDate = startDate
        self.endDate = endDate
        self.timeZone = timeZone
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(startDate: container.decode(String.self, forKey: .startDate),
            endDate: container.decode(String.self, forKey: .endDate),
            timeZone: container.decode(String.self, forKey: .timeZone))
    }

    public func dateInterval(in displayTimeZone: TimeZone? = nil) -> DateInterval {
        let zone = displayTimeZone ?? TimeZone(identifier: timeZone)!
        // A viewer can travel to a zone that skipped one of these calendar dates.
        // Foundation projects it to the next real day; never mutate the stored dates.
        let start = Self.date(startDate, in: zone, strict: false)!
        let end = Self.date(endDate, in: zone, strict: false)!
        return DateInterval(start: start, end: max(start, end))
    }

    public var inclusiveEndDate: String {
        let utc = TimeZone(secondsFromGMT: 0)!
        let exclusiveEnd = Self.date(endDate, in: utc, strict: false)!
        return Self.dateString(for: exclusiveEnd.addingTimeInterval(-86400), in: utc)
    }

    public static func dateString(for date: Date, in timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    private static func date(_ text: String, in timeZone: TimeZone, strict: Bool) -> Date? {
        guard text.count == 10, text.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return nil }
        let parts = text.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, parts[0] > 0 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        guard let result = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return nil }
        let start = calendar.startOfDay(for: result)
        if strict && dateString(for: start, in: timeZone) != text { return nil }
        return start
    }
}

public extension FamilyEvent {
    func validateAllDay() throws {
        guard let allDay else { return }
        let range = allDay.dateInterval()
        guard recurrence == nil, recurrenceSeriesID == nil, range.start == startTime, range.end == endTime else {
            throw EventValidationError.invalidAllDayDates
        }
    }

    func displayInterval(calendar: Calendar = .autoupdatingCurrent) -> DateInterval {
        allDay?.dateInterval(in: calendar.timeZone) ?? DateInterval(start: startTime, end: endTime)
    }

    func occurs(on day: Date, calendar: Calendar = .autoupdatingCurrent) -> Bool {
        guard allDay != nil else { return calendar.isDate(startTime, inSameDayAs: day) }
        let range = displayInterval(calendar: calendar)
        let start = calendar.startOfDay(for: day)
        let end = calendar.date(byAdding: .day, value: 1, to: start)!
        return range.start < end && range.end > start
    }
}
