import Foundation

public enum MapsDirectionsURL {
    public static func make(origin: String?, destination: String) -> URL? {
        let destination = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destination.isEmpty else { return nil }

        let origin = origin?.trimmingCharacters(in: .whitespacesAndNewlines)
        var components = URLComponents()
        components.scheme = "https"
        components.host = "maps.apple.com"
        components.path = "/"
        components.queryItems = [
            origin.flatMap { $0.isEmpty ? nil : URLQueryItem(name: "saddr", value: $0) },
            URLQueryItem(name: "daddr", value: destination),
            URLQueryItem(name: "dirflg", value: "d"),
        ].compactMap { $0 }
        return components.url
    }
}
