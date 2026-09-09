import XCTest
@testable import FamilyCore

@MainActor
final class CommuterSettingsModelTests: XCTestCase {
    func testLoadsStateWhenCatalogIsUnavailable() async {
        let store = CommuterSettingsStoreStub(states: [commuterState(installation: nil)], catalogError: TestError.failed)
        let model = CommuterSettingsModel(store: store)

        await model.load()

        XCTAssertNotNil(model.state)
        XCTAssertNil(model.catalog)
        XCTAssertNil(model.errorMessage)
    }

    func testEnablingReloadsTheAuthoritativeState() async {
        let enabled = CommuterInstallation(enabledByMemberID: "parent-1", status: .enabled)
        let store = CommuterSettingsStoreStub(states: [
            commuterState(installation: nil),
            commuterState(installation: enabled),
        ])
        let model = CommuterSettingsModel(store: store)
        await model.load()

        let succeeded = await model.enable()

        let enableCount = await store.enableCount()
        XCTAssertTrue(succeeded)
        XCTAssertEqual(model.state?.installation, enabled)
        XCTAssertEqual(enableCount, 1)
    }

    func testFailedCreationKeepsTheFormOpenAndSurfacesAnError() async {
        let store = CommuterSettingsStoreStub(
            states: [commuterState(installation: CommuterInstallation(
                enabledByMemberID: "parent-1",
                status: .enabled
            ))],
            createError: TestError.failed
        )
        let model = CommuterSettingsModel(store: store)
        await model.load()

        let succeeded = await model.createSubscription(subscriptionDraft)

        XCTAssertFalse(succeeded)
        XCTAssertEqual(model.errorMessage, "The commute alert could not be saved.")
    }
}

private enum TestError: Error {
    case failed
}

private let unavailableFeed = CommuterProviderFeedStatus(
    state: .unavailable,
    lastSuccessAt: nil,
    lastAttemptAt: nil
)

private func commuterState(installation: CommuterInstallation?) -> CommuterState {
    CommuterState(
        installation: installation,
        subscriptions: [],
        providerStatus: CommuterProviderStatus(catalog: unavailableFeed, realtime: unavailableFeed)
    )
}

private let subscriptionDraft = CommuteSubscriptionDraft(
    visibility: .personal,
    routeID: "*",
    directionID: "northbound",
    originStopID: "70171",
    destinationStopID: "70011",
    serviceWeekdays: [1, 2, 3, 4, 5],
    windowStartMinutes: 450,
    windowEndMinutes: 540,
    alertKinds: [.delay, .cancellation],
    minimumDelayMinutes: 15
)

private actor CommuterSettingsStoreStub: CommuterStore {
    private var states: [CommuterState]
    private let catalogError: Error?
    private let createError: Error?
    private var enabled = 0

    init(
        states: [CommuterState],
        catalogError: Error? = nil,
        createError: Error? = nil
    ) {
        self.states = states
        self.catalogError = catalogError
        self.createError = createError
    }

    func state() throws -> CommuterState {
        if states.count > 1 { return states.removeFirst() }
        return states[0]
    }

    func catalog() throws -> CaltrainCatalog {
        if let catalogError { throw catalogError }
        return CaltrainCatalog(status: unavailableFeed, observedAt: nil, stops: [])
    }

    func enable() -> CommuterInstallation {
        enabled += 1
        return CommuterInstallation(enabledByMemberID: "parent-1", status: .enabled)
    }

    func disable() {}
    func removeModule() {}

    func createSubscription(_ draft: CommuteSubscriptionDraft) throws -> CommuteSubscription {
        if let createError { throw createError }
        fatalError("Not needed by this test")
    }

    func setStatus(
        _ status: CommuteSubscriptionStatus,
        for subscription: CommuteSubscription
    ) -> CommuteSubscription {
        subscription
    }

    func remove(_ subscription: CommuteSubscription) {}

    func enableCount() -> Int { enabled }
}
