import Foundation
import XCTest
@testable import FamilyCore

final class RemoteLocationSearchTests: XCTestCase {
    func testRemoteSuggestionsDeclareTheirActualProvider() {
        let search = RemoteLocationSearch(baseURL: URL(string: "https://api.example.com")!)
        XCTAssertEqual(search.attribution, .googleMaps)
    }

    func testUnavailableLocalSearchDoesNotFalselyAttributeGoogle() {
        XCTAssertNil(EmptyLocationSearch().attribution)
    }

    func testSearchesAddressesThroughRallyrooBackend() async throws {
        let expected = [LocationSuggestion(
            id: "place-1",
            address: "123 Main St, Springfield, IL, USA"
        )]
        let transport = LocationHTTPTransport(response: HTTPResponse(
            statusCode: 200,
            body: try JSONEncoder().encode(expected)
        ))
        let search = RemoteLocationSearch(
            baseURL: URL(string: "https://api.example.com")!,
            transport: transport
        )

        let suggestions = try await search.suggestions(for: "123 Main")
        XCTAssertEqual(suggestions, expected)
        let recordedRequest = await transport.recordedRequest()
        let request = try XCTUnwrap(recordedRequest)
        XCTAssertEqual(request.url.path, "/v1/locations/search")
        XCTAssertEqual(URLComponents(url: request.url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "q" })?.value, "123 Main")
    }
}

private actor LocationHTTPTransport: HTTPTransport {
    let response: HTTPResponse
    private var request: HTTPRequest?
    init(response: HTTPResponse) { self.response = response }
    func send(_ request: HTTPRequest) async throws -> HTTPResponse { self.request = request; return response }
    func recordedRequest() -> HTTPRequest? { request }
}
