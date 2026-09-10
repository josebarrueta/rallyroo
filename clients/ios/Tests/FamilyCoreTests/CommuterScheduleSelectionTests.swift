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
