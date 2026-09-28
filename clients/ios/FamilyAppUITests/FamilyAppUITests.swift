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

    func testHouseholdShortcutOpensShoppingAndPantry() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let household = app.buttons["schedule-household"]
        XCTAssertTrue(household.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["schedule-connected-calendars"].exists)
        household.tap()
        XCTAssertTrue(app.navigationBars["Household"].waitForExistence(timeout: 5))
        app.buttons["Shopping and Pantry"].tap()
        XCTAssertTrue(app.navigationBars["Shopping and Pantry"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Neighborhood Market"].exists)
    }

    func testParentSeesReceiptReviewBeforeSavingExpense() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_EXPENSES"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_RECEIPT"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-household"].tap()
        XCTAssertTrue(app.navigationBars["Household"].waitForExistence(timeout: 5))
        app.buttons["Expenses"].tap()
        XCTAssertTrue(app.navigationBars["Expenses"].waitForExistence(timeout: 5))
        let addExpense = app.buttons["Add expense"]
        XCTAssertTrue(addExpense.waitForExistence(timeout: 5))
        addExpense.tap()
        XCTAssertTrue(app.buttons["Choose receipt photo"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "review every field before saving")).firstMatch.exists)
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        app.buttons["Preview test receipt"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Verify the receipt total")).firstMatch
            .waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Add Milk to Pantry"].waitForExistence(timeout: 5))
        let request = app.buttons["Request Milk for future Shopping"]
        XCTAssertTrue(request.exists)
        XCTAssertFalse(request.isEnabled)
        app.buttons["Add Milk to Pantry"].tap()
        XCTAssertEqual(app.buttons["Add Milk to Pantry"].value as? String, "Selected")
        XCTAssertTrue(request.isEnabled)
        request.tap()
        XCTAssertEqual(request.value as? String, "Selected")
        XCTAssertEqual(app.buttons["Add Milk to Pantry"].value as? String, "Selected")
        XCTAssertTrue(app.buttons["Save"].isEnabled)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Test Market"].waitForExistence(timeout: 5))
    }

    func testRejectedReceiptProposalExplainsTheHundredItemLimitWithoutEnablingSave() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_EXPENSES"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_RECEIPT"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_RECEIPT_REJECT"] = "422"
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-household"].tap()
        XCTAssertTrue(app.navigationBars["Household"].waitForExistence(timeout: 5))
        app.buttons["Expenses"].tap()
        XCTAssertTrue(app.navigationBars["Expenses"].waitForExistence(timeout: 5))
        let addExpense = app.buttons["Add expense"]
        XCTAssertTrue(addExpense.waitForExistence(timeout: 5))
        addExpense.tap()
        app.buttons["Preview test receipt"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "more than 100 items"))
            .firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Save"].isEnabled)
        XCTAssertFalse(app.buttons["Add Milk to Pantry"].exists)
    }

    func testParentRecordsAndDeletesManualExpenseFromHousehold() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_EXPENSES"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-household"].tap()
        XCTAssertTrue(app.navigationBars["Household"].waitForExistence(timeout: 5))
        app.buttons["Expenses"].tap()
        XCTAssertTrue(app.navigationBars["Expenses"].waitForExistence(timeout: 5))
        app.buttons["Add expense"].tap()
        XCTAssertTrue(app.navigationBars["Add Expense"].waitForExistence(timeout: 5))
        let amount = app.textFields["Amount (USD)"]
        amount.tap()
        amount.typeText("12.34")
        app.textFields["Merchant (optional)"].tap()
        app.textFields["Merchant (optional)"].typeText("Market")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Market"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["$12.34"].exists)
        app.buttons.containing(.staticText, identifier: "Market").firstMatch.swipeLeft()
        app.buttons["Delete"].tap()
        app.buttons["Delete Expense"].tap()
        XCTAssertTrue(app.staticTexts["No expenses yet"].waitForExistence(timeout: 5))
    }

    func testParentCanManageShoppingRoutinesAndPantryCatalog() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        app.buttons["Household"].tap()
        let shopping = app.buttons["Shopping and Pantry"]
        XCTAssertTrue(shopping.waitForExistence(timeout: 5))
        shopping.tap()

        XCTAssertTrue(app.navigationBars["Shopping and Pantry"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Neighborhood Market"].exists)
        XCTAssertTrue(app.staticTexts["Oat milk"].exists)
        XCTAssertTrue(app.staticTexts["Low"].exists)
        XCTAssertTrue(app.staticTexts["1 open request"].exists)
        let requestButton = app.buttons["Request Oat milk"]
        XCTAssertTrue(requestButton.exists)
        requestButton.tap()
        let requestNavigation = app.navigationBars["Request Item"]
        XCTAssertTrue(requestNavigation.waitForExistence(timeout: 1))
        requestNavigation.buttons["Cancel"].tap()
        let stockButton = app.buttons["Update Oat milk stock"]
        XCTAssertTrue(stockButton.waitForExistence(timeout: 1))
        stockButton.tap()
        let stockNavigation = app.navigationBars["Update Stock"]
        XCTAssertTrue(stockNavigation.waitForExistence(timeout: 1))
        stockNavigation.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Add shopping routine"].exists)
        XCTAssertTrue(app.buttons["Add pantry item"].exists)
        app.buttons["Add pantry item"].tap()
        XCTAssertTrue(app.navigationBars["New Pantry Item"].waitForExistence(timeout: 5))
        app.buttons["Choose a common item"].tap()
        XCTAssertTrue(app.navigationBars["Common items"].waitForExistence(timeout: 5))
        app.buttons["Eggs"].tap()
        XCTAssertEqual(app.textFields["Name"].value as? String, "Eggs")
        app.buttons["Save"].tap()
        app.buttons["Prepare Neighborhood Market trip"].tap()
        XCTAssertTrue(app.navigationBars["Shopping Trip"].waitForExistence(timeout: 5))
        app.buttons["Add Pantry item"].tap()
        XCTAssertTrue(app.navigationBars["New Pantry Item"].waitForExistence(timeout: 5))
        app.navigationBars["New Pantry Item"].buttons["Cancel"].tap()
        app.buttons["Add existing Pantry item"].tap()
        XCTAssertTrue(app.navigationBars["Add existing Pantry item"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Eggs"].exists)
        app.navigationBars["Add existing Pantry item"].buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["Recent Stock evidence says Low."].exists)
        XCTAssertTrue(app.staticTexts["Oat milk"].exists)
        XCTAssertTrue(app.buttons["Finalize Trip"].exists)
        app.buttons["Finalize Trip"].tap()
        let confirmation = app.buttons["Confirm Finalization"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 2))
        confirmation.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Finalized")).firstMatch
            .waitForExistence(timeout: 5))
        app.buttons["Record Trip Outcomes"].tap()
        XCTAssertTrue(app.buttons["Purchased Oat milk"].waitForExistence(timeout: 2))
        app.buttons["Purchased Oat milk"].tap()
        app.buttons["Complete Trip"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Completed")).firstMatch
            .waitForExistence(timeout: 5))
    }

    func testAddPantryItemFromTripOffersCreationWhenAllCatalogItemsAreIncluded() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        app.buttons["Household"].tap()
        app.buttons["Shopping and Pantry"].tap()
        app.buttons["Prepare Neighborhood Market trip"].tap()
        XCTAssertTrue(app.navigationBars["Shopping Trip"].waitForExistence(timeout: 5))
        app.buttons["Add Pantry item"].tap()
        XCTAssertTrue(app.navigationBars["New Pantry Item"].waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Category,")).firstMatch.tap()
        app.buttons["Cleaning supplies"].tap()
        app.buttons["Choose a common item"].tap()
        XCTAssertTrue(app.navigationBars["Common items"].waitForExistence(timeout: 5))
        app.buttons["Dish soap"].tap()
        XCTAssertEqual(app.textFields["Name"].value as? String, "Dish soap")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["Shopping Trip"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Dish soap"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Save Review"].isEnabled)
        app.buttons["Save Review"].tap()
        XCTAssertFalse(app.buttons["Save Review"].isEnabled)
        app.buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Shopping and Pantry"].waitForExistence(timeout: 5))
    }

    func testParentCanEnableTheMorningDayBrief() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        let dayBrief = app.buttons["Day Brief"]
        XCTAssertTrue(dayBrief.waitForExistence(timeout: 5))
        dayBrief.tap()

        let enabled = app.switches["Morning Day Brief"]
        XCTAssertTrue(enabled.waitForExistence(timeout: 5))
        let save = app.buttons["Save Day Brief"]
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: save)
        waitForExpectations(timeout: 5)
        enabled.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        expectation(for: NSPredicate(format: "value == '1'"), evaluatedWith: enabled)
        waitForExpectations(timeout: 5)
        save.tap()
        XCTAssertTrue(app.staticTexts["Your Day Brief is scheduled."].waitForExistence(timeout: 5))
    }

    func testDayBriefAlertOpensThePrivateTimeline() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Alerts"].tap()
        let alert = app.staticTexts["Your Day Brief"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.tap()

        XCTAssertTrue(app.navigationBars["Sunday at a glance"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["You drive to school drop-off this morning."].exists)
        XCTAssertTrue(app.staticTexts["School drop-off"].exists)
        XCTAssertTrue(app.staticTexts["You drive"].exists)
        XCTAssertTrue(app.staticTexts["Lincoln Elementary"].exists)
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

    func testEventEditorOffersAnOptionalArrivalTarget() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()

        let arriveBy = app.switches["event-arrive-by"]
        XCTAssertTrue(arriveBy.waitForExistence(timeout: 5))
        XCTAssertEqual(arriveBy.value as? String, "0")
        arriveBy.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(arriveBy.value as? String, "1")
        app.swipeUp()
        XCTAssertTrue(
            app.descendants(matching: .any)["event-arrival-time"].waitForExistence(timeout: 5)
        )
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
        let weekdayTitles = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        let selectedWeekday = weekdayTitles[Calendar.current.component(.weekday, from: Date()) - 1]
        let selectedWeekdayChip = app.staticTexts[selectedWeekday]
        XCTAssertTrue(selectedWeekdayChip.waitForExistence(timeout: 5))
        XCTAssertTrue(selectedWeekdayChip.isSelected)
        XCTAssertFalse(app.buttons[selectedWeekday].exists)
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
        app.textFields["Location or latitude, longitude"].tap()
        app.textFields["Location or latitude, longitude"].typeText("123 Main Street")

        let fallbackMessage = app.staticTexts[
            "Location suggestions are unavailable. You can still enter a location manually."
        ]
        XCTAssertTrue(fallbackMessage.waitForExistence(timeout: 5))
        app.buttons["Save"].tap()

        XCTAssertTrue(app.staticTexts["Location fallback test"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["123 Main Street"].exists)
    }

    func testSavedCoordinateLocationWaitsForEditingAndOffersBothMapProviders() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["Add"].tap()
        app.textFields["Title"].tap()
        app.textFields["Title"].typeText("Coordinate destination")
        let locationField = app.textFields["Location or latitude, longitude"]
        locationField.tap()
        locationField.typeText("37.4219999, -122.0840575")
        XCTAssertFalse(app.staticTexts[
            "Location suggestions are unavailable. You can still enter a location manually."
        ].waitForExistence(timeout: 1))
        app.buttons["Save"].tap()

        let event = app.staticTexts["Coordinate destination"]
        XCTAssertTrue(event.waitForExistence(timeout: 5))
        event.tap()
        XCTAssertTrue(app.navigationBars["Edit Event"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts[
            "Location suggestions are unavailable. You can still enter a location manually."
        ].waitForExistence(timeout: 1))

        app.buttons["open-event-directions"].tap()
        let appleMaps = app.descendants(matching: .any)["Apple Maps"]
        let googleMaps = app.descendants(matching: .any)["Google Maps"]
        XCTAssertTrue(appleMaps.waitForExistence(timeout: 2))
        XCTAssertTrue(googleMaps.exists)
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

    func testOverlappingEventsOccupyTheSameVerticalTimeWindow() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SCHEDULE_OVERLAP"] = "1"
        app.launch()

        let first = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "Overlap A")
        ).firstMatch
        let second = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "Overlap B")
        ).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        XCTAssertTrue(second.waitForExistence(timeout: 10))
        XCTAssertEqual(first.identifier, "event-row-scheduled")
        XCTAssertEqual(second.identifier, "event-row-scheduled")
        XCTAssertGreaterThan(second.frame.minX, first.frame.minX)
        XCTAssertGreaterThan(
            first.frame.maxY - second.frame.minY, 5,
            "Events sharing 10 minutes should visibly intersect; first=\(first.frame), second=\(second.frame)"
        )
    }

    // Issue #3 regression: today must be the first visible schedule day, even
    // when it falls near the end of the calendar week.
    func testScheduleStartsAtToday() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let viewMenu = app.buttons["schedule-view-menu"]
        XCTAssertTrue(viewMenu.exists)
        viewMenu.tap()
        app.buttons["Today"].tap()

        let calendar = Calendar.autoupdatingCurrent
        let todayLabel = Date.now.formatted(.dateTime.weekday(.wide).month().day())
        let yesterday = calendar.date(byAdding: .day, value: -1, to: .now)!
        let yesterdayLabel = yesterday.formatted(.dateTime.weekday(.wide).month().day())
        let todayHeader = app.staticTexts[todayLabel]

        XCTAssertTrue(todayHeader.waitForExistence(timeout: 5))
        XCTAssertLessThan(todayHeader.frame.minY, app.frame.height * 0.55)
        XCTAssertFalse(app.staticTexts[yesterdayLabel].isHittable)
     }

    func testTodayReturnsToTheTopAfterPagingForward() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-next-page"].tap()
        app.buttons["schedule-view-menu"].tap()
        app.buttons["Today"].tap()

        let todayLabel = Date.now.formatted(.dateTime.weekday(.wide).month().day())
        let todayHeader = app.staticTexts[todayLabel]
        XCTAssertTrue(todayHeader.waitForExistence(timeout: 5))
        XCTAssertLessThan(todayHeader.frame.minY, app.frame.height * 0.55)
    }

    func testMonthViewShowsCalendarGrid() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-view-menu"].tap()
        app.buttons["Month"].tap()

        XCTAssertTrue(app.otherElements["schedule-month-grid"].waitForExistence(timeout: 5))
        for weekdayIndex in 0..<7 {
            XCTAssertTrue(
                app.staticTexts["schedule-month-weekday-\(weekdayIndex)"].exists,
                "Expected all seven weekday headers"
            )
        }
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

    func testDeletingRecurringEventFromEditorRequiresOccurrenceScope() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_OCCURRENCE_LIFECYCLE"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let recurringEvent = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "Skipped practice")
        ).firstMatch
        XCTAssertTrue(recurringEvent.waitForExistence(timeout: 5))
        recurringEvent.tap()
        XCTAssertTrue(app.navigationBars["Edit Event"].waitForExistence(timeout: 5))

        let delete = app.buttons["Delete"].firstMatch
        for _ in 0..<4 where !delete.exists { app.swipeUp() }
        XCTAssertTrue(delete.waitForExistence(timeout: 3))
        delete.tap()

        XCTAssertTrue(app.staticTexts["Delete occurrence"].waitForExistence(timeout: 5))
        let onlyThisOccurrence = app.buttons["Only this occurrence"]
        XCTAssertTrue(onlyThisOccurrence.exists)
        XCTAssertTrue(app.buttons["This weekday and future occurrences"].exists)
        XCTAssertTrue(app.buttons["All future occurrences"].exists)
        onlyThisOccurrence.tap()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.navigationBars["Edit Event"].exists)
    }

    func testOccurrenceRowsShowStateAndOfferLifecycleActions() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_OCCURRENCE_LIFECYCLE"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let skipped = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "Skipped practice")
        ).firstMatch
        let modified = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "Modified")
        ).firstMatch
        XCTAssertTrue(skipped.waitForExistence(timeout: 5))
        XCTAssertTrue(modified.waitForExistence(timeout: 5))

        skipped.press(forDuration: 1)
        XCTAssertTrue(app.buttons["Undo skip"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Delete skipped"].exists)
    }

    func testImportedEventOpensReadOnlyDetailsAndSavesRallyrooSettings() throws {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_IMPORTED_EVENT"] = "1"
        app.launch()

        let event = app.staticTexts["Imported championship"]
        XCTAssertTrue(event.waitForExistence(timeout: 5))
        event.tap()

        XCTAssertTrue(app.navigationBars["Event details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["37.7749, -122.4194"].exists)
        XCTAssertTrue(app.buttons["open-imported-event-directions"].exists)
        app.swipeUp()
        let details = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "Bring the blue uniform.")
        ).firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["Title"].exists)

        app.switches["imported-event-arrive-by"].tap()
        app.buttons["Alert, None"].tap()
        app.buttons["30 minutes before"].tap()
        app.buttons["Driver, Not applicable"].tap()
        app.buttons["Other"].tap()
        app.textFields["Other driver"].tap()
        app.textFields["Other driver"].typeText("Coach Alex")
        app.buttons["save-imported-event-settings"].tap()
        XCTAssertTrue(app.alerts["Event settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.alerts["Event settings"].staticTexts["Rallyroo settings saved."].exists)
    }

    func testConnectedCalendarHasVisibleSyncAndEditableName() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_CALENDAR_SOURCE"] = "1"
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        app.buttons["Connected calendars"].tap()
        XCTAssertTrue(app.navigationBars["Calendars"].waitForExistence(timeout: 5))
        app.buttons["calendar-source-00000000-0000-4000-8000-000000000301"].tap()

        XCTAssertTrue(app.navigationBars["Calendar details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["sync-calendar-now"].exists)
        let name = app.textFields["calendar-source-name"]
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20))
        name.typeText("Santiago AYSO Soccer")
        app.buttons["save-calendar-source"].tap()

        XCTAssertTrue(app.staticTexts["Santiago AYSO Soccer"].waitForExistence(timeout: 5))
        app.buttons["calendar-source-00000000-0000-4000-8000-000000000301"].tap()
        XCTAssertTrue(app.buttons["sync-calendar-now"].waitForExistence(timeout: 5))
        app.buttons["sync-calendar-now"].tap()
        XCTAssertTrue(app.navigationBars["Calendars"].waitForExistence(timeout: 5))
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
