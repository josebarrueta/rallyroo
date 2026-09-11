import Combine
import Foundation

@MainActor
public protocol ScheduleSpeechCapture: AnyObject {
    var isRecording: Bool { get }
    func start(
        onTranscript: @escaping @MainActor @Sendable (String) -> Void,
        onFailure: @escaping @MainActor @Sendable (String) -> Void
    )
    func stop()
      func updateLocale(_ locale: Locale)
}

public protocol ScheduleImageTextRecognition: Sendable {
    func recognizeText(in imageData: Data) async throws -> String
}

@MainActor
public protocol ScheduleDraftPersistence: AnyObject {
    func saveEvent(
        _ event: FamilyEvent,
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult
    func saveReminder(_ reminder: FamilyReminder) async throws
}

public enum ScheduleDraftIntakePhase: Equatable, Sendable {
    case idle
    case recording
    case recognizingImage
    case extracting
    case saving
}

public struct ScheduleDraftSaveSummary: Equatable, Sendable {
    public let savedCount: Int
    public let queuedNotificationCount: Int
    public let noRecipientCount: Int

    public init(savedCount: Int, queuedNotificationCount: Int, noRecipientCount: Int) {
        self.savedCount = savedCount
        self.queuedNotificationCount = queuedNotificationCount
        self.noRecipientCount = noRecipientCount
    }
}

public struct EditableScheduleDraft: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let entityID: UUID
    public let idempotencyKey: UUID
    public let kind: ScheduleDraftKind
    public var title: String
    public var memberIDs: Set<KidID>
    public var startTime: Date
    public var endTime: Date
    public var dueAt: Date
    public var location: String
    public var alertLeadTimeMinutes: Int?
    public let clarification: String?
    public let confidence: Double
    public var isSelected: Bool
    public fileprivate(set) var isPersisted: Bool

    public init(
        _ draft: ScheduleDraft,
        id: UUID = UUID(),
        entityID: UUID = UUID(),
        idempotencyKey: UUID = UUID(),
        now: Date = .now
    ) {
        self.id = id
        self.entityID = entityID
        self.idempotencyKey = idempotencyKey
        kind = draft.kind
        title = draft.title
        memberIDs = Set(draft.memberIDs)
        startTime = draft.startTime ?? now
        endTime = draft.endTime ?? (draft.startTime ?? now).addingTimeInterval(60 * 60)
        dueAt = draft.dueAt ?? now
        location = draft.location ?? ""
        alertLeadTimeMinutes = draft.alertLeadTimeMinutes
        clarification = draft.clarification
        confidence = draft.confidence
        isSelected = draft.clarification == nil
        isPersisted = false
    }

    public var canImport: Bool {
        guard !isPersisted,
              clarification == nil,
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !memberIDs.isEmpty else { return false }
        return kind == .reminder || endTime > startTime
    }

    public func event(source: EventSource) -> FamilyEvent {
        let sortedMemberIDs = memberIDs.sorted { $0.rawValue < $1.rawValue }
        return FamilyEvent(
            id: entityID,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            kidID: sortedMemberIDs.first,
            participantIDs: sortedMemberIDs,
            startTime: startTime,
            endTime: endTime,
            location: location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : location,
            source: source,
            status: .confirmed,
            alertLeadTime: alertLeadTimeMinutes.flatMap(EventAlertLeadTime.init(rawValue:))
        )
    }

    public var reminder: FamilyReminder {
        FamilyReminder(
            id: entityID,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            assigneeIDs: memberIDs.sorted { $0.rawValue < $1.rawValue },
            dueAt: dueAt,
            alertLeadTime: alertLeadTimeMinutes.flatMap(ReminderAlertLeadTime.init(rawValue:))
        )
    }
}

