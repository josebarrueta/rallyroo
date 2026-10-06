import AuthenticationServices
import SwiftUI
import FamilyCore

struct SessionGateView<Content: View>: View {
    @StateObject private var viewModel: SessionGateViewModel
    private let content: (AuthSession, SignOutAction, DeleteAccountAction) -> Content

    init(
        authentication: any Authentication,
        onSessionEnded: @escaping @Sendable () async -> Void = {},
        @ViewBuilder content: @escaping (
            AuthSession,
            SignOutAction,
            DeleteAccountAction
        ) -> Content
    ) {
        _viewModel = StateObject(wrappedValue: SessionGateViewModel(
            authentication: authentication,
            onSessionEnded: onSessionEnded
        ))
        self.content = content
    }

    var body: some View {
        Group {
            if let session = viewModel.session {
                content(
                    session,
                    SignOutAction {
                        Task { await viewModel.signOut() }
                    },
                    DeleteAccountAction {
                        try await viewModel.deleteAccount()
                    }
                )
            } else if viewModel.isLoading {
                ProgressView("Getting the family together…")
                    .tint(AppTheme.coral)
            } else {
                SignInView(viewModel: viewModel)
            }
        }
        .task { await viewModel.restoreSession() }
        .onOpenURL { viewModel.acceptInvitationURL($0) }
    }
}

@MainActor
final class SessionGateViewModel: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var isLoading = true
    @Published private(set) var errorMessage: String?
    @Published var invitationCode = ""
    private let authentication: any Authentication
    private let onSessionEnded: @Sendable () async -> Void

    init(
        authentication: any Authentication,
        onSessionEnded: @escaping @Sendable () async -> Void = {}
    ) {
        self.authentication = authentication
        self.onSessionEnded = onSessionEnded
    }

    func restoreSession() async {
        session = try? await authentication.currentSession()
        if session == nil { await onSessionEnded() }
        isLoading = false
    }

    func signOut() async {
        do {
            try await authentication.signOut()
            await onSessionEnded()
            session = nil
        } catch {
            errorMessage = "We couldn't sign you out. Please try again."
        }
    }

    func deleteAccount() async throws {
        try await authentication.deleteAccount()
        await onSessionEnded()
        session = nil
        errorMessage = nil
    }

    func acceptInvitationURL(_ url: URL) {
        guard let invitation = FamilyInvitationLink(url: url) else { return }
        invitationCode = invitation.code
        errorMessage = nil
    }

    func clearInvitation() {
        invitationCode = ""
        errorMessage = nil
    }

    func signIn(
        with provider: AuthenticationProvider,
        invitationCode: String?
    ) async {
        isLoading = true
        defer { isLoading = false }
        do {
            session = try await authentication.signIn(
                with: provider,
                invitationCode: invitationCode
            )
            errorMessage = nil
        } catch {
            errorMessage = invitationCode == nil
                ? "We couldn't sign you in. Please try again."
                : "This invitation may have expired or already been used. Ask a parent to resend it."
        }
    }
}

struct DeleteAccountAction {
    let perform: () async throws -> Void

    init(_ perform: @escaping () async throws -> Void) {
        self.perform = perform
    }
}

struct SignOutAction {
    let perform: () -> Void

    init(_ perform: @escaping () -> Void) {
        self.perform = perform
    }
}

private struct SignInView: View {
    @ObservedObject var viewModel: SessionGateViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
            VStack(spacing: 20) {
                Image("FamilyHero")
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 140)
                    .clipShape(RoundedRectangle(cornerRadius: 28))
                    .accessibilityHidden(true)
                VStack(spacing: 6) {
                    Text("Welcome to Rallyroo")
                        .font(.largeTitle.bold())
                        .foregroundStyle(AppTheme.purple)
                    Text("Sign in to rally your family's week.")
                        .foregroundStyle(.secondary)
                }
                let code = viewModel.invitationCode.trimmingCharacters(in: .whitespacesAndNewlines)
                if code.isEmpty {
                    VStack(spacing: 8) {
                        Text("Continue to create a new Family. You'll be its organizer.")
                            .font(.subheadline.weight(.semibold))
                        Text("Family organizers must be 18 or older. Children join through a parent or guardian-authorized invitation.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .multilineTextAlignment(.center)
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("new-family-guidance")
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Family invitation ready", systemImage: "person.2.badge.plus")
                            .font(.headline)
                            .foregroundStyle(AppTheme.purple)
                        Text("Continue with Apple or Google to securely join the Family that invited you.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button("Ignore this invitation") { viewModel.clearInvitation() }
                            .font(.footnote)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(AppTheme.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityIdentifier("family-invitation-status")
                }
                VStack(spacing: 12) {
                    AppleOAuthButton {
                        Task {
                            await viewModel.signIn(
                                with: .apple,
                                invitationCode: code.isEmpty ? nil : code
                            )
                        }
                    }
                    .frame(height: 48)
                    .accessibilityLabel(code.isEmpty ? "Continue with Apple" : "Accept invitation with Apple")
                    .accessibilityIdentifier("sign-in-apple")

                    Button {
                        Task {
                            await viewModel.signIn(
                                with: .google,
                                invitationCode: code.isEmpty ? nil : code
                            )
                        }
                    } label: {
                        Label(
                            code.isEmpty ? "Continue with Google" : "Accept invitation with Google",
                            systemImage: "person.crop.circle.badge.checkmark"
                        )
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(OAuthButtonStyle(background: AppTheme.coral))
                    .font(.body)
                    .accessibilityIdentifier("sign-in-google")
                }
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
                VStack(spacing: 8) {
                    Text("By continuing, you agree to the Terms and acknowledge the Privacy Policy.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    ViewThatFits {
                        HStack(spacing: 24) { legalLinks }
                        VStack(spacing: 12) { legalLinks }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
            }
            .background(AppTheme.background.ignoresSafeArea())
        }
    }

    @ViewBuilder private var legalLinks: some View {
        Link("Terms", destination: URL(string: "https://rallyroo.dev/terms")!)
            .accessibilityLabel("Terms of Service")
        Link("Privacy", destination: URL(string: "https://rallyroo.dev/privacy")!)
            .accessibilityLabel("Privacy Policy")
    }
}

private struct OAuthButtonStyle: ButtonStyle {
    let background: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(.white)
            .background(background.opacity(configuration.isPressed ? 0.8 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .circular))
    }
}

private struct AppleOAuthButton: UIViewRepresentable {
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .continue, style: .black)
        button.cornerRadius = 6
        button.addTarget(
            context.coordinator,
            action: #selector(Coordinator.activate),
            for: .touchUpInside
        )
        return button
    }

    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
    }

    final class Coordinator: NSObject {
        var action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        @objc func activate() {
            action()
        }
    }
}
