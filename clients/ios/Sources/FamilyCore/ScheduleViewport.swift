import Foundation

public enum ScheduleViewMode: String, CaseIterable, Identifiable, Sendable {
    case week = "Week"
    case month = "Month"

    public var id: Self { self }
}

/// Owns schedule navigation independently from rendering so changing a page always
/// produces a fresh, bounded occurrence-expansion interval.
public struct ScheduleViewport: Equatable, Sendable {
    public private(set) var mode: ScheduleViewMode
    public private(set) var anchorDate: Date
    public private(set) var selectedDate: Date

    private var calendar: Calendar

    public init(
        mode: ScheduleViewMode = .week,
        anchorDate: Date = .now,
        calendar: Calendar = .autoupdatingCurrent
    ) {
        self.mode = mode
        self.calendar = calendar
        let day = calendar.startOfDay(for: anchorDate)
        self.anchorDate = mode == .month
            ? calendar.dateInterval(of: .month, for: day)?.start ?? day
            : day
        self.selectedDate = day
    }

    public var visibleDates: [Date] {
        let interval = visibleInterval
        var dates: [Date] = []
        var date = interval.start
        while date < interval.end {
            dates.append(date)
            guard let next = calendar.date(byAdding: .day, value: 1, to: date) else { break }
            date = next
        }
        return dates
    }

    public var visibleInterval: DateInterval {
        switch mode {
        case .week:
            return DateInterval(
                start: anchorDate,
                end: calendar.date(byAdding: .day, value: 7, to: anchorDate) ?? anchorDate
            )
        case .month:
            guard let month = monthInterval,
                  let firstWeek = calendar.dateInterval(of: .weekOfYear, for: month.start),
                  let finalDay = calendar.date(byAdding: .second, value: -1, to: month.end),
                  let finalWeek = calendar.dateInterval(of: .weekOfYear, for: finalDay) else {
                return DateInterval(start: anchorDate, end: anchorDate)
            }
            return DateInterval(start: firstWeek.start, end: finalWeek.end)
        }
    }

    public var monthInterval: DateInterval? {
        guard mode == .month else { return nil }
        return calendar.dateInterval(of: .month, for: anchorDate)
    }

    public mutating func goToToday(_ today: Date = .now) {
        let day = calendar.startOfDay(for: today)
        selectedDate = day
        anchorDate = mode == .month
            ? calendar.dateInterval(of: .month, for: day)?.start ?? day
            : day
    }

    public mutating func move(by pageOffset: Int) {
        guard pageOffset != 0 else { return }
        switch mode {
        case .week:
            anchorDate = calendar.date(
                byAdding: .day,
                value: pageOffset * 7,
                to: anchorDate
            ) ?? anchorDate
            selectedDate = anchorDate
        case .month:
            let selectedDay = calendar.component(.day, from: selectedDate)
            guard let movedMonth = calendar.date(byAdding: .month, value: pageOffset, to: anchorDate),
                  let month = calendar.dateInterval(of: .month, for: movedMonth) else { return }
            anchorDate = month.start
            let availableDays = calendar.range(of: .day, in: .month, for: month.start)?.count ?? 1
            selectedDate = calendar.date(
                bySetting: .day,
                value: min(selectedDay, availableDays),
                of: month.start
            ) ?? month.start
        }
    }

    public mutating func select(_ date: Date) {
        selectedDate = calendar.startOfDay(for: date)
    }

    public mutating func setMode(_ mode: ScheduleViewMode) {
        guard self.mode != mode else { return }
        self.mode = mode
        anchorDate = mode == .month
            ? calendar.dateInterval(of: .month, for: selectedDate)?.start ?? selectedDate
            : selectedDate
    }
}
