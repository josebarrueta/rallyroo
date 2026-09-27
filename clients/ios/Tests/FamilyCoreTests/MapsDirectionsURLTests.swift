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

    func testBuildsGoogleMapsDirectionsToCoordinates() throws {
        let url = try XCTUnwrap(MapsDirectionsURL.make(
            origin: nil,
            destination: "37.4219999, -122.0840575",
            provider: .google
        ))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))

        XCTAssertEqual(components.scheme, "https")
        XCTAssertEqual(components.host, "www.google.com")
        XCTAssertEqual(components.path, "/maps/dir/")
        XCTAssertEqual(Set(components.queryItems ?? []), Set([
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "destination", value: "37.4219999, -122.0840575"),
            URLQueryItem(name: "travelmode", value: "driving"),
        ]))
    }

    func testBuildsNativeGoogleMapsDirectionsWithAnOrigin() throws {
        let url = try XCTUnwrap(MapsDirectionsURL.makeGoogleApp(
            origin: "Home",
            destination: "37.4219999, -122.0840575"
        ))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))

        XCTAssertEqual(components.scheme, "comgooglemaps")
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "saddr" })?.value, "Home")
        XCTAssertEqual(
            components.queryItems?.first(where: { $0.name == "daddr" })?.value,
            "37.4219999, -122.0840575"
        )
        XCTAssertEqual(
            components.queryItems?.first(where: { $0.name == "directionsmode" })?.value,
            "driving"
        )
    }

    func testBuildsGoogleMapsDirectionsWithAnOrigin() throws {
        let url = try XCTUnwrap(MapsDirectionsURL.make(
            origin: "Home",
            destination: "37.4219999, -122.0840575",
            provider: .google
        ))
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))

        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "origin" })?.value, "Home")
    }

    func testParsesAndEncodesACoordinateWaypoint() throws {
        let coordinate = try XCTUnwrap(GeographicCoordinate.parse("37.4219999, -122.0840575"))
        XCTAssertEqual(coordinate.latitude, 37.4219999)
        XCTAssertEqual(coordinate.longitude, -122.0840575)

        let waypoint = try TravelWaypoint(location: "37.4219999, -122.0840575")
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(waypoint)) as? [String: Any]
        )
        XCTAssertEqual(object["coordinates"] as? [String: Double], [
            "latitude": 37.4219999,
            "longitude": -122.0840575,
        ])
        XCTAssertNil(object["address"])
        XCTAssertNil(object["placeID"])
    }

    func testRejectsInvalidCoordinatesAndPreservesNormalAddresses() throws {
        XCTAssertNil(GeographicCoordinate.parse("91, -122.0840575"))
        XCTAssertNil(GeographicCoordinate.parse("37.4219999, -181"))
        XCTAssertNil(GeographicCoordinate.parse("37.4219999"))

        let waypoint = try TravelWaypoint(location: "123 Main Street")
        XCTAssertEqual(waypoint.address, "123 Main Street")
        XCTAssertNil(waypoint.coordinates)
    }

    func testRejectsAnEmptyDestinationForEitherProvider() {
        XCTAssertNil(MapsDirectionsURL.make(origin: "Home", destination: "   "))
        XCTAssertNil(MapsDirectionsURL.make(origin: "Home", destination: "   ", provider: .google))
    }
}
