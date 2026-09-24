import Foundation
import XCTest
@testable import FamilyCore

final class CommuterPresentationTests: XCTestCase {
    func testExpectedRealtimeStalenessDoesNotClaimServiceNeedsAttention() {
        let state = CommuterState(
            installation: CommuterInstallation(enabledByMemberID: "parent-1", status: .enabled),
            subscriptions: [subscription(status: .active)],
            providerStatus: CommuterProviderStatus(
                catalog: feed(.healthy),
                realtime: feed(.stale)
            )
        )

        XCTAssertEqual(state.scheduleCardSubtitle, "1 active alert")
    }

    func testProviderFailureDoesNotClaimTheFamilyNeedsToTakeAction() {
        let state = CommuterState(
            installation: CommuterInstallation(enabledByMemberID: "parent-1", status: .enabled),
            subscriptions: [subscription(status: .active)],
            providerStatus: CommuterProviderStatus(
                catalog: feed(.healthy),
                realtime: feed(.degraded)
            )
        )

        XCTAssertEqual(state.scheduleCardSubtitle, "1 active alert")
    }

    func testPickerOffersUniqueAvailableTrainNumbersInNaturalOrder() {
        let response = CaltrainLiveTrainsResponse(
            status: feed(.healthy),
            observedAt: "2026-09-22T19:49:00Z",
            positions: [position("170", directionID: 1), position("92", directionID: 0),
                        position("170", directionID: 1), position("", directionID: nil)]
        )

        XCTAssertEqual(response.availableTrainNumbers, ["92", "170"])
        XCTAssertEqual(response.positions(forTrainNumber: nil).count, 4)
        XCTAssertEqual(response.positions(forTrainNumber: "170").map(\.tripID), ["170", "170"])
        XCTAssertTrue(response.positions(forTrainNumber: "17").isEmpty)
        XCTAssertTrue(CaltrainLiveTrainsResponse(status: feed(.healthy), observedAt: nil, positions: [])
            .availableTrainNumbers.isEmpty)
    }

    func testVehicleDirectionsKeepUnknownFeedValuesSeparate() {
        XCTAssertEqual(position("170", directionID: 1).liveDirection, .northbound)
        XCTAssertEqual(position("171", directionID: 0).liveDirection, .southbound)
        XCTAssertEqual(position("172", directionID: nil).liveDirection, .unknown)
        XCTAssertEqual(position("173", directionID: 9).liveDirection, .unknown)
    }

    private func feed(_ state: CommuterProviderHealth) -> CommuterProviderFeedStatus {
        CommuterProviderFeedStatus(state: state, lastSuccessAt: nil, lastAttemptAt: nil)
    }

    private func position(_ trainNumber: String, directionID: Int?) -> CaltrainVehiclePosition {
        CaltrainVehiclePosition(
            id: trainNumber,
            tripID: trainNumber,
            routeID: "CT",
            directionID: directionID,
            latitude: 37.5,
            longitude: -122.3,
            timestamp: "2026-09-22T19:49:00Z"
        )
    }

    private func subscription(status: CommuteSubscriptionStatus) -> CommuteSubscription {
        CommuteSubscription(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            ownerMemberID: "parent-1",
            visibility: .personal,
            agencyID: .caltrain,
            routeID: "*",
            directionID: "northbound",
            originStopID: "origin",
            destinationStopID: "destination",
            serviceWeekdays: [1],
            windowStartMinutes: 480,
            windowEndMinutes: 540,
            alertKinds: [.delay],
            minimumDelayMinutes: 5,
            status: status,
            scheduleOptionID: nil,
            scheduledDepartureMinutes: nil,
            scheduledArrivalMinutes: nil,
            scheduleVersion: nil,
            scheduleAvailability: nil
        )
    }
}
