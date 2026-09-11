import Foundation

public enum EventEditScope: String, Codable, CaseIterable, Equatable, Sendable {
    case thisOccurrence
    case thisWeekdayAndFuture
    case allFuture
}

public enum RecurringEventEditError: Error, Equatable, Sendable {
    case sourceIsNotRecurring
    case occurrenceNotInSeries
    case weekdayScopeRequiresWeeklyRecurrence
}

public struct RecurringEventEdit: Equatable, Sendable {
    public let sourceEventID: UUID
    public let editedEvent: FamilyEvent
    public let scope: EventEditScope
    public let occurrenceStart: Date

    public init(
        sourceEventID: UUID,
        editedEvent: FamilyEvent,
        scope: EventEditScope,
        occurrenceStart: Date
    ) {
        self.sourceEventID = sourceEventID
        self.editedEvent = editedEvent
        self.scope = scope
        self.occurrenceStart = occurrenceStart
    }
}

public struct RecurringEventEditPlan: Equatable, Sendable {
    public let upserts: [FamilyEvent]
    public let deleteIDs: [UUID]
    public let affectedEvents: [FamilyEvent]
    public let affectedSourceEventIDs: [UUID]

    public init(
        upserts: [FamilyEvent],
        deleteIDs: [UUID] = [],
        affectedEvents: [FamilyEvent],
        affectedSourceEventIDs: [UUID] = []
    ) {
        self.upserts = upserts
        self.deleteIDs = deleteIDs
        self.affectedEvents = affectedEvents
        self.affectedSourceEventIDs = affectedSourceEventIDs
    }
}

public enum RecurringEventEditPlanner {
    static func mutationID(_ idempotencyKey: UUID, index: Int) -> UUID {
        var bytes = withUnsafeBytes(of: idempotencyKey.uuid) { Array($0) }
        let counter = UInt64(index + 1).bigEndian
        withUnsafeBytes(of: counter) { counterBytes in
            for offset in 0..<8 { bytes[8 + offset] ^= counterBytes[offset] }
        }
        bytes[6] = (bytes[6] & 0x0F) | 0x80
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }

    public static func planSeries(
        edit: RecurringEventEdit,
        seriesRows: [FamilyEvent],
        calendar: Calendar = .autoupdatingCurrent,
        makeID: () -> UUID = UUID.init
    ) throws -> RecurringEventEditPlan {
        guard let source = seriesRows.first(where: { $0.id == edit.sourceEventID }) else {
            throw RecurringEventEditError.occurrenceNotInSeries
        }
        if edit.scope == .thisOccurrence {
            if source.recurrence != nil {
                return try plan(
                    edited: edit.editedEvent,
                    source: source,
                    scope: edit.scope,
                    occurrenceStart: edit.occurrenceStart,
                    calendar: calendar,
                    makeID: makeID
                )
            }
            guard source.startTime == edit.occurrenceStart else {
                throw RecurringEventEditError.occurrenceNotInSeries
            }
            let affected = editedAt(
                edit.editedEvent,
                occurrenceStart: edit.occurrenceStart,
                source: source,
                calendar: calendar
            ).withoutRecurrence()
            return RecurringEventEditPlan(
                upserts: [affected],
                affectedEvents: [affected],
                affectedSourceEventIDs: [source.id]
            )
        }

        let affectedWeekday = weekday(for: edit.occurrenceStart, calendar: calendar)
        var upserts: [FamilyEvent] = []
        var affectedEvents: [FamilyEvent] = []
        var affectedSourceEventIDs: [UUID] = []
        for row in seriesRows {
            guard let recurrence = row.recurrence else {
                guard row.startTime >= edit.occurrenceStart else { continue }
                if edit.scope == .thisWeekdayAndFuture,
                   weekday(for: row.startTime, calendar: calendar) != affectedWeekday { continue }
                let affected = editedAt(
                    edit.editedEvent,
                    occurrenceStart: row.startTime,
                    source: row,
                    calendar: calendar
                ).withoutRecurrence()
                upserts.append(affected)
                affectedEvents.append(affected)
                affectedSourceEventIDs.append(row.id)
                continue
            }
            if edit.scope == .thisWeekdayAndFuture {
                guard recurrence.frequency == .weekly else { continue }
                let weekdays = recurrence.weekdays ?? [weekday(for: row.startTime, calendar: calendar)]
                guard weekdays.contains(affectedWeekday) else { continue }
            }
            let firstFuture = occurrenceStarts(of: row, calendar: calendar).first { start in
                start >= edit.occurrenceStart
                    && (edit.scope != .thisWeekdayAndFuture
                        || weekday(for: start, calendar: calendar) == affectedWeekday)
            }
            guard let firstFuture else { continue }
            let rowPlan = try plan(
                edited: editedAt(
                    edit.editedEvent,
                    occurrenceStart: firstFuture,
                    source: row,
                    calendar: calendar
                ),
                source: row,
                scope: edit.scope,
                occurrenceStart: firstFuture,
                calendar: calendar,
                makeID: makeID
            )
            upserts.append(contentsOf: rowPlan.upserts)
            affectedEvents.append(contentsOf: rowPlan.affectedEvents)
            affectedSourceEventIDs.append(contentsOf: rowPlan.affectedSourceEventIDs)
        }
        guard !upserts.isEmpty else { throw RecurringEventEditError.occurrenceNotInSeries }
        return RecurringEventEditPlan(
            upserts: upserts,
            affectedEvents: affectedEvents,
            affectedSourceEventIDs: affectedSourceEventIDs
        )
    }

