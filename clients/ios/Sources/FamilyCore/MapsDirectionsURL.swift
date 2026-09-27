import Foundation

public enum MapsProvider: Sendable {
    case apple
    case google
}

public enum MapsDirectionsURL {
    public static func make(
        origin: String?,
        destination: String,
        provider: MapsProvider = .apple
    ) -> URL? {
        let destination = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destination.isEmpty else { return nil }

        let origin = origin?.trimmingCharacters(in: .whitespacesAndNewlines)
        var components = URLComponents()
        components.scheme = "https"

        switch provider {
        case .apple:
            components.host = "maps.apple.com"
            components.path = "/"
            components.queryItems = [
                origin.flatMap { $0.isEmpty ? nil : URLQueryItem(name: "saddr", value: $0) },
                URLQueryItem(name: "daddr", value: destination),
                URLQueryItem(name: "dirflg", value: "d"),
            ].compactMap { $0 }
        case .google:
            components.host = "www.google.com"
            components.path = "/maps/dir/"
            components.queryItems = [
                URLQueryItem(name: "api", value: "1"),
                origin.flatMap { $0.isEmpty ? nil : URLQueryItem(name: "origin", value: $0) },
                URLQueryItem(name: "destination", value: destination),
                URLQueryItem(name: "travelmode", value: "driving"),
            ].compactMap { $0 }
        }

        return components.url
    }

    public static func makeGoogleApp(origin: String?, destination: String) -> URL? {
        let destination = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destination.isEmpty else { return nil }

        let origin = origin?.trimmingCharacters(in: .whitespacesAndNewlines)
        var components = URLComponents()
        components.scheme = "comgooglemaps"
        components.host = ""
        components.queryItems = [
            origin.flatMap { $0.isEmpty ? nil : URLQueryItem(name: "saddr", value: $0) },
            URLQueryItem(name: "daddr", value: destination),
            URLQueryItem(name: "directionsmode", value: "driving"),
        ].compactMap { $0 }
        return components.url
    }

    public static func isCoordinate(_ value: String) -> Bool {
        GeographicCoordinate.parse(value) != nil
    }
}
