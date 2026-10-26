import XCTest
import UIKit

@MainActor
final class FamilyAppUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
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
        XCTAssertTrue(appleButton.isEnabled)
        XCTAssertTrue(googleButton.isEnabled)
        XCTAssertFalse(app.switches["I am 18 or older"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["new-family-guidance"].exists)
        app.swipeUp()
        XCTAssertTrue(app.buttons["Terms of Service"].exists)
        XCTAssertTrue(app.buttons["Privacy Policy"].exists)
        XCTAssertEqual(appleButton.frame.width, googleButton.frame.width, accuracy: 1)
        XCTAssertEqual(appleButton.frame.height, googleButton.frame.height, accuracy: 1)
        XCTAssertFalse(app.textFields["Invitation code (optional)"].exists)
    }

    func testExpiredSessionReturnsToLoginWithoutRestartingTheApp() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_EXPIRE_SESSION"] = "1"
        app.launchArguments += ["-RallyrooLastAuthenticationProvider", "apple"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Your session expired. Sign in again to continue."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Welcome to Rallyroo"].exists)
        XCTAssertTrue(app.staticTexts["Previously signed in with Apple"].exists)
    }

    func testLoginRemindsTheMemberWhichProviderTheyUsedPreviously() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "1"
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "remote"
        app.launchEnvironment["RALLYROO_REMOTE_BASE_URL"] = "http://127.0.0.1:3199"
        app.launchArguments += ["-RallyrooLastAuthenticationProvider", "google"]
        app.launch()

        XCTAssertTrue(app.staticTexts["Welcome to Rallyroo"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Previously signed in with Google"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["last-sign-in-provider"].exists)
    }

    func testInvitationDeepLinkKeepsBothOAuthControlsEnabledAndCanBeIgnored() throws {
        guard #available(iOS 16.4, *) else { throw XCTSkip("Opening URLs requires iOS 16.4") }
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "1"
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "remote"
        app.launchEnvironment["RALLYROO_REMOTE_BASE_URL"] = "http://127.0.0.1:3199"
        app.launch()
        XCTAssertTrue(app.staticTexts["Welcome to Rallyroo"].waitForExistence(timeout: 10))
        app.open(URL(string: "rallyroo://invite?code=public-ui-test-invitation")!)
        XCTAssertTrue(app.staticTexts["Family invitation ready"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Accept invitation with Apple"].isEnabled)
        XCTAssertTrue(app.buttons["Accept invitation with Google"].isEnabled)
        XCTAssertFalse(app.switches["I am 18 or older"].exists)
        app.buttons["Ignore this invitation"].tap()
        XCTAssertTrue(app.buttons["Continue with Apple"].isEnabled)
        XCTAssertTrue(app.buttons["Continue with Google"].isEnabled)
    }

    func testSignInControlsAndErrorsRemainReachableWithAccessibilityTextInLandscape() {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "1"
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "remote"
        app.launchEnvironment["RALLYROO_REMOTE_BASE_URL"] = "http://127.0.0.1:3199"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Welcome to Rallyroo"].waitForExistence(timeout: 10))
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let google = app.buttons["sign-in-google"]
        centerSignInControl(google, in: app)
        XCTAssertTrue(google.isEnabled)
        XCTAssertTrue(google.isHittable)
        google.tap()
        // Cancel the real system OAuth session to exercise the public error path.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.buttons["Cancel"].waitForExistence(timeout: 3) {
            springboard.buttons["Cancel"].tap()
        } else if app.buttons["Cancel"].waitForExistence(timeout: 3) {
            app.buttons["Cancel"].tap()
        }
        let error = app.staticTexts["We couldn't sign you in. Please try again."]
        XCTAssertTrue(error.waitForExistence(timeout: 10))
        for _ in 0..<8 where !error.isHittable { app.swipeUp() }
        XCTAssertTrue(error.isHittable)
        let terms = app.buttons["Terms of Service"]
        for _ in 0..<8 where !terms.isHittable { app.swipeUp() }
        XCTAssertTrue(terms.isHittable)
        let apple = app.buttons["sign-in-apple"]
        centerSignInControl(apple, in: app)
        XCTAssertTrue(apple.isEnabled)
        XCTAssertTrue(apple.isHittable)
    }

    private func centerSignInControl(_ element: XCUIElement, in app: XCUIApplication) {
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<20 {
            let center = element.frame.midY
            if element.isHittable && center > 100 && center < app.frame.height - 70 { return }
            let goingUp = center > app.frame.height - 70
            scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: goingUp ? 0.7 : 0.4))
                .press(forDuration: 0.05, thenDragTo: scroll.coordinate(
                    withNormalizedOffset: CGVector(dx: 0.5, dy: goingUp ? 0.4 : 0.7)
                ))
        }
    }

    func testAlertsTabBadgeClearsWhenTheUnreadAlertIsRead() throws {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let alerts = app.tabBars.buttons["Alerts"]
        alerts.tap()
        XCTAssertTrue(app.staticTexts["1 unread Alerts"].waitForExistence(timeout: 5))
        // iOS 26 does not expose native badge digits to XCTest. Verify the rendered
        // badge alongside the readable count, using only the public tab-bar image.
        XCTAssertTrue(try visibleTabBarHasBadge(in: app))
        let brief = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Your Day Brief")).firstMatch
        XCTAssertTrue(brief.waitForExistence(timeout: 5))
        brief.tap()
        XCTAssertTrue(app.navigationBars["Day Brief"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["0 unread Alerts"].waitForExistence(timeout: 5))
        XCTAssertFalse(try visibleTabBarHasBadge(in: app))
    }

    func testMarkAllAlertsReadClearsTheVisibleBadge() throws {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Alerts"].tap()
        XCTAssertTrue(app.staticTexts["1 unread Alerts"].waitForExistence(timeout: 5))
        app.buttons["alerts-actions-menu"].tap()
        app.buttons["Mark all read"].tap()
        XCTAssertTrue(app.staticTexts["0 unread Alerts"].waitForExistence(timeout: 5))
        XCTAssertFalse(try visibleTabBarHasBadge(in: app))
    }

    func testDeleteAllAlertsClearsTheInboxAndVisibleBadge() throws {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Alerts"].tap()
        XCTAssertTrue(app.staticTexts["1 unread Alerts"].waitForExistence(timeout: 5))
        app.buttons["alerts-actions-menu"].tap()
        app.buttons["alerts-delete-all"].tap()
        XCTAssertTrue(app.buttons["Delete All Alerts"].waitForExistence(timeout: 5))
        app.buttons["Delete All Alerts"].tap()
        XCTAssertTrue(app.staticTexts["You're all caught up"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["alerts-actions-menu"].exists)
        XCTAssertTrue(app.staticTexts["0 unread Alerts"].waitForExistence(timeout: 5))
        XCTAssertFalse(try visibleTabBarHasBadge(in: app))
    }

    func testAlertActionsStayCompactAtLargestTextSizeAndDeletionCanBeCancelled() throws {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Alerts"].tap()
        let actions = app.buttons["alerts-actions-menu"]
        XCTAssertTrue(actions.waitForExistence(timeout: 5))
        XCTAssertTrue(actions.isHittable)
        // Native toolbar chrome owns the hit region; verify compact visible bounds.
        XCTAssertLessThanOrEqual(actions.frame.width, 64)
        XCTAssertLessThanOrEqual(actions.frame.height, 64)
        XCTAssertFalse(app.buttons["Mark all read"].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Alerts at largest accessibility text size"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        actions.tap()
        XCTAssertTrue(app.buttons["Mark all read"].waitForExistence(timeout: 5))
        app.buttons["alerts-delete-all"].tap()
        XCTAssertTrue(app.buttons["Delete All Alerts"].waitForExistence(timeout: 5))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(actions.waitForExistence(timeout: 5))
        actions.tap()
        // An unread-only action still being available proves Cancel preserved read state.
        XCTAssertTrue(app.buttons["Mark all read"].waitForExistence(timeout: 5))
    }

    func testDeletingTheUnreadAlertClearsTheVisibleBadge() throws {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Alerts"].tap()
        XCTAssertTrue(app.staticTexts["1 unread Alerts"].waitForExistence(timeout: 5))
        let brief = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Your Day Brief")).firstMatch
        brief.swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["0 unread Alerts"].waitForExistence(timeout: 5))
        XCTAssertFalse(try visibleTabBarHasBadge(in: app))
    }

    private func visibleTabBarHasBadge(in app: XCUIApplication) throws -> Bool {
        let image = try XCTUnwrap(app.tabBars.firstMatch.screenshot().image.cgImage)
        var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
        try pixels.withUnsafeMutableBytes { buffer in
            let context = try XCTUnwrap(CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ))
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        // The native red badge is the only red surface in this fixture's tab bar.
        // Avoid single-glyph OCR, which is unreliable for small SE badge digits.
        let redPixels = stride(from: 0, to: pixels.count, by: 4).filter {
            pixels[$0] > 170 && pixels[$0 + 1] < 110 && pixels[$0 + 2] < 110 && pixels[$0 + 3] > 200
        }.count
        return redPixels > 20
    }

    func testUserCanSignOutFromSettings() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()

        let signOut = app.buttons["Sign Out"]
        for _ in 0..<6 where !signOut.exists { app.swipeUp() }
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

    func testParentExplicitlySelectsAndDeselectsAllPantryItemsWithoutShoppingOptIn() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_EXPENSES"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_RECEIPT"] = "1"
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-household"].tap()
        app.buttons["Expenses"].tap()
        XCTAssertTrue(app.buttons["Add expense"].waitForExistence(timeout: 5))
        app.buttons["Add expense"].tap()
        app.buttons["Preview test receipt"].tap()
        let selectAll = app.buttons["receipt-select-all-pantry"]
        XCTAssertTrue(selectAll.waitForExistence(timeout: 5))
        XCTAssertEqual(selectAll.label, "Select all Pantry items")
        selectAll.tap()
        XCTAssertEqual(app.buttons["Add Milk to Pantry"].value as? String, "Selected")
        XCTAssertEqual(app.buttons["Add Bread to Pantry"].value as? String, "Selected")
        XCTAssertEqual(app.buttons["Request Milk for future Shopping"].value as? String, "Not selected")
        XCTAssertEqual(app.buttons["Request Bread for future Shopping"].value as? String, "Not selected")
        XCTAssertEqual(selectAll.label, "Deselect all Pantry items")
        selectAll.tap()
        XCTAssertEqual(app.buttons["Add Milk to Pantry"].value as? String, "Not selected")
        XCTAssertEqual(app.buttons["Add Bread to Pantry"].value as? String, "Not selected")
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
        XCTAssertTrue(app.staticTexts["Tap to view your weather, timeline, and reminders."].exists)
        XCTAssertFalse(app.staticTexts["It will warm up this afternoon. 8:15 AM School drop-off at Lincoln Elementary."].exists)
        alert.tap()

        XCTAssertTrue(app.navigationBars["Day Brief"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Hello, José."].exists)
        XCTAssertTrue(app.staticTexts["Your morning has one commitment, with the rest of the day looking open."].exists)
        XCTAssertFalse(app.staticTexts["You drive to School drop-off at 8:15 AM."].exists)
        reveal(app.descendants(matching: .any)["day-brief-weather"], in: app)
        XCTAssertTrue(app.staticTexts["Clear skies"].exists)
        XCTAssertTrue(app.staticTexts["High 68°F · Low 50°F"].exists)
        reveal(app.descendants(matching: .any)["day-brief-weather-sources"], in: app)
        reveal(app.staticTexts["School drop-off"], in: app)
        XCTAssertTrue(app.staticTexts["You drive"].exists)
        XCTAssertTrue(app.staticTexts["Lincoln Elementary"].exists)
    }

    func testScheduleCreateMenuOpensEventEditor() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        openAddEvent(in: app)
        XCTAssertTrue(app.navigationBars["Add Event"].waitForExistence(timeout: 5))
    }

    func testEventAlertAppearsOnlyAfterSelectingAParticipant() {
        let app = localApp()
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        openAddEvent(in: app)
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
        openAddEvent(in: app)

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
        openAddEvent(in: app)
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
        openAddEvent(in: app)
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
        openAddEvent(in: app)
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
        openAddEvent(in: app)
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

    func testMonthCalendarSwipesBothWaysAndKeepsArrowNavigation() throws {
        let app = localApp()
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-view-menu"].tap()
        app.buttons["Month"].tap()

        let calendar = Calendar.autoupdatingCurrent
        let month = try XCTUnwrap(calendar.dateInterval(of: .month, for: .now)?.start)
        let next = try XCTUnwrap(calendar.date(byAdding: .month, value: 1, to: month))
        let previous = try XCTUnwrap(calendar.date(byAdding: .month, value: -1, to: month))
        let title = app.staticTexts["schedule-month-title"]
        let grid = app.otherElements["schedule-month-grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))
        XCTAssertEqual(title.label, month.formatted(.dateTime.month(.wide).year()))

        // Cover a slow, held drag as well as quick flicks and repeated paging.
        grid.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)).press(
            forDuration: 0.05,
            thenDragTo: grid.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.5)),
            withVelocity: .slow,
            thenHoldForDuration: 1.5
        )
        XCTAssertEqual(title.label, next.formatted(.dateTime.month(.wide).year()))
        grid.swipeLeft()
        let following = try XCTUnwrap(calendar.date(byAdding: .month, value: 2, to: month))
        XCTAssertEqual(title.label, following.formatted(.dateTime.month(.wide).year()))
        grid.swipeRight()
        XCTAssertEqual(title.label, next.formatted(.dateTime.month(.wide).year()))
        grid.swipeRight()
        XCTAssertEqual(title.label, month.formatted(.dateTime.month(.wide).year()))
        grid.swipeRight()
        XCTAssertEqual(title.label, previous.formatted(.dateTime.month(.wide).year()))

        app.buttons["schedule-next-page"].tap()
        XCTAssertEqual(title.label, month.formatted(.dateTime.month(.wide).year()))
        app.buttons["schedule-previous-page"].tap()
        XCTAssertEqual(title.label, previous.formatted(.dateTime.month(.wide).year()))
    }

    func testMonthPagerFitsASixWeekMonthWithoutClippingTheLastRow() throws {
        let app = localApp()
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-view-menu"].tap()
        app.buttons["Month"].tap()

        let calendar = Calendar.autoupdatingCurrent
        let grid = app.otherElements["schedule-month-grid"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))
        var month = try XCTUnwrap(calendar.dateInterval(of: .month, for: .now))
        var lastShownDay = month.start
        var foundSixWeeks = false
        for _ in 0..<12 {
            let firstWeek = try XCTUnwrap(calendar.dateInterval(of: .weekOfYear, for: month.start))
            let lastDay = try XCTUnwrap(calendar.date(byAdding: .day, value: -1, to: month.end))
            let lastWeek = try XCTUnwrap(calendar.dateInterval(of: .weekOfYear, for: lastDay))
            let days = calendar.dateComponents([.day], from: firstWeek.start, to: lastWeek.end).day
            if days == 42 {
                foundSixWeeks = true
                lastShownDay = try XCTUnwrap(calendar.date(byAdding: .day, value: -1, to: lastWeek.end))
                break
            }
            grid.swipeLeft()
            month = try XCTUnwrap(calendar.dateInterval(of: .month, for: month.end))
        }
        XCTAssertTrue(foundSixWeeks)
        XCTAssertEqual(app.staticTexts["schedule-month-title"].label, month.start.formatted(.dateTime.month(.wide).year()))
        XCTAssertEqual(grid.buttons.count, 42, "Only the current page's dates should be accessible")
        app.swipeUp()
        XCTAssertTrue(grid.buttons[lastShownDay.formatted(.dateTime.weekday(.wide).month(.wide).day())].isHittable)
    }

    func testPartialMonthDragsSettleBackWithoutChangingTheMonth() throws {
        let app = localApp()
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-view-menu"].tap()
        app.buttons["Month"].tap()

        let grid = app.otherElements["schedule-month-grid"]
        let title = app.staticTexts["schedule-month-title"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))
        let originalTitle = title.label
        let start = grid.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        // More than the former 50-point threshold, but well short of a full page.
        // Holding removes flick velocity: both directions must settle back.
        let distance = grid.frame.width * 0.2
        for direction in [-1.0, 1.0] {
            start.press(
                forDuration: 0.05,
                thenDragTo: start.withOffset(CGVector(dx: distance * direction, dy: 0)),
                withVelocity: .slow,
                thenHoldForDuration: 1.5
            )
            XCTAssertEqual(title.label, originalTitle)
        }

        grid.swipeLeft()
        let next = try XCTUnwrap(Calendar.autoupdatingCurrent.date(byAdding: .month, value: 1, to: .now))
        XCTAssertEqual(title.label, next.formatted(.dateTime.month(.wide).year()))
    }

    func testMonthCalendarStillSelectsDaysAndScrollsVerticallyWithoutPaging() throws {
        let app = localApp()
        // Make the calendar scrollable even on tall phones; also cover accessible text sizes.
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-view-menu"].tap()
        app.buttons["Month"].tap()

        let calendar = Calendar.autoupdatingCurrent
        let month = try XCTUnwrap(calendar.dateInterval(of: .month, for: .now)?.start)
        let dayOffset = calendar.component(.day, from: .now) == 1 ? 1 : 0
        let day = try XCTUnwrap(calendar.date(byAdding: .day, value: dayOffset, to: month))
        let grid = app.otherElements["schedule-month-grid"]
        let title = app.staticTexts["schedule-month-title"]
        XCTAssertTrue(grid.waitForExistence(timeout: 5))
        let originalTitle = title.label
        let dayButton = grid.buttons[day.formatted(.dateTime.weekday(.wide).month(.wide).day())]
        XCTAssertFalse(dayButton.isSelected)
        dayButton.tap()
        XCTAssertTrue(dayButton.isSelected)
        XCTAssertEqual(title.label, originalTitle)

        // At large text sizes the grid extends under the tab bar. Use only its
        // visible region so the test never accidentally taps or drags a tab.
        let top = max(grid.frame.minY, app.navigationBars.firstMatch.frame.maxY) + 12
        let bottom = min(grid.frame.maxY, app.tabBars.firstMatch.frame.minY) - 12
        XCTAssertGreaterThan(bottom - top, 40)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let middle = origin.withOffset(CGVector(dx: app.frame.midX, dy: (top + bottom) / 2))
        middle.press(forDuration: 0.05, thenDragTo: middle.withOffset(CGVector(dx: -15, dy: 0)))
        XCTAssertEqual(title.label, originalTitle, "A small drag must not change months")

        let originalY = grid.frame.minY
        let start = origin.withOffset(CGVector(dx: app.frame.midX, dy: bottom))
        let end = origin.withOffset(CGVector(dx: app.frame.midX, dy: top))
        start.press(forDuration: 0.05, thenDragTo: end)
        XCTAssertEqual(title.label, originalTitle, "Vertical scrolling must not change months")
        XCTAssertLessThan(grid.frame.minY, originalY - 20, "The calendar gesture must not block vertical list scrolling")
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
        openAddEvent(in: firstLaunch)
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

    func testRecurringOccurrenceDeleteSheetWorksAtMaximumAccessibilityTextSize() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_OCCURRENCE_LIFECYCLE"] = "1"
        app.launchArguments += [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()

        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let skipped = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", "Skipped practice")
        ).firstMatch
        XCTAssertTrue(skipped.waitForExistence(timeout: 5))
        skipped.press(forDuration: 1)
        app.buttons["Delete skipped"].tap()

        XCTAssertTrue(app.navigationBars["Delete occurrence"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Skipped practice"].exists)
        let thisOccurrence = app.buttons["occurrence-scope-this-occurrence"]
        let thisWeekdayFuture = app.buttons["occurrence-scope-this-weekday-future"]
        let allFuture = app.buttons["occurrence-scope-all-future"]
        XCTAssertTrue(thisOccurrence.exists)
        XCTAssertTrue(thisWeekdayFuture.exists)
        XCTAssertTrue(allFuture.exists)

        let confirm = app.buttons["confirm-occurrence-action"]
        allFuture.tap()
        XCTAssertEqual(confirm.label, "Delete all future occurrences")
        thisWeekdayFuture.tap()
        XCTAssertEqual(confirm.label, "Delete this weekday and future occurrences")
        thisOccurrence.tap()
        XCTAssertEqual(confirm.label, "Delete only this occurrence")
        confirm.tap()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 5))
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

    func testSharedScreenshotColdLaunchSingleEventReviewAndExplicitSave() {
        let app = localApp()
        app.launch()
        addFamilyMember(named: "Alex", in: app)
        app.terminate()
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "0"
        app.launchEnvironment["RALLYROO_UI_TEST_SCREENSHOT"] = "single"
        app.launch()

        XCTAssertTrue(app.navigationBars["Review screenshot"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Creating Event drafts… This can take up to 60 seconds."].waitForExistence(timeout: 5))
        let title = app.textFields["Event or Reminder title"]
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertFalse(app.textViews["Schedule description"].exists)
        XCTAssertTrue(app.buttons["Add Event"].exists)
        title.tap()
        title.typeText(" edited")
        app.swipeUp()
        let member = app.switches["Alex"]
        reveal(member, in: app)
        member.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(member.value as? String, "1")
        XCTAssertTrue(app.buttons["Add Event"].isEnabled)
        app.buttons["Add Event"].tap()
        XCTAssertTrue(app.navigationBars["Review screenshot"].waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["School play edited"].waitForExistence(timeout: 5))
    }

    func testSharedScreenshotMixedBatchReviewAtAccessibilitySize() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SCREENSHOT"] = "batch"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Review screenshot"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Creating Event drafts… This can take up to 60 seconds."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Add selected"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.textViews["Schedule description"].exists)
        let reminder = app.switches["Reminder"]
        reveal(reminder, in: app)
        XCTAssertTrue(reminder.exists)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 5))
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<3 where !element.exists {
            app.swipeUp()
        }
        XCTAssertTrue(element.waitForExistence(timeout: 5))
    }

    private func openAddEvent(in app: XCUIApplication) {
        let createMenu = app.buttons["schedule-create-menu"]
        XCTAssertTrue(createMenu.waitForExistence(timeout: 5))
        createMenu.tap()

        let addEvent = app.buttons["Add Event"]
        XCTAssertTrue(addEvent.waitForExistence(timeout: 5))
        addEvent.tap()
        XCTAssertTrue(app.navigationBars["Add Event"].waitForExistence(timeout: 5))
    }

    private func addFamilyMember(named name: String, in app: XCUIApplication) {
        app.tabBars.buttons["Family"].tap()
        XCTAssertTrue(app.navigationBars["Family"].waitForExistence(timeout: 5))
        app.navigationBars["Family"].buttons["Add family member"].tap()
        XCTAssertTrue(app.navigationBars["Add Family Member"].waitForExistence(timeout: 5))
        app.textFields["Name"].tap()
        app.textFields["Name"].typeText(name)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5))
    }

    func testParentCanReachAndManageSavedPlacesFromSettings() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SAVED_PLACES"] = "parent"
        app.launch()
        openSavedPlaces(in: app)
        app.buttons["Add saved place"].tap()
        XCTAssertTrue(app.navigationBars["Add place"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["saved-place-visibility"].exists)
        fillSavedPlace(named: "Practice field", in: app)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["Saved places"].waitForExistence(timeout: 5))
        let saved = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Practice field")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertEqual(saved.value as? String, "Editable")
        saved.tap()
        XCTAssertTrue(app.navigationBars["Edit place"].waitForExistence(timeout: 5))
        let name = app.textFields["Name, such as Home"]
        name.tap()
        name.typeText(" west")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Practice field west"].waitForExistence(timeout: 5))
    }

    func testKidCanSavePersonalPlaceButCannotEditFamilyPlace() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SAVED_PLACES"] = "kid"
        app.launch()
        openSavedPlaces(in: app)
        app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Family home")).firstMatch.tap()
        XCTAssertFalse(app.navigationBars["Edit place"].exists)
        app.buttons["Add saved place"].tap()
        XCTAssertTrue(app.navigationBars["Add place"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["saved-place-visibility"].exists)
        fillSavedPlace(named: "My practice field", in: app)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.navigationBars["Saved places"].waitForExistence(timeout: 5))
        let saved = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "My practice field")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertEqual(saved.value as? String, "Editable")
        XCTAssertTrue(app.staticTexts["Only me"].exists)
        saved.tap()
        XCTAssertTrue(app.navigationBars["Edit place"].waitForExistence(timeout: 5))
    }

    func testFailedSavedPlaceSaveKeepsTheDraftVisible() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SAVED_PLACES"] = "failure"
        app.launch()
        openSavedPlaces(in: app)
        app.buttons["Add saved place"].tap()
        XCTAssertTrue(app.navigationBars["Add place"].waitForExistence(timeout: 5))
        fillSavedPlace(named: "Not saved", in: app)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["The saved place could not be saved."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Add place"].exists)
        XCTAssertEqual(app.textFields["Name, such as Home"].value as? String, "Not saved")
    }

    func testAlertsUsefulContentIsVisibleWithLargestTextAndInLandscape() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Alerts"].tap()
        let unread = app.staticTexts["alerts-unread-count"]
        XCTAssertTrue(unread.waitForExistence(timeout: 5))
        XCTAssertTrue(unread.isHittable)
        XCTAssertFalse(app.descendants(matching: .any)["rallyroo-brand-header"].exists)
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        XCTAssertTrue(unread.isHittable)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Alerts landscape maximum text"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let actions = app.buttons["alerts-actions-menu"]
        let hittable = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: actions)
        XCTAssertEqual(XCTWaiter.wait(for: [hittable], timeout: 5), .completed)
    }

    func testScheduleUsefulContentIsVisibleWithLargestText() {
        let app = localApp()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        let today = app.staticTexts[Date.now.formatted(.dateTime.weekday(.wide).month().day())]
        XCTAssertTrue(today.waitForExistence(timeout: 5))
        XCTAssertTrue(today.isHittable)
        XCTAssertFalse(app.staticTexts["Let's jam!"].exists)
        XCTAssertTrue(app.buttons["schedule-create-menu"].isHittable)
    }

    private func openSavedPlaces(in app: XCUIApplication) {
        XCTAssertTrue(app.tabBars.buttons["Settings"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        let places = app.buttons["Saved places"]
        for _ in 0..<5 where !places.isHittable { app.swipeUp() }
        XCTAssertTrue(places.waitForExistence(timeout: 5))
        places.tap()
        XCTAssertTrue(app.navigationBars["Saved places"].waitForExistence(timeout: 5))
    }

    private func fillSavedPlace(named name: String, in app: XCUIApplication) {
        let nameField = app.textFields["Name, such as Home"]
        nameField.tap()
        nameField.typeText(name)
        let address = app.textFields["Street address"]
        address.tap()
        address.typeText("123 Main Street")
    }

    func testAlertPagesFiltersAndBulkReadCoverUnloadedItems() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_INBOX_PAGES"] = "1"
        app.launch()
        app.tabBars.buttons["Alerts"].tap()
        XCTAssertTrue(app.staticTexts["Page alert 6"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Page alert 4"].exists)
        app.buttons["alerts-load-more"].tap()
        XCTAssertTrue(app.staticTexts["Page alert 4"].waitForExistence(timeout: 5))
        app.segmentedControls["alerts-filter"].buttons["Unread"].tap()
        XCTAssertTrue(app.staticTexts["Page alert 5"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Page alert 6"].exists)
        app.buttons["alerts-actions-menu"].tap()
        app.buttons["Mark all read"].tap()
        XCTAssertTrue(app.staticTexts["No unread alerts"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["0 unread Alerts"].exists)
        app.segmentedControls["alerts-filter"].buttons["All"].tap()
        XCTAssertTrue(app.staticTexts["Page alert 6"].waitForExistence(timeout: 5))
        app.buttons["alerts-actions-menu"].tap()
        app.buttons["alerts-delete-all"].tap()
        app.buttons["Delete All Alerts"].tap()
        XCTAssertTrue(app.staticTexts["You're all caught up"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["alerts-load-more"].exists)
    }

    func testCachedInboxLabelsStalenessAndDoesNotOfferUncachedOlderPages() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_INBOX_PAGES"] = "1"
        app.launchEnvironment["RALLYROO_UI_TEST_INBOX_CACHED"] = "1"
        app.launch()
        app.tabBars.buttons["Alerts"].tap()
        let status = app.descendants(matching: .any)["alerts-freshness"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Page alert 6"].exists)
        XCTAssertTrue(app.buttons["Retry refresh"].exists)
        XCTAssertFalse(app.buttons["alerts-load-more"].exists)
    }

    func testEventDraftCanBeKeptRevertedOrExplicitlyDiscarded() {
        let app = localApp()
        app.launch()
        openAddEvent(in: app)
        let title = app.textFields["Title"]
        title.tap(); title.typeText("Unsaved")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.alerts["Discard unsaved changes?"].waitForExistence(timeout: 5))
        app.buttons["Keep Editing"].tap()
        XCTAssertEqual(title.value as? String, "Unsaved")
        title.tap(); title.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 7))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.alerts["Discard unsaved changes?"].exists)
        openAddEvent(in: app)
        app.textFields["Title"].tap(); app.textFields["Title"].typeText("Discard me")
        app.buttons["Cancel"].tap()
        app.buttons["Discard Changes"].tap()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 5))
    }

    func testParticipantAndArrivalChangesAreTrackedAndCanBeReverted() {
        let app = localApp()
        app.launch()
        addFamilyMember(named: "Avery", in: app)
        app.tabBars.buttons["Schedule"].tap()
        openAddEvent(in: app)
        let participant = app.switches["Avery"]
        XCTAssertEqual(participant.value as? String, "0")
        participant.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(participant.value as? String, "1")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.alerts["Discard unsaved changes?"].waitForExistence(timeout: 5))
        app.buttons["Keep Editing"].tap()
        participant.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        let arrival = app.switches["Arrive by"]
        for _ in 0..<6 where !arrival.isHittable { app.swipeUp() }
        arrival.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(arrival.value as? String, "1")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.alerts["Discard unsaved changes?"].waitForExistence(timeout: 5))
        app.buttons["Keep Editing"].tap()
        arrival.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.alerts["Discard unsaved changes?"].exists)
    }

    func testFailedEventAndReminderSavesPreserveTheirDrafts() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_DRAFT_SAVE_FAILURE"] = "1"
        app.launch()
        openAddEvent(in: app)
        app.textFields["Title"].tap(); app.textFields["Title"].typeText("Still editing event")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["The event could not be saved."].waitForExistence(timeout: 5))
        app.buttons["OK"].tap()
        XCTAssertEqual(app.textFields["Title"].value as? String, "Still editing event")
        app.buttons["Cancel"].tap(); app.buttons["Discard Changes"].tap()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Reminders"].tap()
        XCTAssertTrue(app.navigationBars["Reminders"].waitForExistence(timeout: 5))
        app.buttons["Add Reminder"].tap()
        app.textFields["Title"].tap(); app.textFields["Title"].typeText("Still editing reminder")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["The reminder could not be saved."].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["Title"].value as? String, "Still editing reminder")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.alerts["Discard unsaved changes?"].waitForExistence(timeout: 5))
    }

    func testReminderDraftRequiresExplicitDiscard() {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Reminders"].tap()
        app.buttons["Add Reminder"].tap()
        app.textFields["Title"].tap(); app.textFields["Title"].typeText("Unsaved task")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.alerts["Discard unsaved changes?"].waitForExistence(timeout: 5))
        app.buttons["Keep Editing"].tap()
        XCTAssertEqual(app.textFields["Title"].value as? String, "Unsaved task")
        app.buttons["Cancel"].tap(); app.buttons["Discard Changes"].tap()
        XCTAssertTrue(app.navigationBars["Reminders"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Unsaved task"].exists)
    }

    func testEventSearchFindsLoadedItemsOutsideTheCurrentWeek() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_IMPORTED_EVENT"] = "1"
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Rallyroo"].waitForExistence(timeout: 10))
        app.buttons["schedule-next-page"].tap()
        let search = app.searchFields.firstMatch
        if !search.isHittable { app.swipeDown() }
        search.tap(); search.typeText("CHAMPIONSHIP")
        let result = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Imported championship")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.navigationBars["Event details"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["Title"].exists)
    }

    func testReminderSearchFindsCompletedRemindersAndHasNoResultsState() {
        let app = localApp()
        app.launch()
        app.tabBars.buttons["Reminders"].tap(); app.buttons["Add Reminder"].tap()
        app.textFields["Title"].tap(); app.textFields["Title"].typeText("Café task")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.buttons["Complete reminder"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["Complete reminder"].firstMatch.tap()
        let search = app.searchFields.firstMatch
        if !search.isHittable { app.swipeDown() }
        search.tap(); search.typeText("CAFE")
        XCTAssertTrue(app.staticTexts["Café task"].waitForExistence(timeout: 5))
        search.typeText(" missing")
        XCTAssertTrue(app.staticTexts["No matching reminders"].waitForExistence(timeout: 5))
    }

    func testPantrySearchFiltersWithoutChangingTheCatalog() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_SHOPPING"] = "1"
        app.launch()
        app.buttons["schedule-household"].tap(); app.buttons["Shopping and Pantry"].tap()
        let search = app.searchFields.firstMatch
        if !search.isHittable { app.swipeDown() }
        search.tap(); search.typeText("OAT MILK")
        XCTAssertTrue(app.staticTexts["Oat milk"].waitForExistence(timeout: 5))
        search.typeText(" missing")
        XCTAssertTrue(app.staticTexts["No matching Pantry items"].waitForExistence(timeout: 5))
        app.buttons["Clear text"].tap()
        if app.buttons["Close"].exists { app.buttons["Close"].tap() }
        else if app.navigationBars["Shopping and Pantry"].buttons["Cancel"].exists {
            app.navigationBars["Shopping and Pantry"].buttons["Cancel"].tap()
        }
        let restored = app.staticTexts["Oat milk"]
        for _ in 0..<6 where !restored.isHittable { app.swipeUp() }
        XCTAssertTrue(restored.waitForExistence(timeout: 5))
    }

    func testDeniedNotificationPermissionExplainsRecoveryWithoutHidingInbox() {
        let app = localApp()
        app.launchEnvironment["RALLYROO_UI_TEST_NOTIFICATION_PERMISSION"] = "denied"
        app.launchEnvironment["RALLYROO_UI_TEST_DAY_BRIEF"] = "1"
        app.launch()
        app.tabBars.buttons["Settings"].tap()
        let status = app.staticTexts["notification-permission-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertTrue(status.label.contains("Notifications blocked"))
        XCTAssertTrue(app.buttons["Open iPhone Settings"].exists)
        XCTAssertFalse(app.buttons["Enable notifications"].exists)
        app.tabBars.buttons["Alerts"].tap()
        XCTAssertTrue(app.staticTexts["1 unread Alerts"].waitForExistence(timeout: 5))
    }

    private func localApp() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["RALLYROO_DATA_MODE"] = "local"
        app.launchEnvironment["RALLYROO_UI_TEST_RESET_STORAGE"] = "1"
        return app
    }
}
