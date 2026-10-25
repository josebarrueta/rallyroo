import XCTest
@testable import FamilyCore

final class AppImprovementPresentationTests: XCTestCase {
    func testSearchMatchesEmptyQueriesCaseAccentsAndTermsAcrossFields() {
        XCTAssertTrue(AppSearch.matches(" \n\t", in: []))
        XCTAssertTrue(AppSearch.matches("cafe", in: ["Café visit"]))
        XCTAssertTrue(AppSearch.matches("JOSÉ field", in: ["Jose practice", "North Field"]))
        XCTAssertFalse(AppSearch.matches("field absent", in: ["North Field"]))
        XCTAssertFalse(AppSearch.matches("one", in: []))
        XCTAssertTrue(AppSearch.matches("[", in: ["Bracket [ label"])) // Literal, not regex.
    }

    func testPermissionsDistinguishPromptableDeniedQuietAndTemporaryStates() {
        let pending = NotificationPermissionHealth(authorization: .notRequested, alertsEnabled: false, badgesEnabled: false)
        XCTAssertTrue(pending.canRequest)
        XCTAssertFalse(pending.canOpenSettings)
        let denied = NotificationPermissionHealth(authorization: .denied, alertsEnabled: false, badgesEnabled: false)
        XCTAssertFalse(denied.canRequest)
        XCTAssertTrue(denied.canOpenSettings)
        XCTAssertTrue(denied.guidance.contains("in-app Alerts remain available"))
        XCTAssertEqual(NotificationPermissionHealth(authorization: .provisional, alertsEnabled: false, badgesEnabled: false).title,
                       "Quiet notifications allowed")
        XCTAssertEqual(NotificationPermissionHealth(authorization: .ephemeral, alertsEnabled: true, badgesEnabled: true).title,
                       "Notifications allowed temporarily")
    }

    func testBadgeLimitationsNeverClaimAPushWasDelivered() {
        let health = NotificationPermissionHealth(authorization: .authorized, alertsEnabled: true, badgesEnabled: false)
        XCTAssertFalse(health.canRequest)
        XCTAssertTrue(health.canOpenSettings)
        XCTAssertTrue(health.guidance.contains("in-app unread count still works"))
        XCTAssertTrue(health.guidance.contains("does not guarantee delivery"))
        let noAlerts = NotificationPermissionHealth(authorization: .authorized, alertsEnabled: false, badgesEnabled: true)
        XCTAssertEqual(noAlerts.title, "Notification alerts disabled")
    }
}
