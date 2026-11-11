import SwiftUI
import UniformTypeIdentifiers
import FamilyCore

struct CalendarAccountSetupView: View {
    let store: any CalendarConnectionStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var listing: CalendarAccountConnections?
    @State private var session: CalendarAccountSetupSession?
    @State private var selectedID: UUID?
    @State private var isVisible = false
    @State private var isBusy = false
    @State private var showPassword = false
    @State private var isConfirmingAccess = false
    @State private var revoking: CalendarAccountConnection?
    @State private var message: String?
    @State private var sessionNotice: String?
    @State private var copiedField: CalendarAccountSetupField?
    @State private var copiedPasswordChangeCount: Int?
    @State private var accountAdded = false

    private var accent: Color { colorScheme == .dark ? Color(red: 0.77, green: 0.68, blue: 0.98) : AppTheme.purple }
    private var passwordAvailable: Bool { session?.copyValue(for: .password) != nil }
    private var selectedConnection: CalendarAccountConnection? {
        listing?.connections.first { $0.id == selectedID }
    }
    private var serverURL: URL? { session?.serverURL ?? listing?.serverURL }
    private var username: String? { session?.username ?? selectedConnection?.username }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    introduction
                    prepareCard
                    if username != nil {
                        accountCard.id("calendar-account-fields")
                    } else {
                        CalendarSetupCard(number: "2", title: "Add the account in Settings", color: AppTheme.purple) {
                            Text("Next, copy Server, Username, and Password into Settings. Each field gets its own Copy button as soon as you create a password.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    defaultCard.id("calendar-default-step")
                    if let listing, !listing.connections.isEmpty { connectionsCard(listing, proxy: proxy) }
                    limitations
                }
                .padding(20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background((colorScheme == .dark ? Color(uiColor: .systemGroupedBackground) : AppTheme.background).ignoresSafeArea())
            .onChange(of: session?.connectionID) { id in
                guard id != nil else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                    proxy.scrollTo("calendar-account-fields", anchor: .top)
                }
            }
            .onChange(of: accountAdded) { added in
                guard added else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                    proxy.scrollTo("calendar-default-step", anchor: .top)
                }
            }
        }
        .navigationTitle("Apple Calendar")
        .navigationBarTitleDisplayMode(.inline)
        .tint(accent)
        .onAppear { isVisible = true }
        #if DEBUG
        .preferredColorScheme(ProcessInfo.processInfo.environment["RALLYROO_UI_TEST_CALDAV_DARK"] == "1" ? .dark : nil)
        #endif
        .task { await reload() }
        .task(id: session?.connectionID) {
            guard let deadline = session?.expiresAt else { return }
            do { try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow))) }
            catch { return }
            guard !Task.isCancelled else { return }
            clearPassword(notice: "Setup time expired. Your account is still active, but its password can no longer be shown or copied.")
        }
        .task(id: copiedField) {
            guard copiedField != nil else { return }
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            if !Task.isCancelled { copiedField = nil }
        }
        .onChange(of: scenePhase) { phase in
            // Mask before the app switcher snapshot, but retain the bounded,
            // memory-only setup session so the next Settings field can be copied.
            showPassword = false
            copiedField = nil
            if phase == .active, session != nil, !passwordAvailable {
                clearPassword(notice: "Setup time expired. Revoke this connection if you need a new password.")
            }
        }
        .onDisappear {
            isVisible = false
            session?.clearPassword()
            session = nil
            showPassword = false
            clearOwnedPasswordClipboard()
        }
        .alert("Allow calendar access?", isPresented: $isConfirmingAccess) {
            Button("Create password") { Task { await create() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This password lets Apple Calendar read and change your native Family events. Anyone with the password has that access. You can revoke it here at any time.")
        }
        .alert("Revoke calendar access?", isPresented: Binding(
            get: { revoking != nil }, set: { if !$0 { revoking = nil } }
        )) {
            Button("Revoke", role: .destructive) {
                let connection = revoking
                revoking = nil
                if let connection { Task { await revoke(connection) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This connection will stop syncing. Remove its account in iPhone Settings to erase the device’s cached copies. Your Family events are not deleted.")
        }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                if !dynamicTypeSize.isAccessibilitySize {
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 62, height: 62)
                        .background(AppTheme.purple, in: RoundedRectangle(cornerRadius: 20))
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text("PRIVATE PREVIEW").font(.caption.weight(.bold)).tracking(1.2).foregroundStyle(accent)
                    Text("Your Family, in Calendar.").font(.title2.bold())
                }
            }
            Text("Three steps. No typing long passwords. Connect your Family calendar, then test Apple Calendar and Siri.")
                .font(.subheadline).foregroundStyle(.secondary)
            Label("Your Google calendars stay as they are.", systemImage: "checkmark.shield")
                .font(.subheadline.weight(.medium)).foregroundStyle(accent)
        }
        .accessibilityElement(children: .contain)
    }

    private var prepareCard: some View {
        CalendarSetupCard(number: "1", title: "Create your private login", color: AppTheme.coral) {
            Text("This connects your live Family schedule. Calendar can add, edit, and delete the events that sync.")
                .font(.subheadline).foregroundStyle(.secondary)
            if listing == nil && message == nil {
                ProgressView("Checking availability…")
            } else if listing != nil {
                Button {
                    isConfirmingAccess = true
                } label: {
                    HStack {
                        if isBusy { ProgressView().tint(.white) }
                        Label(passwordAvailable ? "Setup password ready" : "Create calendar password", systemImage: "key.fill")
                            .font(.headline)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent).tint(AppTheme.purple)
                .disabled(isBusy || passwordAvailable || (listing?.connections.count ?? 0) >= 10)
                .accessibilityIdentifier("create-calendar-connection")
                if (listing?.connections.count ?? 0) >= 10 {
                    Text("You have 10 connections. Revoke one below before creating another.").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let message {
                Text(message).font(.subheadline).foregroundStyle(.secondary)
                Button("Try again") { Task { await reload() } }.disabled(isBusy)
            }
        }
    }

    private var accountCard: some View {
        CalendarSetupCard(number: "2", title: "Add the account in Settings", color: AppTheme.purple) {
            Text("Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → CalDAV")
                .font(.subheadline).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("Tap Copy, switch to Settings, and paste. Come back for the next field—your password won’t disappear just because you switch apps.")
                .font(.subheadline)
            VStack(spacing: 0) {
                fieldRow(.server, title: "Server", value: serverURL?.host ?? "")
                Divider().padding(.vertical, 12)
                fieldRow(.username, title: "Username", value: username ?? "")
                Divider().padding(.vertical, 12)
                passwordRow
            }
            .padding(16)
            .background(accent.opacity(colorScheme == .dark ? 0.08 : 0.045), in: RoundedRectangle(cornerRadius: 16))
            if let copiedField {
                Label("Copied \(fieldTitle(copiedField).lowercased()) — paste in Settings", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.medium)).foregroundStyle(accent)
                    .accessibilityIdentifier("calendar-copy-confirmation")
            }
            if passwordAvailable, let session {
                Label {
                    Text("Password held in memory until \(session.expiresAt.formatted(date: .omitted, time: .shortened)). Copies expire within 90 seconds; clipboard sharing with other devices is off.")
                } icon: { Image(systemName: "lock.shield") }
                .font(.caption).foregroundStyle(.secondary)
            }
            if let sessionNotice {
                Text(sessionNotice).font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityIdentifier("calendar-session-notice")
            }
            DisclosureGroup("Advanced settings") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Keep SSL on. Port: \(serverURL?.port ?? 443). Use any description, such as Rallyroo. Settings labels vary by iOS version.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    fieldRow(.accountURL, title: "Account URL", value: serverURL?.absoluteString ?? "")
                    if let zone = session?.timeZone ?? selectedConnection?.timeZone {
                        LabeledContent("Calendar time zone", value: zone).font(.caption)
                    }
                }.padding(.top, 10)
            }
            Button {
                accountAdded = true
            } label: {
                Label("I’ve added the account", systemImage: "arrow.right.circle.fill")
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered).accessibilityIdentifier("calendar-account-added")
            if passwordAvailable {
                Button("Finish & clear password") { clearPassword(notice: "Password cleared. Your calendar account stays active; you can still copy the server and username.") }
                    .font(.subheadline).frame(minHeight: 44)
                    .accessibilityIdentifier("calendar-clear-password")
            }
        }
    }

    private var passwordRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            fieldRow(.password, title: "Password", value: showPassword && scenePhase == .active
                ? session?.copyValue(for: .password) ?? "Unavailable" : passwordAvailable ? (dynamicTypeSize.isAccessibilitySize ? "Hidden" : "••••••••••••") : "No longer available")
            if passwordAvailable {
                Button {
                    showPassword.toggle()
                } label: {
                    Label(showPassword ? "Hide password" : "Show password", systemImage: showPassword ? "eye.slash" : "eye")
                }
                .font(.subheadline).frame(minHeight: 44)
                .disabled(scenePhase != .active)
                .accessibilityIdentifier("calendar-reveal-password")
            } else {
                Text("Passwords can’t be retrieved later. If you haven’t finished, revoke this connection below and create a new one.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func fieldRow(_ field: CalendarAccountSetupField, title: String, value: String) -> some View {
        let content = VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.callout.monospaced()).fixedSize(horizontal: false, vertical: true)
                .privacySensitive(field == .password)
                .accessibilityIdentifier("calendar-value-\(field.rawValue)")
        }
        let copyButton = Button {
            copy(field)
        } label: {
            Label(copiedField == field ? "Copied" : "Copy", systemImage: copiedField == field ? "checkmark" : "doc.on.doc")
                .font(.subheadline.weight(.semibold)).frame(minHeight: 32)
        }
        .buttonStyle(.bordered).tint(accent)
        .accessibilityLabel("Copy \(title.lowercased())")
        .accessibilityIdentifier("calendar-copy-\(field.rawValue)")
        .disabled(scenePhase != .active || (field == .password && !passwordAvailable))
        return Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) { content; copyButton }
            } else {
                HStack(alignment: .top, spacing: 12) { content.frame(maxWidth: .infinity, alignment: .leading); copyButton }
            }
        }
    }

    private var defaultCard: some View {
        CalendarSetupCard(number: "3", title: "Make it your default", color: AppTheme.mint) {
            Text("After iOS verifies the account, open Settings → Apps → Calendar → Default Calendar.")
                .font(.subheadline).foregroundStyle(.secondary)
            Text("Choose Rallyroo Family (calendar preview).")
                .font(.headline)
            Text("Rallyroo can’t select this setting for you. This changes where new events go, not your existing Google events. Restore your previous default if a test fails.")
                .font(.subheadline).foregroundStyle(.secondary)
            Label("Try: “Siri, add a test dentist appointment tomorrow at 3 PM.”", systemImage: "waveform")
                .font(.subheadline.weight(.medium)).foregroundStyle(accent)
            Text("Check the destination in Apple Calendar and Rallyroo. Siri routing still needs your iPhone test; sync may follow Fetch settings.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func connectionsCard(_ listing: CalendarAccountConnections, proxy: ScrollViewProxy) -> some View {
        CalendarSetupCard(number: nil, title: "Manage access", color: AppTheme.purple) {
            Text("A saved connection means a password was issued—not that iOS has verified the account.")
                .font(.caption).foregroundStyle(.secondary)
            ForEach(listing.connections) { connection in
                VStack(alignment: .leading, spacing: 8) {
                    Text(connection.username).font(.caption.monospaced()).lineLimit(2)
                    HStack {
                        Button("View details") {
                            if session?.connectionID != connection.id { clearPassword(notice: nil); session = nil }
                            selectedID = connection.id
                            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
                                proxy.scrollTo("calendar-account-fields", anchor: .top)
                            }
                        }
                        .disabled(isBusy || (passwordAvailable && session?.connectionID != connection.id))
                        Spacer()
                        Button("Revoke access", role: .destructive) { revoking = connection }
                            .disabled(isBusy)
                    }
                    .buttonStyle(.borderless).font(.subheadline)
                    .frame(minHeight: 44)
                }
                if connection.id != listing.connections.last?.id { Divider() }
            }
            Button("Refresh connections") { Task { await reload() } }.disabled(isBusy)
                .font(.subheadline).frame(minHeight: 44)
        }
    }

    private var limitations: some View {
        DisclosureGroup("What syncs in this preview?") {
            Text("Timed and all-day non-recurring native Family events. Recurring events, invitations, Reminders, and imported calendars aren’t supported yet. All-day dates keep their saved anchor zone. Calendar clients may deliver their own alerts. Removing an account or revoking access doesn’t erase copies already cached on a device.")
                .font(.subheadline).foregroundStyle(.secondary).padding(.top, 8)
        }
        .font(.subheadline.weight(.medium))
        .padding(.horizontal, 4)
    }

    private func fieldTitle(_ field: CalendarAccountSetupField) -> String {
        switch field { case .server: "Server"; case .username: "Username"; case .password: "Password"; case .accountURL: "Account URL" }
    }

    @MainActor private func copy(_ field: CalendarAccountSetupField) {
        guard scenePhase == .active else { return }
        let value: String?
        if let session { value = session.copyValue(for: field) }
        else {
            switch field {
            case .server: value = serverURL?.host
            case .username: value = username
            case .accountURL: value = serverURL?.absoluteString
            case .password: value = nil
            }
        }
        guard let value, !value.isEmpty else { return }
        let expiry = field == .password ? min(Date.now.addingTimeInterval(90), session?.expiresAt ?? .now) : Date.now.addingTimeInterval(90)
        UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: value]], options: [.localOnly: true, .expirationDate: expiry])
        if field == .password { copiedPasswordChangeCount = UIPasteboard.general.changeCount }
        copiedField = field
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        UIAccessibility.post(notification: .announcement, argument: "\(fieldTitle(field)) copied. Paste it into Settings.")
    }

    @MainActor private func clearOwnedPasswordClipboard() {
        if let count = copiedPasswordChangeCount, UIPasteboard.general.changeCount == count {
            UIPasteboard.general.items = []
        }
        copiedPasswordChangeCount = nil
    }

    @MainActor private func clearPassword(notice: String?) {
        session?.clearPassword()
        showPassword = false
        copiedField = nil
        sessionNotice = notice
        clearOwnedPasswordClipboard()
    }

    @MainActor private func reload() async {
        do {
            listing = try await store.connections()
            if selectedID == nil { selectedID = listing?.connections.first?.id }
            message = nil
        } catch CalendarConnectionError.unavailable { message = "The calendar preview isn’t available for this account." }
        catch { message = "Couldn’t load connections. Please try again." }
    }

    @MainActor private func create() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let created = try await store.create()
            if isVisible && !Task.isCancelled {
                clearPassword(notice: nil)
                session = CalendarAccountSetupSession(credentials: created)
                selectedID = created.id
                showPassword = false
                accountAdded = false
            }
            await reload()
        } catch { message = "Couldn’t create a password. Refresh connections before retrying; one may have been issued." }
    }

    @MainActor private func revoke(_ connection: CalendarAccountConnection) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await store.revoke(id: connection.id)
            if session?.connectionID == connection.id { clearPassword(notice: nil); session = nil }
            if selectedID == connection.id { selectedID = nil }
            await reload()
        } catch { message = "Couldn’t revoke this connection. Please try again." }
    }
}

private struct CalendarSetupCard<Content: View>: View {
    let number: String?
    let title: String
    let color: Color
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                if let number {
                    Text(number).font(.headline.bold()).foregroundStyle(.primary)
                        .frame(width: 32, height: 32).background(color.opacity(0.2), in: Circle())
                        .accessibilityHidden(true)
                }
                Text(title).font(.headline).frame(minHeight: 32, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
            }
            content
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Color.primary.opacity(0.06), lineWidth: 1))
    }
}
