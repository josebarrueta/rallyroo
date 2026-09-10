import Foundation

public enum FamilyMemberRole: String, Codable, Sendable, CaseIterable {
    case parent
    case kid
}

public struct FamilyMember: Codable, Equatable, Identifiable, Sendable {
    public let id: KidID
    public var name: String
    public var role: FamilyMemberRole
    public var gradeOrBirthYear: String?
    public var colorTag: String
    public var canDrive: Bool

    private enum CodingKeys: String, CodingKey {
        case id, name, role, gradeOrBirthYear, colorTag, canDrive
    }

    public init(
        id: KidID,
        name: String,
        role: FamilyMemberRole,
        gradeOrBirthYear: String? = nil,
        colorTag: String,
        canDrive: Bool = false
    ) {
        self.id = id
        self.name = name
        self.role = role
        self.gradeOrBirthYear = gradeOrBirthYear
        self.colorTag = colorTag
        self.canDrive = role == .kid && canDrive
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(KidID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        role = try container.decode(FamilyMemberRole.self, forKey: .role)
        gradeOrBirthYear = try container.decodeIfPresent(String.self, forKey: .gradeOrBirthYear)
        colorTag = try container.decode(String.self, forKey: .colorTag)
        let decodedCanDrive = try container.decodeIfPresent(Bool.self, forKey: .canDrive) ?? false
        canDrive = role == .kid && decodedCanDrive
    }
}

public protocol FamilyMemberStore: Sendable {
    func save(_ member: FamilyMember) async throws
    func delete(_ member: FamilyMember) async throws
    func members() async throws -> [FamilyMember]
}

public enum FamilyMemberDeletionError: Error, Sendable {
    case hasScheduledEvents
    case hasOpenReminders
}

public actor FamilyMemberDeletionService {
    private let memberStore: any FamilyMemberStore
    private let eventStore: any EventStore
    private let reminderStore: (any ReminderStore)?

    public init(
        memberStore: any FamilyMemberStore,
        eventStore: any EventStore,
        reminderStore: (any ReminderStore)? = nil
    ) {
        self.memberStore = memberStore
        self.eventStore = eventStore
        self.reminderStore = reminderStore
    }

    public func delete(_ member: FamilyMember) async throws {
        let events = try await eventStore.events()
        guard !events.contains(where: { $0.participantIDs.contains(member.id) }) else {
            throw FamilyMemberDeletionError.hasScheduledEvents
        }
        if let reminderStore {
            let reminders = try await reminderStore.reminders()
            guard !reminders.contains(where: {
                $0.status == .open && $0.assigneeIDs.contains(member.id)
            }) else {
                throw FamilyMemberDeletionError.hasOpenReminders
            }
        }
        try await memberStore.delete(member)
    }
}

public actor LocalFamilyMemberStore: FamilyMemberStore {
    private let storageURL: URL

    public init(storageURL: URL) { self.storageURL = storageURL }

    public func save(_ member: FamilyMember) async throws {
        var saved = try await members()
        saved.removeAll { $0.id == member.id }
        saved.append(member)
        try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(saved).write(to: storageURL, options: .atomic)
    }

    public func delete(_ member: FamilyMember) async throws {
        var saved = try await members()
        saved.removeAll { $0.id == member.id }
        try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(saved).write(to: storageURL, options: .atomic)
    }

    public func members() async throws -> [FamilyMember] {
        guard FileManager.default.fileExists(atPath: storageURL.path) else { return [] }
        return try JSONDecoder().decode([FamilyMember].self, from: Data(contentsOf: storageURL))
    }
}
