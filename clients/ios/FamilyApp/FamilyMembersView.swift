import SwiftUI
import FamilyCore

struct FamilyMembersView: View {
    @StateObject private var viewModel: FamilyMembersViewModel
    @State private var isAddingMember = false
    @State private var editingMember: FamilyMember?
    @State private var quickActivity: QuickActivitySelection?
    @State private var invitationRequest: InvitationRequest?
    private let locationSearch: any LocationSearch

    init(
        memberStore: any FamilyMemberStore,
        eventStore: any EventStore,
        reminderStore: (any ReminderStore)? = nil,
        locationSearch: any LocationSearch = EmptyLocationSearch(),
        invitationStore: (any FamilyInvitationStore)? = nil
    ) {
        self.locationSearch = locationSearch
        _viewModel = StateObject(wrappedValue: FamilyMembersViewModel(
            memberStore: memberStore,
            eventStore: eventStore,
            invitationStore: invitationStore,
            deletionService: FamilyMemberDeletionService(
                memberStore: memberStore,
                eventStore: eventStore,
                reminderStore: reminderStore
            )
        ))
    }

    var body: some View {
        NavigationStack {
            List {
                RallyrooHeader(title: "Your home team", subtitle: "Parents and kids, all in one place.")
                    .listRowBackground(Color.clear)
                if !viewModel.pendingInvitations.isEmpty {
                    Section("Pending invitations") {
                        ForEach(viewModel.pendingInvitations) { invitation in
                            HStack(spacing: 12) {
                                Image(systemName: invitation.role == .parent ? "person.fill.badge.plus" : "face.smiling.fill")
                                    .foregroundStyle(AppTheme.purple)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(invitation.role == .parent ? "Parent invitation" : "Kid invitation")
                                        .font(.headline)
                                    if let email = invitation.email {
                                        Text(email)
                                            .font(.subheadline)
                                    }
                                    Text("Expires \(invitation.expiresAt.formatted(date: .abbreviated, time: .shortened))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Menu {
                                    Button {
                                        Task { await viewModel.resend(invitation) }
                                    } label: {
                                        Label("Resend email", systemImage: "paperplane")
                                    }
                                    Button(role: .destructive) {
                                        Task { await viewModel.cancel(invitation) }
                                    } label: {
                                        Label("Cancel invitation", systemImage: "trash")
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                }
                            }
                        }
                    }
                }
                ForEach(FamilyMemberRole.allCases, id: \.self) { role in
                    let members = viewModel.members.filter { $0.role == role }
                    if !members.isEmpty {
                        Section(role == .parent ? "Parents" : "Kids") {
                            ForEach(members) { member in
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            Circle()
                                                .fill(Color(familyColorTag: member.colorTag).opacity(0.2))
                                                .frame(width: 42, height: 42)
                                            Image(systemName: member.role == .parent ? "person.fill" : "face.smiling.fill")
                                                .foregroundStyle(Color(familyColorTag: member.colorTag))
                                        }
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(member.name)
                                                .font(.headline)
                                            if let grade = member.gradeOrBirthYear, !grade.isEmpty {
                                                Text(grade)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture { editingMember = member }

                                    if member.role == .kid {
                                        ScrollView(.horizontal, showsIndicators: false) {
                                            HStack(spacing: 10) {
                                                ForEach(ActivityPreset.allCases) { preset in
                                                    Button {
                                                        quickActivity = QuickActivitySelection(
                                                            prefill: preset.prefill(for: member.id)
                                                        )
                                                    } label: {
                                                        Label(preset.title, systemImage: preset.systemImage)
                                                    }
                                                    .buttonStyle(.bordered)
                                                    .tint(Color(familyColorTag: member.colorTag))
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .navigationTitle("Family")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if viewModel.canInvite {
                        Menu {
                            Button("Invite a parent") { invitationRequest = InvitationRequest(role: .parent) }
                            Button("Invite a kid") { invitationRequest = InvitationRequest(role: .kid) }
                        } label: {
                            Image(systemName: "person.badge.plus")
                        }
                    }
                    Button { isAddingMember = true } label: { Image(systemName: "plus") }
                }
            }
            .task { await viewModel.load() }
            .onReceive(NotificationCenter.default.publisher(for: .familyDataDidChange)) { _ in
                Task { await viewModel.load() }
            }
            .sheet(isPresented: $isAddingMember) { FamilyMemberEditor(onSave: viewModel.save) }
            .sheet(item: $editingMember) { member in
                FamilyMemberEditor(member: member, onSave: viewModel.save, onDelete: viewModel.delete)
            }
            .sheet(item: $invitationRequest) { request in
                InvitationEmailSheet(role: request.role) { email, guardianConsent in
                    try await viewModel.invite(
                        role: request.role,
                        recipientEmail: email,
                        guardianConsent: guardianConsent
                    )
                }
            }
            .alert("Invitation sent", isPresented: Binding(
                get: { viewModel.invitationSentTo != nil },
                set: { if !$0 { viewModel.invitationSentTo = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Rallyroo emailed a secure invitation to \(viewModel.invitationSentTo ?? "the recipient").")
            }
            .sheet(item: $quickActivity) { selection in
                AddEventSheet(
                    prefill: selection.prefill,
                    members: viewModel.members,
                    locationSearch: locationSearch,
                    onSave: viewModel.saveEvent
                )
            }
             .tint(AppTheme.purple)
        }
    }
}

@MainActor
final class FamilyMembersViewModel: ObservableObject {
    @Published private(set) var members: [FamilyMember] = []
    @Published private(set) var pendingInvitations: [PendingFamilyInvitation] = []
    @Published var invitationSentTo: String?
    private let memberStore: any FamilyMemberStore
    private let eventStore: any EventStore
    private let invitationStore: (any FamilyInvitationStore)?
    private let deletionService: FamilyMemberDeletionService
    init(
        memberStore: any FamilyMemberStore,
        eventStore: any EventStore,
        invitationStore: (any FamilyInvitationStore)?,
        deletionService: FamilyMemberDeletionService
    ) {
        self.memberStore = memberStore
        self.eventStore = eventStore
        self.invitationStore = invitationStore
        self.deletionService = deletionService
    }
    func load() async {
        members = (try? await memberStore.members().sorted { $0.name < $1.name }) ?? []
        pendingInvitations = (try? await invitationStore?.pending()) ?? []
    }
    func save(_ member: FamilyMember) async throws { try await memberStore.save(member); await load() }
    func delete(_ member: FamilyMember) async throws { try await deletionService.delete(member); await load() }
    var canInvite: Bool { invitationStore != nil }
    func saveEvent(
        _ event: FamilyEvent,
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult {
        try await eventStore.save(
            event,
            notifyParticipants: notifyParticipants,
            idempotencyKey: idempotencyKey
        )
    }
    func invite(
        role: FamilyMemberRole,
        recipientEmail: String,
        guardianConsent: Bool
    ) async throws {
        _ = try await invitationStore?.create(
            role: role,
            recipientEmail: recipientEmail,
            guardianConsent: guardianConsent
        )
        invitationSentTo = recipientEmail
        await load()
    }
    func resend(_ pendingInvitation: PendingFamilyInvitation) async {
        guard (try? await invitationStore?.resend(id: pendingInvitation.id)) != nil else { return }
        invitationSentTo = pendingInvitation.email
        await load()
    }
    func cancel(_ invitation: PendingFamilyInvitation) async {
        try? await invitationStore?.cancel(id: invitation.id)
        await load()
    }
}

private struct InvitationRequest: Identifiable {
    let id = UUID()
    let role: FamilyMemberRole
}

private struct InvitationEmailSheet: View {
    let role: FamilyMemberRole
    let onSend: (String, Bool) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var isSending = false
    @State private var hasGuardianConsent = false
    @State private var errorMessage: String?

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email address", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text("Rallyroo will email a secure, single-use link that expires in seven days.")
                }
                if role == .kid {
                    Section {
                        Toggle(
                            "I am this child's parent or legal guardian, or I have their authorization",
                            isOn: $hasGuardianConsent
                        )
                    } header: {
                        Text("Parent or guardian authorization")
                    } footer: {
                        Text("This confirms permission for Rallyroo to process the child's account and family schedule information.")
                    }
                }
                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }
            .navigationTitle(role == .parent ? "Invite a Parent" : "Invite a Kid")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSending ? "Sending…" : "Send") {
                        isSending = true
                        Task {
                            do {
                                try await onSend(normalizedEmail, role == .kid && hasGuardianConsent)
                                dismiss()
                            } catch {
                                errorMessage = "We couldn't send the invitation. Please try again."
                                isSending = false
                            }
                        }
                    }
                    .disabled(
                        isSending ||
                        !normalizedEmail.contains("@") ||
                        (role == .kid && !hasGuardianConsent)
                    )
                }
            }
        }
    }
}

private struct QuickActivitySelection: Identifiable {
    let id = UUID()
    let prefill: ActivityEventPrefill
}

private struct FamilyMemberEditor: View {
    let onSave: (FamilyMember) async throws -> Void
    let onDelete: ((FamilyMember) async throws -> Void)?
    let existingMember: FamilyMember?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var role: FamilyMemberRole
    @State private var grade: String
    @State private var color: String
    @State private var errorMessage: String?
    @State private var confirmDelete = false

    init(member: FamilyMember? = nil, onSave: @escaping (FamilyMember) async throws -> Void, onDelete: ((FamilyMember) async throws -> Void)? = nil) {
        existingMember = member; self.onSave = onSave; self.onDelete = onDelete
        _name = State(initialValue: member?.name ?? "")
        _role = State(initialValue: member?.role ?? .kid)
        _grade = State(initialValue: member?.gradeOrBirthYear ?? "")
        _color = State(initialValue: member?.colorTag ?? "blue")
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                Picker("Role", selection: $role) { Text("Parent").tag(FamilyMemberRole.parent); Text("Kid").tag(FamilyMemberRole.kid) }
                if role == .kid { TextField("Grade or birth year", text: $grade) }
                Picker("Color", selection: $color) {
                    ForEach(["red", "orange", "yellow", "green", "blue", "purple", "pink"], id: \.self) { colorTag in
                        HStack {
                            Circle()
                                .fill(Color(familyColorTag: colorTag))
                                .frame(width: 14, height: 14)
                            Text(colorTag.capitalized)
                        }
                        .tag(colorTag)
                    }
                }
            }
            .navigationTitle(existingMember == nil ? "Add Family Member" : "Edit Family Member")
            .toolbar {
                if existingMember != nil { ToolbarItem(placement: .topBarLeading) { Button("Delete", role: .destructive) { confirmDelete = true } } }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.disabled(name.isEmpty) }
            }
            .confirmationDialog("Delete this family member?", isPresented: $confirmDelete) { Button("Delete", role: .destructive) { delete() } }
            .alert("Family member", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "") }
            .tint(AppTheme.purple)
        }
    }

    private func save() { Task { do { try await onSave(FamilyMember(id: existingMember?.id ?? KidID(rawValue: UUID().uuidString), name: name, role: role, gradeOrBirthYear: role == .kid ? grade : nil, colorTag: color)); dismiss() } catch { errorMessage = "Could not save this family member." } } }
    private func delete() { guard let existingMember, let onDelete else { return }; Task { do { try await onDelete(existingMember); dismiss() } catch FamilyMemberDeletionError.hasScheduledEvents { errorMessage = "Remove this member from scheduled events before deleting." } catch FamilyMemberDeletionError.hasOpenReminders { errorMessage = "Complete or reassign this member's open reminders before deleting." } catch { errorMessage = "Could not delete this family member." } } }
}
