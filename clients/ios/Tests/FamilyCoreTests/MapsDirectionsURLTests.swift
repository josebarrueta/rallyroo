import XCTest
@testable import FamilyCore

final class MapsDirectionsURLTests: XCTestCase {
    func testBuildsDrivingDirectionsFromTravelOriginToEventDestination() throws {
        let url = try XCTUnwrap(MapsDirectionsURL.make(
            origin: "1 Market Street, San Francisco",
            destination: "San Jose Diridon Station"
        ))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))

        XCTAssertEqual(components.scheme, "https")
        XCTAssertEqual(components.host, "maps.apple.com")
        XCTAssertEqual(Set(components.queryItems ?? []), Set([
            URLQueryItem(name: "saddr", value: "1 Market Street, San Francisco"),
            URLQueryItem(name: "daddr", value: "San Jose Diridon Station"),
            URLQueryItem(name: "dirflg", value: "d"),
        ]))
    }

    func testOmitsOriginSoMapsUsesCurrentLocationWhenOnlyDestinationIsKnown() throws {
        let url = try XCTUnwrap(MapsDirectionsURL.make(origin: nil, destination: "Caltrain Station"))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))

        XCTAssertNil(components.queryItems?.first(where: { $0.name == "saddr" }))
        XCTAssertEqual(
            components.queryItems?.first(where: { $0.name == "daddr" })?.value,
            "Caltrain Station"
        )
    }

    func testRejectsAnEmptyDestination() {
        XCTAssertNil(MapsDirectionsURL.make(origin: "Home", destination: "   "))
    }
}
