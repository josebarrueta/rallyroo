import Combine
import Foundation

public enum CommuteScheduleDayGroup: String, CaseIterable, Sendable {
    case weekdays
    case weekends

    public var weekdays: [Int] {
        switch self {
        case .weekdays: [1, 2, 3, 4, 5]
        case .weekends: [6, 7]
        }
    }
}

public struct CommuterScheduleSearchIntent: Equatable, Sendable {
    public let request: CaltrainJourneySearch
    fileprivate let generation: UInt
}

@MainActor
public final class CommuterScheduleSelection: ObservableObject {
    @Published public private(set) var originStationID: String?
    @Published public private(set) var destinationStationID: String?
    @Published public private(set) var dayGroup: CommuteScheduleDayGroup?
    @Published public private(set) var selectedWeekdays: Set<Int> = []
    @Published public private(set) var journeyOptions: [CaltrainJourneyOption] = []
    @Published public private(set) var selectedJourney: CaltrainJourneyOption?
    @Published public private(set) var scheduleStatus: CommuterProviderFeedStatus?

    private var scheduleVersion: String?
    private var generation: UInt = 0

    public init() {}

    public var availableWeekdays: [Int] {
        dayGroup?.weekdays ?? []
    }

    public var searchIntent: CommuterScheduleSearchIntent? {
        guard let request = searchRequest else { return nil }
        return CommuterScheduleSearchIntent(request: request, generation: generation)
    }

    public var searchRequest: CaltrainJourneySearch? {
        guard let originStationID,
              let destinationStationID,
              originStationID != destinationStationID,
              dayGroup != nil,
              !selectedWeekdays.isEmpty
        else { return nil }
        return CaltrainJourneySearch(
            originStationID: originStationID,
            destinationStationID: destinationStationID,
            serviceWeekdays: selectedWeekdays.sorted()
        )
    }

    public func selectOrigin(_ stationID: String?) {
        guard stationID != originStationID else { return }
        originStationID = normalized(stationID)
        if destinationStationID == originStationID { destinationStationID = nil }
        invalidateSchedule()
    }

    public func selectDestination(_ stationID: String?) {
        guard stationID != destinationStationID else { return }
        destinationStationID = normalized(stationID)
        invalidateSchedule()
    }

    public func selectDayGroup(_ group: CommuteScheduleDayGroup) {
        guard group != dayGroup else { return }
        dayGroup = group
        selectedWeekdays = Set(group.weekdays)
        invalidateSchedule()
    }

    public func toggleWeekday(_ weekday: Int) {
        guard availableWeekdays.contains(weekday) else { return }
        if selectedWeekdays.contains(weekday) {
            selectedWeekdays.remove(weekday)
        } else {
            selectedWeekdays.insert(weekday)
        }
        invalidateSchedule()
    }

    public func applySearchResult(
        _ result: CaltrainJourneySearchResult,
        for intent: CommuterScheduleSearchIntent
    ) {
        guard intent.generation == generation, intent.request == searchRequest else { return }
        scheduleVersion = result.scheduleVersion
        scheduleStatus = result.status
        journeyOptions = result.options.filter { option in
            selectedWeekdays.isSubset(of: Set(option.operatingWeekdays))
        }
        selectedJourney = nil
    }

    public func selectJourney(_ option: CaltrainJourneyOption) {
        guard journeyOptions.contains(where: { $0.id == option.id }),
              selectedWeekdays.isSubset(of: Set(option.operatingWeekdays))
        else { return }
        selectedJourney = option
    }

    public func subscriptionDraft(
        visibility: CommuteSubscriptionVisibility,
        alertKinds: [CommuteAlertKind],
        minimumDelayMinutes: Int
    ) -> CommuteSubscriptionDraft? {
        guard let option = selectedJourney,
              let scheduleVersion,
              !alertKinds.isEmpty,
              (1...180).contains(minimumDelayMinutes)
        else { return nil }
        return CommuteSubscriptionDraft(
            visibility: visibility,
            routeID: "*",
            directionID: option.directionID,
            originStopID: option.originStopID,
            destinationStopID: option.destinationStopID,
            serviceWeekdays: selectedWeekdays.sorted(),
            windowStartMinutes: option.departureMinutes,
            windowEndMinutes: min(option.departureMinutes + 1, 1_440),
            alertKinds: alertKinds,
            minimumDelayMinutes: minimumDelayMinutes,
            scheduleOptionID: option.id,
            scheduledDepartureMinutes: option.departureMinutes,
            scheduledArrivalMinutes: option.arrivalMinutes,
            scheduleVersion: scheduleVersion
        )
    }

    private func invalidateSchedule() {
        generation &+= 1
        journeyOptions = []
        selectedJourney = nil
        scheduleStatus = nil
        scheduleVersion = nil
    }

    private func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }
}
