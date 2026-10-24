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

struct RallyrooHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 14) {
            Image("FamilyHero")
                .resizable()
                .scaledToFit()
                .frame(width: 116, height: 76)
                .clipShape(RoundedRectangle(cornerRadius: 18))
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.title2.bold())
                    .foregroundStyle(AppTheme.purple)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
    }
}