@MainActor
public final class ScheduleDraftIntake: ObservableObject {
    @Published public var inputText = "" {
        didSet {
            guard inputText != oldValue else { return }
            if phase == .extracting {
                extractionTask?.cancel()
                extractionGeneration = UUID()
                phase = .idle
            } else if phase == .recognizingImage {
                recognitionTask?.cancel()
                recognitionGeneration = UUID()
                phase = .idle
            }
        }
    }
    @Published public private(set) var inputType: ScheduleDraftInputType = .text
    @Published public var drafts: [EditableScheduleDraft] = []
    @Published public private(set) var phase: ScheduleDraftIntakePhase = .idle
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var isRequestingImage = false
    @Published public private(set) var saveSummary: ScheduleDraftSaveSummary?
    @Published public private(set) var didComplete = false

    private let extractor: any ScheduleDraftExtractor
    private let speech: any ScheduleSpeechCapture
    private let imageRecognizer: any ScheduleImageTextRecognition
    private let persistence: any ScheduleDraftPersistence
    private let timeZone: @Sendable () -> String
    private let extractionTimeout: Duration
    private var pauseDetector: SpeechPauseDetector
    private var extractionTask: Task<Void, Never>?
    private var recognitionTask: Task<Void, Never>?
    private var extractionGeneration = UUID()
    private var recognitionGeneration = UUID()
    private var savedCount = 0
    private var queuedNotificationCount = 0
    private var noRecipientCount = 0

    public init(
        extractor: any ScheduleDraftExtractor,
        speech: any ScheduleSpeechCapture,
        imageRecognizer: any ScheduleImageTextRecognition,
        persistence: any ScheduleDraftPersistence,
        pauseDelay: Duration = .seconds(3),
        extractionTimeout: Duration = .seconds(60),
        timeZone: @escaping @Sendable () -> String = { TimeZone.autoupdatingCurrent.identifier }
    ) {
        self.extractor = extractor
        self.speech = speech
        self.imageRecognizer = imageRecognizer
        self.persistence = persistence
        self.pauseDetector = SpeechPauseDetector(delay: pauseDelay)
        self.extractionTimeout = extractionTimeout
        self.timeZone = timeZone
    }

    public var isWorking: Bool {
        phase == .recognizingImage || phase == .extracting || phase == .saving
    }

    public var workingMessage: String {
        switch phase {
        case .recognizingImage: "Reading text from the image…"
        case .extracting: "Creating your schedule… This can take up to 60 seconds."
        case .saving: "Adding selected items…"
        case .idle, .recording: ""
        }
    }

    public func setSpeechLocale(_ locale: Locale) {
        speech.updateLocale(locale)
       }

     public func toggleVoiceCapture() {
        if phase == .recording {
            finishVoiceCapture()
            return
        }
        guard phase == .idle else { return }
        replaceInput(with: "", type: .voice)
        phase = .recording
        errorMessage = nil
        speech.start(
            onTranscript: { [weak self] transcript in self?.receiveSpeech(transcript) },
            onFailure: { [weak self] message in
                guard let self else { return }
                self.pauseDetector.cancel()
                self.phase = .idle
                self.errorMessage = message
            }
        )
    }

    public func finishVoiceCapture() {
        guard phase == .recording else { return }
        pauseDetector.cancel()
        speech.stop()
        phase = .idle
        guard !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        extract()
    }

    public func requestImage() {
        guard phase != .saving else { return }
        cancelCaptureAndExtraction()
        isRequestingImage = true
        errorMessage = nil
    }

