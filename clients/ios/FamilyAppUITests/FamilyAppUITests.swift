import XCTest

@MainActor
final class FamilyAppUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func testLoginDoesNotAskForAManualInvitationCode() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "1"
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
        let app = localApp()
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

    func testEventAlertAppearsOnlyAfterSelectingAParticipant() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()
        XCTAssertTrue(app.navigationBars["Add Event"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["At start"].exists)
        app.buttons["Cancel"].tap()

        addFamilyMember(named: "Alert Participant", in: app)
        app.buttons["Soccer Practice"].tap()
        XCTAssertTrue(app.navigationBars["Add Event"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["At start"].waitForExistence(timeout: 2))
    }

    func testEventWithoutParticipantsSavesWithoutNotificationOptions() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()
        app.textFields["Title"].tap()
        app.textFields["Title"].typeText("No notification options")
        app.buttons["Save"].tap()

        XCTAssertFalse(app.alerts["Notify family?"].exists)
        XCTAssertTrue(app.staticTexts["No notification options"].waitForExistence(timeout: 5))
    }

    func testSavingAnEventWithAParticipantAsksAboutImmediateNotifications() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        addFamilyMember(named: "Notification Participant", in: app)
        app.buttons["Soccer Practice"].tap()
        XCTAssertTrue(app.navigationBars["Add Event"].waitForExistence(timeout: 5))
        app.buttons["Save"].tap()

        XCTAssertTrue(app.alerts["Notify family?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Yes, notify"].exists)
        XCTAssertTrue(app.buttons["Save without notifying"].exists)
    }

    func testEditingARecurringOccurrenceOffersAllThreeScopes() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()
        app.textFields["Title"].tap()
        app.textFields["Title"].typeText("Recurring scope test")
        app.staticTexts["Never"].tap()
        app.buttons["Weekly"].tap()
        app.buttons["Save"].tap()

        let event = app.staticTexts["Recurring scope test"]
        XCTAssertTrue(event.waitForExistence(timeout: 5))
        event.tap()
        XCTAssertTrue(app.navigationBars["Edit Event"].waitForExistence(timeout: 5))
        app.buttons["Save"].tap()

        XCTAssertTrue(app.buttons["Only this occurrence"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["This weekday and future occurrences"].exists)
        XCTAssertTrue(app.buttons["All future occurrences"].exists)
        XCTAssertTrue(app.staticTexts["Past occurrences will remain unchanged."].exists)
    }

    func testManualLocationRemainsSavableWhenSuggestionsAreUnavailable() {
        let app = localApp()
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

        XCTAssertTrue(app.staticTexts["Location fallback test"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["123 Main Street"].exists)
    }

    func testParentCanCreateAndCompleteAReminderWithoutAnEndTime() {
        let app = localApp()
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
        let app = localApp()
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
        let app = localApp()
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

    func testLocalUITestLaunchClearsPreviousTestData() {
        let firstLaunch = localApp()
        firstLaunch.launch()
        XCTAssertTrue(firstLaunch.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        firstLaunch.buttons["Add"].tap()
        firstLaunch.textFields["Title"].tap()
        firstLaunch.textFields["Title"].typeText("Must not survive relaunch")
        firstLaunch.buttons["Save"].tap()
        XCTAssertTrue(firstLaunch.staticTexts["Must not survive relaunch"].waitForExistence(timeout: 5))
        firstLaunch.terminate()

        let secondLaunch = localApp()
        secondLaunch.launch()
        XCTAssertTrue(secondLaunch.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        XCTAssertFalse(secondLaunch.staticTexts["Must not survive relaunch"].exists)
    }

    private func addFamilyMember(named name: String, in app: XCUIApplication) {
        app.tabBars.buttons["Family"].tap()
        XCTAssertTrue(app.navigationBars["Family"].waitForExistence(timeout: 5))
        app.navigationBars["Family"].buttons["Add"].tap()
        XCTAssertTrue(app.navigationBars["Add Family Member"].waitForExistence(timeout: 5))
        app.textFields["Name"].tap()
        app.textFields["Name"].typeText(name)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5))
    }

    private func localApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "1"
        return app
    }
}
