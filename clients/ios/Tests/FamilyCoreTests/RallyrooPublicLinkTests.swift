import Foundation
import XCTest
@testable import FamilyCore

final class RallyrooPublicLinkTests: XCTestCase {
    func testExactHTTPSURLs() {
        XCTAssertEqual(RallyrooPublicLink.privacy.url.absoluteString, "https://rallyroo.dev/privacy")
        XCTAssertEqual(RallyrooPublicLink.terms.url.absoluteString, "https://rallyroo.dev/terms")
        XCTAssertEqual(RallyrooPublicLink.support.url.absoluteString, "https://rallyroo.dev/support")
        for link in RallyrooPublicLink.allCases {
            XCTAssertEqual(link.url.scheme, "https")
            XCTAssertEqual(link.url.host, "rallyroo.dev")
            XCTAssertEqual(link.url.path, "/\(link.rawValue)")
        }
    }

    func testExactTitles() {
        XCTAssertEqual(RallyrooPublicLink.privacy.title, "Privacy Policy")
        XCTAssertEqual(RallyrooPublicLink.terms.title, "Terms of Service")
        XCTAssertEqual(RallyrooPublicLink.support.title, "Support")
    }

    func testAllCasesAreCompleteAndUnique() {
        XCTAssertEqual(RallyrooPublicLink.allCases.count, 3)
        XCTAssertEqual(Set(RallyrooPublicLink.allCases.map(\.id)), Set(["privacy", "terms", "support"]))
    }
}
