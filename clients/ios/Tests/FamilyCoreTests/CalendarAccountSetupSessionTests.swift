import XCTest
@testable import FamilyCore

final class CalendarAccountSetupSessionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func credentials() throws -> CalendarAccountCredentials {
        try JSONDecoder().decode(CalendarAccountCredentials.self, from: Data("""
        {"id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","username":"preview-user","password":"synthetic-setup-secret","createdAt":"2027-01-01T00:00:00Z","serverURL":"https://calendar.example/dav/","timeZone":"America/Los_Angeles"}
        """.utf8))
    }

    func testProvidesSettingsFieldsWithoutMakingTheUserCopyAnAccountURLAsTheServer() throws {
        let session = CalendarAccountSetupSession(credentials: try credentials(), now: now)
        XCTAssertEqual(session.copyValue(for: .server, at: now), "calendar.example")
        XCTAssertEqual(session.copyValue(for: .accountURL, at: now), "https://calendar.example/dav/")
        XCTAssertEqual(session.copyValue(for: .username, at: now), "preview-user")
        XCTAssertEqual(session.copyValue(for: .password, at: now), "synthetic-setup-secret")
    }

    func testPasswordCanBeRecopiedDuringSetupButNotAfterTheFixedTenMinuteDeadline() throws {
        let session = CalendarAccountSetupSession(credentials: try credentials(), now: now)
        XCTAssertEqual(session.expiresAt, now.addingTimeInterval(600))
        XCTAssertEqual(session.copyValue(for: .password, at: now.addingTimeInterval(599)), "synthetic-setup-secret")
        XCTAssertNil(session.copyValue(for: .password, at: now.addingTimeInterval(600)))
        XCTAssertNil(session.copyValue(for: .password, at: now.addingTimeInterval(3600)))
        XCTAssertEqual(session.copyValue(for: .username, at: now.addingTimeInterval(3600)), "preview-user")
    }

    func testClearingThePasswordCannotBeUndoneByReturningToAnEarlierTime() throws {
        var session = CalendarAccountSetupSession(credentials: try credentials(), now: now)
        session.clearPassword()
        XCTAssertNil(session.copyValue(for: .password, at: now))
        XCTAssertNil(session.copyValue(for: .password, at: now.addingTimeInterval(1)))
        XCTAssertEqual(session.copyValue(for: .server, at: now), "calendar.example")
    }

    func testClockRollbackDoesNotExposeThePasswordBeforeTheSessionWasIssued() throws {
        let session = CalendarAccountSetupSession(credentials: try credentials(), now: now)
        XCTAssertNil(session.copyValue(for: .password, at: now.addingTimeInterval(-1)))
    }

    func testDescriptionsNeverIncludeTheOneTimePassword() throws {
        let session = CalendarAccountSetupSession(credentials: try credentials(), now: now)
        XCTAssertFalse(String(describing: session).contains("synthetic-setup-secret"))
        XCTAssertFalse(String(reflecting: session).contains("synthetic-setup-secret"))
    }
}
