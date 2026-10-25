import Foundation

/// Matches only the fields supplied by the caller; data access stays with the owning feature.
public enum AppSearch {
    public static func matches(_ query: String, in fields: [String]) -> Bool {
        let terms = query.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return terms.allSatisfy { term in
            fields.contains { field in
                field.range(of: term, options: [.caseInsensitive, .diacriticInsensitive], locale: .current) != nil
            }
        }
    }
}