    public static func plan(
        edited: FamilyEvent,
        source: FamilyEvent,
        scope: EventEditScope,
        occurrenceStart: Date,
        calendar: Calendar = .autoupdatingCurrent,
        makeID: () -> UUID = UUID.init
    ) throws -> RecurringEventEditPlan {
        guard let recurrence = source.recurrence else {
            throw RecurringEventEditError.sourceIsNotRecurring
        }
        guard occurrenceStarts(of: source, calendar: calendar).contains(occurrenceStart) else {
            throw RecurringEventEditError.occurrenceNotInSeries
        }

        var rows: [FamilyEvent] = []
        var sourceIDAssigned = false
        if occurrenceStart > source.startTime {
            var prefix = source
            prefix.recurrence = recurrence.with(endDate: occurrenceStart.addingTimeInterval(-0.001))
            rows.append(prefix)
            sourceIDAssigned = true
        }

        func nextID() -> UUID {
            if !sourceIDAssigned {
                sourceIDAssigned = true
                return source.id
            }
            return makeID()
        }

        switch scope {
        case .allFuture:
            var future = edited.copy(id: nextID())
            future.recurrence = recurrence
            rows.append(future)
            return RecurringEventEditPlan(
                upserts: rows,
                affectedEvents: [future],
                affectedSourceEventIDs: [source.id]
            )

        case .thisWeekdayAndFuture:
            guard recurrence.frequency == .weekly else {
                throw RecurringEventEditError.weekdayScopeRequiresWeeklyRecurrence
            }
            let affectedWeekday = weekday(for: occurrenceStart, calendar: calendar)
            let sourceWeekdays = recurrence.weekdays ?? [affectedWeekday]
            let otherWeekdays = sourceWeekdays.filter { $0 != affectedWeekday }

            if !otherWeekdays.isEmpty,
               let continuationStart = occurrenceStarts(of: source, calendar: calendar).first(where: {
                   $0 > occurrenceStart && otherWeekdays.contains(weekday(for: $0, calendar: calendar))
               }) {
                var unaffected = source.copy(id: nextID())
                unaffected.startTime = continuationStart
                unaffected.endTime = continuationStart.addingTimeInterval(source.duration)
                unaffected.recurrence = recurrence.with(weekdays: otherWeekdays)
                rows.append(unaffected)
            }

            var weekdayFuture = edited.copy(id: nextID())
            weekdayFuture.recurrence = recurrence.with(weekdays: [affectedWeekday])
            rows.append(weekdayFuture)
            return RecurringEventEditPlan(
                upserts: rows,
                affectedEvents: [weekdayFuture],
                affectedSourceEventIDs: [source.id]
            )

        case .thisOccurrence:
            var single = edited.copy(id: nextID())
            single.recurrence = nil
            rows.append(single)

            if let continuationStart = occurrenceStarts(of: source, calendar: calendar)
                .first(where: { $0 > occurrenceStart }) {
                var continuation = source.copy(id: nextID())
                continuation.startTime = continuationStart
                continuation.endTime = continuationStart.addingTimeInterval(source.duration)
                continuation.recurrence = recurrence
                rows.append(continuation)
            }
            return RecurringEventEditPlan(
                upserts: rows,
                affectedEvents: [single],
                affectedSourceEventIDs: [source.id]
            )
        }
    }

    private static func editedAt(
        _ edited: FamilyEvent,
        occurrenceStart: Date,
        source: FamilyEvent,
        calendar: Calendar
    ) -> FamilyEvent {
        let time = calendar.dateComponents([.hour, .minute, .second, .nanosecond], from: edited.startTime)
        var date = calendar.dateComponents([.year, .month, .day], from: occurrenceStart)
        date.hour = time.hour
        date.minute = time.minute
        date.second = time.second
        date.nanosecond = time.nanosecond
        let start = calendar.date(from: date) ?? occurrenceStart
        var result = edited.copy(id: source.id)
        result.startTime = start
        result.endTime = start.addingTimeInterval(edited.duration)
        result.recurrenceSeriesID = source.recurrenceSeriesID
        return result
    }

    private static func occurrenceStarts(of event: FamilyEvent, calendar: Calendar) -> [Date] {
        guard let recurrence = event.recurrence else { return [event.startTime] }
        let range = DateInterval(
            start: event.startTime.addingTimeInterval(-0.001),
            end: recurrence.endDate.addingTimeInterval(24 * 60 * 60)
        )
        return EventOccurrenceExpander.occurrences(of: [event], in: range, calendar: calendar)
            .map(\.event.startTime)
    }

    private static func weekday(for date: Date, calendar: Calendar) -> EventRecurrence.Weekday {
        let value = calendar.component(.weekday, from: date)
        return EventRecurrence.Weekday(rawValue: value == 1 ? 7 : value - 1)!
    }
}

private extension FamilyEvent {
    var duration: TimeInterval { endTime.timeIntervalSince(startTime) }

    func withoutRecurrence() -> FamilyEvent {
        var result = self
        result.recurrence = nil
        return result
    }

    func copy(id: UUID) -> FamilyEvent {
        FamilyEvent(
            id: id,
            title: title,
            kidID: kidID,
            participantIDs: participantIDs,
            startTime: startTime,
            endTime: endTime,
            location: location,
            driver: driver,
            driverMemberID: driverMemberID,
            source: source,
            status: status,
            alertLeadTime: alertLeadTime,
            recurrence: recurrence,
            recurrenceSeriesID: recurrenceSeriesID,
            isReadOnly: isReadOnly,
            provenance: provenance
        )
    }
}

private extension EventRecurrence {
    func with(weekdays: [Weekday]? = nil, endDate: Date? = nil) -> EventRecurrence {
        EventRecurrence(
            frequency: frequency,
            interval: interval,
            weekdays: weekdays ?? self.weekdays,
            endDate: endDate ?? self.endDate
        )
    }
}
