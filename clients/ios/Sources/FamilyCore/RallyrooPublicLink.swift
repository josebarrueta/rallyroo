import Foundation

/// Public destinations available before and after sign-in, without account data.
public enum RallyrooPublicLink: String, CaseIterable, Identifiable, Sendable {
    case privacy
    case terms
    case support

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .privacy: "Privacy Policy"
        case .terms: "Terms of Service"
        case .support: "Support"
        }
    }

    public var url: URL {
        URL(string: "https://rallyroo.dev/\(rawValue)")!
    }
}
