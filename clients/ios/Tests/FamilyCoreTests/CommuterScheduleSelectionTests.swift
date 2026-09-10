import XCTest
@testable import FamilyCore

@MainActor
final class CommuterScheduleSelectionTests: XCTestCase {
    func testDayGroupShowsOnlyProperDaysAndInvalidatesTrainSelection() async {
        let model = CommuterScheduleSelection()
        model.selectOrigin("palo_alto")
        model.selectDestination("san_francisco")
        model.selectDayGroup(.weekdays)
        XCTAssertEqual(model.availableWeekdays, [1, 2, 3, 4, 5])
        XCTAssertEqual(model.selectedWeekdays, Set([1, 2, 3, 4, 5]))

        model.toggleWeekday(2)
        model.toggleWeekday(3)
        XCTAssertEqual(model.selectedWeekdays, Set([1, 4, 5]))

        model.selectJourney(Self.option)
        XCTAssertNil(model.selectedJourney)
        model.applySearchResult(Self.result, for: model.searchIntent!)
        model.selectJourney(Self.option)
        XCTAssertEqual(model.selectedJourney?.arrivalMinutes, 484)

        model.selectDayGroup(.weekends)
        XCTAssertEqual(model.availableWeekdays, [6, 7])
        XCTAssertEqual(model.selectedWeekdays, Set([6, 7]))
        XCTAssertNil(model.selectedJourney)
        XCTAssertTrue(model.journeyOptions.isEmpty)
    }

    func testIgnoresAnOlderResponseWhenUserReturnsToTheSameDaySelection() throws {
        let model = CommuterScheduleSelection()
        model.selectOrigin("palo_alto")
        model.selectDestination("san_francisco")
        model.selectDayGroup(.weekdays)
        let staleIntent = try XCTUnwrap(model.searchIntent)

        model.toggleWeekday(2)
        model.toggleWeekday(2)
        XCTAssertEqual(model.searchIntent?.request, staleIntent.request)
        XCTAssertNotEqual(model.searchIntent, staleIntent)

        model.applySearchResult(Self.result, for: staleIntent)
        XCTAssertTrue(model.journeyOptions.isEmpty)
    }

    func testStationChoicesCollapseDirectionalPlatformsAndSortNorthToSouth() {
        let validFrom = Date(timeIntervalSince1970: 1_788_192_000)
        let validUntil = Date(timeIntervalSince1970: 1_796_054_399)
        let stops = [
            CaltrainStop(
                id: "south-platform", stationID: "south", stationName: "Palo Alto Caltrain Station Southbound",
                direction: .southbound, latitude: 37.443, longitude: -122.165,
                validFrom: validFrom, validUntil: validUntil
            ),
            CaltrainStop(
                id: "north-platform", stationID: "north", stationName: "San Francisco Caltrain Station Northbound",
                direction: .northbound, latitude: 37.776, longitude: -122.394,
                validFrom: validFrom, validUntil: validUntil
            ),
            CaltrainStop(
                id: "north-platform-2", stationID: "north", stationName: "San Francisco Caltrain Station Southbound",
                direction: .southbound, latitude: 37.776, longitude: -122.394,
                validFrom: validFrom, validUntil: validUntil
            ),
        ]

        XCTAssertEqual(
            CommuterScheduleSelection.stationChoices(from: stops),
            [
                CaltrainStationChoice(id: "north", name: "San Francisco", latitude: 37.776),
                CaltrainStationChoice(id: "south", name: "Palo Alto", latitude: 37.443),
            ]
        )
    }

    func testJourneyOptionsAreExposedInChronologicalOrder() throws {
        let model = CommuterScheduleSelection()
        model.selectOrigin("palo_alto")
        model.selectDestination("san_francisco")
        model.selectDayGroup(.weekdays)
        let intent = try XCTUnwrap(model.searchIntent)
        let later = CaltrainJourneyOption(
            id: String(repeating: "b", count: 64), directionID: "northbound",
            originStopID: "70171", destinationStopID: "70011",
            departureMinutes: 519, arrivalMinutes: 550, operatingWeekdays: [1, 2, 3, 4, 5]
        )
        let result = CaltrainJourneySearchResult(
            scheduleVersion: "v1", observedAt: Date(timeIntervalSince1970: 1_789_000_000),
            validUntil: "2026-12-31", status: Self.result.status,
            options: [later, Self.option]
        )

        model.applySearchResult(result, for: intent)

        XCTAssertEqual(model.journeyOptions.map(\.departureMinutes), [451, 519])
    }

    func testChangingStationsInvalidatesOptionsAndBuildsScheduleBoundDraft() async throws {
        let model = CommuterScheduleSelection()
        model.selectOrigin("palo_alto")
        model.selectDestination("san_francisco")
        model.selectDayGroup(.weekdays)
        model.toggleWeekday(2)
        model.toggleWeekday(3)
        let intent = try XCTUnwrap(model.searchIntent)

        model.applySearchResult(Self.result, for: intent)
        model.selectJourney(Self.option)
        let draft = try XCTUnwrap(model.subscriptionDraft(
            visibility: .personal,
            alertKinds: [.delay, .cancellation],
            minimumDelayMinutes: 15
        ))
        XCTAssertEqual(draft.serviceWeekdays, [1, 4, 5])
        XCTAssertEqual(draft.windowStartMinutes, 451)
        XCTAssertEqual(draft.windowEndMinutes, 452)
        XCTAssertEqual(draft.scheduledArrivalMinutes, 484)
        XCTAssertEqual(draft.scheduleVersion, "v1")

        model.selectDestination("millbrae")
        XCTAssertNil(model.selectedJourney)
        XCTAssertTrue(model.journeyOptions.isEmpty)
        XCTAssertNil(model.subscriptionDraft(
            visibility: .personal,
            alertKinds: [.delay],
            minimumDelayMinutes: 15
        ))
    }

    private static let option = CaltrainJourneyOption(
        id: String(repeating: "a", count: 64),
        directionID: "northbound",
        originStopID: "70171",
        destinationStopID: "70011",
        departureMinutes: 451,
        arrivalMinutes: 484,
        operatingWeekdays: [1, 2, 3, 4, 5]
    )

    private static let result = CaltrainJourneySearchResult(
        scheduleVersion: "v1",
        observedAt: Date(timeIntervalSince1970: 1_789_000_000),
        validUntil: "2026-12-31",
        status: CommuterProviderFeedStatus(
            state: .healthy,
            lastSuccessAt: Date(timeIntervalSince1970: 1_789_000_000),
            lastAttemptAt: Date(timeIntervalSince1970: 1_789_000_000)
        ),
        options: [option]
    )
}
