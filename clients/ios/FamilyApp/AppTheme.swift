import SwiftUI

enum AppTheme {
    static let coral = Color(red: 0.96, green: 0.35, blue: 0.38)
    static let purple = Color(red: 0.44, green: 0.31, blue: 0.71)
    static let mint = Color(red: 0.33, green: 0.74, blue: 0.70)
    static let sunshine = Color(red: 1.00, green: 0.73, blue: 0.28)
    static let background = Color(red: 1.00, green: 0.97, blue: 0.91)
}

/// Compact navigation actions share an accent and symbol treatment, leaving
/// sizing and hit regions to the native toolbar. Titles remain available to VoiceOver.
struct RallyrooToolbarLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .labelStyle(.iconOnly)
            .font(.body.weight(.medium))
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .foregroundStyle(AppTheme.purple)
            .accessibilityLabel(title)
    }
}

extension Color {
    init(familyColorTag: String?) {
        switch familyColorTag?.lowercased() {
        case "red": self = .red
        case "orange": self = .orange
        case "yellow": self = .yellow
        case "green": self = .green
        case "blue": self = .blue
        case "purple": self = .purple
        case "pink": self = .pink
        default: self = .gray
        }
    }
}

/// Optional branding yields space to useful content in constrained layouts.
/// Never shrink the member's chosen text size to preserve decorative content.
struct RallyrooHeader: View {
    let title: String?
    let subtitle: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    var body: some View {
        if !dynamicTypeSize.isAccessibilitySize && verticalSizeClass != .compact {
            HStack(spacing: 12) {
                Image("FamilyHero")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 64, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    if let title {
                        Text(title)
                            .font(.headline)
                            .foregroundStyle(AppTheme.purple)
                    }
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 8)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("rallyroo-brand-header")
        }
    }
}
