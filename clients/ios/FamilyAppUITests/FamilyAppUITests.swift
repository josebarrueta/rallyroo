import XCTest

@MainActor
final class FamilyAppUITests: XCTestCase {
    func testLoginDoesNotAskForAManualInvitationCode() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "remote"
        app.launchEnvironment["RALLYROO_REMOTE_BASE_URL"] = "http://127.0.0.1:3199"
        app.launch()

        XCTAssertTrue(app.staticTexts["Welcome to Rallyroo"].waitForExistence(timeout: 10))
        let appleButton = app.buttons["Continue with Apple"]
        let googleButton = app.buttons["Continue with Google"]
        XCTAssertTrue(appleButton.exists)
        XCTAssertTrue(googleButton.exists)
        XCTAssertEqual(appleButton.frame.width, googleButton.frame.width, accuracy: 1)
        XCTAssertEqual(appleButton.frame.height, googleButton.frame.height, accuracy: 1)
        XCTAssertFalse(app.textFields["Invitation code (optional)"].exists)
    }

    func testUserCanSignOutFromSettings() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()

        let signOut = app.buttons["Sign Out"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 5))
        signOut.tap()

        let confirmation = app.buttons["confirm-sign-out"].firstMatch
        XCTAssertTrue(confirmation.waitForExistence(timeout: 5))
        confirmation.tap()
        XCTAssertTrue(app.staticTexts["Welcome to Rallyroo"].waitForExistence(timeout: 5))
    }

    func testNewEventDefaultsToAnAtStartAlert() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()

        XCTAssertTrue(app.navigationBars["Add Event"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["At start"].exists)
    }

    func testSavingAnEventAsksSeparatelyAboutImmediateParticipantNotifications() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()
        app.textFields["Title"].tap()
        app.textFields["Title"].typeText("Notification choice test")
        app.buttons["Save"].tap()

        XCTAssertTrue(app.alerts["Notify family?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Yes, notify"].exists)
        XCTAssertTrue(app.buttons["Save without notifying"].exists)
    }

    func testManualLocationRemainsSavableWhenSuggestionsAreUnavailable() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()
        XCTAssertTrue(app.navigationBars["Add Event"].waitForExistence(timeout: 5))

        app.textFields["Title"].tap()
        app.textFields["Title"].typeText("Location fallback test")
        app.textFields["Location"].tap()
        app.textFields["Location"].typeText("123 Main Street")

        let fallbackMessage = app.staticTexts[
            "Location suggestions are unavailable. You can still enter a location manually."
        ]
        XCTAssertTrue(fallbackMessage.waitForExistence(timeout: 5))
        app.buttons["Save"].tap()
        XCTAssertTrue(app.alerts["Notify family?"].waitForExistence(timeout: 5))
        app.buttons["Save without notifying"].tap()

        XCTAssertTrue(app.staticTexts["Location fallback test"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["123 Main Street"].exists)
    }

    func testParentCanCreateAndCompleteAReminderWithoutAnEndTime() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launch()

        XCTAssertTrue(app.tabBars.buttons["Reminders"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Reminders"].tap()
        app.buttons["Add Reminder"].tap()
        XCTAssertTrue(app.navigationBars["Add Reminder"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.datePickers["Ends"].exists)
        XCTAssertTrue(app.staticTexts["At due time"].exists)

        app.textFields["Title"].tap()
        app.textFields["Title"].typeText("Default alert reminder")
        let assignee = app.switches["Local Parent"]
        if (assignee.value as? String) == "0" {
            assignee.tap()
        }
        XCTAssertTrue(app.buttons["Save"].isEnabled)
        app.buttons["Save"].tap()

        let reminderTitle = app.staticTexts["Default alert reminder"]
        XCTAssertTrue(reminderTitle.waitForExistence(timeout: 5))
        reminderTitle.tap()
        XCTAssertTrue(app.navigationBars["Edit Reminder"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["At due time"].exists)
        app.buttons["Cancel"].tap()

        app.buttons["Complete reminder"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Reopen reminder"].firstMatch.waitForExistence(timeout: 5))
    }

    // Issue #3 regression: today must be the first visible schedule day, even
    // when it falls near the end of the calendar week.
    func testScheduleStartsAtToday() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let todayButton = app.navigationBars["Rallyroo"].buttons["Today"]
        XCTAssertTrue(todayButton.exists)
        todayButton.tap()

        let calendar = Calendar.autoupdatingCurrent
        let todayLabel = Date.now.formatted(.dateTime.weekday(.wide).month().day())
        let yesterday = calendar.date(byAdding: .day, value: -1, to: .now)!
        let yesterdayLabel = yesterday.formatted(.dateTime.weekday(.wide).month().day())
        let todayHeader = app.staticTexts[todayLabel]

        XCTAssertTrue(todayHeader.waitForExistence(timeout: 5))
        XCTAssertLessThan(todayHeader.frame.minY, app.frame.height * 0.55)
        XCTAssertFalse(app.staticTexts[yesterdayLabel].isHittable)
     }

    func testParentCanOpenTheLocalScheduleAndFamilyTabs() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Let's jam!"].exists)
        XCTAssertTrue(app.tabBars.buttons["Schedule"].exists)
        XCTAssertTrue(app.tabBars.buttons["Family"].exists)
        XCTAssertTrue(app.tabBars.buttons["Alerts"].exists)
        XCTAssertTrue(app.tabBars.buttons["Settings"].exists)

        app.tabBars.buttons["Family"].tap()
        XCTAssertTrue(app.navigationBars["Family"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Your home team"].exists)
    }
}
