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

    func testFiltersLivePositionsByTrainNumber() {
        let response = CaltrainLiveTrainsResponse(
            status: feed(.healthy),
            observedAt: "2026-09-22T19:49:00Z",
            positions: [position("156"), position("157"), position("428")]
        )

        XCTAssertEqual(response.positions(matchingTrainNumber: "15").map(\.tripID), ["156", "157"])
        XCTAssertEqual(response.positions(matchingTrainNumber: " 428 ").map(\.tripID), ["428"])
        XCTAssertEqual(response.positions(matchingTrainNumber: "").map(\.tripID), ["156", "157", "428"])
    }

    private func feed(_ state: CommuterProviderHealth) -> CommuterProviderFeedStatus {
        CommuterProviderFeedStatus(state: state, lastSuccessAt: nil, lastAttemptAt: nil)
    }

    private func position(_ trainNumber: String) -> CaltrainVehiclePosition {
        CaltrainVehiclePosition(
            id: trainNumber,
            tripID: trainNumber,
            routeID: "CT",
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
