import FamilyCore
import XCTest

final class LocalAlertQueuePlannerTests: XCTestCase {
    func testEarlierEventAlertDisplacesTheFarthestAlertWhenQueueIsFull() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        let eventStart = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 9, day: 30, hour: 17, minute: 30
        )))
        let expectedFireAt = try XCTUnwrap(calendar.date(from: DateComponents(
            year: 2026, month: 9, day: 30, hour: 16, minute: 45
        )))
        XCTAssertEqual(eventStart.addingTimeInterval(-45 * 60), expectedFireAt)

        let pending = (0..<60).map { index in
            LocalAlertSlot(
                identifier: "rallyroo.event.existing.\(index)",
                fireAt: expectedFireAt.addingTimeInterval(Double(index + 1) * 86_400)
            )
        }
        let candidate = LocalAlertSlot(
            identifier: "rallyroo.event.wednesday-530",
            fireAt: eventStart.addingTimeInterval(-45 * 60)
        )

        let admission = LocalAlertQueuePlanner.admission(
            pending: pending,
            adding: candidate,
            capacity: 60
        )

        XCTAssertTrue(admission.shouldSchedule)
        XCTAssertEqual(admission.identifierToRemove, "rallyroo.event.existing.59")
    }

    func testLaterAlertDoesNotDisplaceANearerAlertWhenQueueIsFull() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let pending = [LocalAlertSlot(identifier: "nearer", fireAt: now)]
        let candidate = LocalAlertSlot(identifier: "later", fireAt: now.addingTimeInterval(60))

        let admission = LocalAlertQueuePlanner.admission(
            pending: pending, adding: candidate, capacity: 1
        )

        XCTAssertFalse(admission.shouldSchedule)
        XCTAssertNil(admission.identifierToRemove)
    }

    func testReplacingAnExistingAlertDoesNotConsumeAnotherSlot() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let pending = [LocalAlertSlot(identifier: "same", fireAt: now.addingTimeInterval(60))]
        let candidate = LocalAlertSlot(identifier: "same", fireAt: now)

        let admission = LocalAlertQueuePlanner.admission(
            pending: pending, adding: candidate, capacity: 1
        )

        XCTAssertTrue(admission.shouldSchedule)
        XCTAssertNil(admission.identifierToRemove)
    }
}