    public func completeImageSelection(_ data: Data?) {
        guard phase != .saving else { return }
        isRequestingImage = false
        guard let data else { return }
        replaceInput(with: "", type: .image)
        phase = .recognizingImage
        recognitionTask?.cancel()
        let generation = UUID()
        recognitionGeneration = generation
        recognitionTask = Task { [weak self] in
            guard let self else { return }
            do {
                let text = try await imageRecognizer.recognizeText(in: data)
                guard !Task.isCancelled, recognitionGeneration == generation else { return }
                phase = .idle
                inputText = text
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    errorMessage = "No readable text was found in that image."
                } else {
                    extract()
                }
            } catch is CancellationError {
                if recognitionGeneration == generation { phase = .idle }
            } catch {
                guard recognitionGeneration == generation else { return }
                phase = .idle
                errorMessage = "Rallyroo could not read that image."
            }
        }
    }

    public func extract() {
        guard phase == .idle else { return }
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        pauseDetector.cancel()
        speech.stop()
        extractionTask?.cancel()
        let generation = UUID()
        extractionGeneration = generation
        phase = .extracting
        errorMessage = nil
        let inputType = inputType
        extractionTask = Task { [weak self] in
            guard let self else { return }
            do {
                let extracted = try await withTimeout(extractionTimeout) {
                    try await self.extractor.extract(
                        text: text,
                        inputType: inputType,
                        timeZone: self.timeZone()
                    )
                }
                guard !Task.isCancelled, extractionGeneration == generation else { return }
                guard !extracted.isEmpty else {
                    phase = .idle
                    errorMessage = "No schedule items were found."
                    return
                }
                drafts = extracted.map { EditableScheduleDraft($0) }
                savedCount = 0
                queuedNotificationCount = 0
                noRecipientCount = 0
                phase = .idle
            } catch is CancellationError {
                if extractionGeneration == generation { phase = .idle }
            } catch {
                guard extractionGeneration == generation else { return }
                phase = .idle
                errorMessage = "Rallyroo could not make drafts right now. Try again."
            }
        }
    }

    public func saveSelected(notifyParticipants: Bool) {
        guard phase == .idle else { return }
        let selectedDrafts = drafts.filter { $0.isSelected && $0.canImport }
        guard !selectedDrafts.isEmpty else { return }
        phase = .saving
        errorMessage = nil
        saveSummary = nil
        Task { [weak self] in
            guard let self else { return }
            var failedCount = 0
            for draft in selectedDrafts {
                do {
                    switch draft.kind {
                    case .event:
                        let result = try await persistence.saveEvent(
                            draft.event(source: inputType == .voice ? .voice : .manual),
                            notifyParticipants: notifyParticipants,
                            idempotencyKey: draft.idempotencyKey
                        )
                        if result.notificationOutcome == .queuedForRetry {
                            queuedNotificationCount += 1
                        }
                        if result.notificationOutcome == .noRecipients {
                            noRecipientCount += 1
                        }
                    case .reminder:
                        try await persistence.saveReminder(draft.reminder)
                    }
                    if let index = drafts.firstIndex(where: { $0.id == draft.id }) {
                        drafts[index].isSelected = false
                    drafts[index].isPersisted = true
                    }
                    savedCount += 1
                } catch {
                    failedCount += 1
                }
            }
            phase = .idle
            saveSummary = ScheduleDraftSaveSummary(
                savedCount: savedCount,
                queuedNotificationCount: queuedNotificationCount,
                noRecipientCount: noRecipientCount
            )
            if failedCount > 0 {
                errorMessage = "Some drafts could not be added. Items already added are now deselected."
            } else {
                didComplete = true
            }
        }
    }

    public func cancel() {
        cancelCaptureAndExtraction()
    }

    private func receiveSpeech(_ transcript: String) {
        guard phase == .recording else { return }
        inputText = transcript
        inputType = .voice
        pauseDetector.receivedSpeech { [weak self] in self?.finishVoiceCapture() }
    }

    private func replaceInput(with text: String, type: ScheduleDraftInputType) {
        extractionTask?.cancel()
        recognitionTask?.cancel()
        extractionGeneration = UUID()
        recognitionGeneration = UUID()
        inputText = text
        inputType = type
    }

    private func cancelCaptureAndExtraction() {
        pauseDetector.cancel()
        speech.stop()
        extractionTask?.cancel()
        recognitionTask?.cancel()
        extractionGeneration = UUID()
        recognitionGeneration = UUID()
        if phase != .saving { phase = .idle }
    }
}

private struct ScheduleDraftTimeoutError: Error {}

private func withTimeout<T: Sendable>(
    _ duration: Duration,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(for: duration)
            throw ScheduleDraftTimeoutError()
        }
        defer { group.cancelAll() }
        guard let value = try await group.next() else { throw CancellationError() }
        return value
    }
}
