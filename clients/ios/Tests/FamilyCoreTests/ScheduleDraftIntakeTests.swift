import XCTest
@testable import FamilyCore

final class ScheduleDraftIntakeTests: XCTestCase {
    @MainActor
    func testSpeechPauseStartsExtractionExactlyOnce() async throws {
        let speech = TestSpeechCapture()
        let extractor = QueueDraftExtractor(results: [.success([eventDraft(title: "Piano")])])
        let intake = ScheduleDraftIntake(
            extractor: extractor,
            speech: speech,
            imageRecognizer: TestImageRecognizer(text: ""),
            persistence: TestDraftPersistence(),
            pauseDelay: .milliseconds(20)
        )

        intake.toggleVoiceCapture()
        speech.emit("Piano Tuesday at four")

        try await eventually { intake.drafts.first?.title == "Piano" }
        let recordedInputs = await extractor.recordedInputs()
        XCTAssertEqual(recordedInputs, ["Piano Tuesday at four"])
        XCTAssertFalse(speech.isRecording)
    }

    @MainActor
    func testFailedRefreshRestoresLastGoodDrafts() async throws {
        let extractor = QueueDraftExtractor(results: [
            .success([eventDraft(title: "Soccer")]),
            .failure(TestFailure()),
        ])
        let intake = makeIntake(extractor: extractor)
        intake.inputText = "Soccer tomorrow"
        intake.extract()
        try await eventually { intake.phase == .idle && intake.drafts.count == 1 }
        let lastGood = intake.drafts

        intake.inputText = "Revised soccer details"
        intake.extract()
        try await eventually { intake.phase == .idle && intake.errorMessage != nil }

        XCTAssertEqual(intake.drafts, lastGood)
    }

    @MainActor
    func testRevisedInputIgnoresAStaleExtractionResponse() async throws {
        let extractor = DelayedDraftExtractor()
        let intake = ScheduleDraftIntake(
            extractor: extractor,
            speech: TestSpeechCapture(),
            imageRecognizer: TestImageRecognizer(text: ""),
            persistence: TestDraftPersistence()
        )
        intake.inputText = "Old details"
        intake.extract()
        try await Task.sleep(for: .milliseconds(5))

        intake.inputText = "New details"
        intake.extract()

        try await eventually { intake.drafts.first?.title == "New" }
        try await Task.sleep(for: .milliseconds(70))
        XCTAssertEqual(intake.drafts.first?.title, "New")
    }

    @MainActor
    func testTimeoutPreservesLastGoodDrafts() async throws {
        let intake = ScheduleDraftIntake(
            extractor: SlowDraftExtractor(),
            speech: TestSpeechCapture(),
            imageRecognizer: TestImageRecognizer(text: ""),
            persistence: TestDraftPersistence(),
            extractionTimeout: .milliseconds(20)
        )
        let lastGood = EditableScheduleDraft(eventDraft(title: "Existing"))
        intake.drafts = [lastGood]
        intake.inputText = "Slow request"

        intake.extract()

        try await eventually { intake.phase == .idle && intake.errorMessage != nil }
        XCTAssertEqual(intake.drafts, [lastGood])
    }

    @MainActor
    func testTypedRevisionWinsOverAStaleImageRecognitionResult() async throws {
        let intake = ScheduleDraftIntake(
            extractor: QueueDraftExtractor(results: []),
            speech: TestSpeechCapture(),
            imageRecognizer: DelayedImageRecognizer(),
            persistence: TestDraftPersistence()
        )
        intake.requestImage()
        intake.completeImageSelection(Data([1, 2, 3]))
        try await Task.sleep(for: .milliseconds(5))

        intake.inputText = "Typed revision"

        try await Task.sleep(for: .milliseconds(70))
        XCTAssertEqual(intake.inputText, "Typed revision")
        XCTAssertEqual(intake.phase, .idle)
    }

    @MainActor
    func testSuccessfulImageRecognitionAutomaticallyStartsExtraction() async throws {
        let extractor = QueueDraftExtractor(results: [.success([eventDraft(title: "School play")])])
        let intake = ScheduleDraftIntake(
            extractor: extractor,
            speech: TestSpeechCapture(),
            imageRecognizer: TestImageRecognizer(text: "School play Friday at six"),
            persistence: TestDraftPersistence()
        )

        intake.requestImage()
        intake.completeImageSelection(Data([1, 2, 3]))

        try await eventually { intake.drafts.first?.title == "School play" }
        XCTAssertEqual(intake.inputType, .image)
        let recordedInputs = await extractor.recordedInputs()
        XCTAssertEqual(recordedInputs, ["School play Friday at six"])
    }

    @MainActor
    func testPartialRetryRetainsStableEntityAndIdempotencyKeys() async throws {
        let persistence = TestDraftPersistence(failFirstEventOnce: true)
        let intake = makeIntake(
            extractor: QueueDraftExtractor(results: []),
            persistence: persistence
        )
        let first = EditableScheduleDraft(eventDraft(title: "Piano"))
        let second = EditableScheduleDraft(eventDraft(title: "Soccer"))
        intake.drafts = [first, second]

        intake.saveSelected(notifyParticipants: true)
        try await eventually { intake.phase == .idle }

        XCTAssertTrue(intake.drafts[0].isSelected)
        XCTAssertFalse(intake.drafts[1].isSelected)
        XCTAssertFalse(intake.didComplete)

        intake.saveSelected(notifyParticipants: true)
        try await eventually { intake.didComplete }

        let attempts = persistence.eventAttempts
        XCTAssertEqual(attempts.map(\.eventID), [first.entityID, second.entityID, first.entityID])
        XCTAssertEqual(attempts.map(\.idempotencyKey), [first.idempotencyKey, second.idempotencyKey, first.idempotencyKey])
    }

    @MainActor
    private func makeIntake(
        extractor: QueueDraftExtractor,
        persistence: TestDraftPersistence = TestDraftPersistence()
    ) -> ScheduleDraftIntake {
        ScheduleDraftIntake(
            extractor: extractor,
            speech: TestSpeechCapture(),
            imageRecognizer: TestImageRecognizer(text: ""),
            persistence: persistence
        )
    }

    @MainActor
    private func eventually(
        _ predicate: @escaping @MainActor () -> Bool
    ) async throws {
        for _ in 0..<100 {
            if predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Condition was not met")
    }
}

private struct TestFailure: Error {}

private func eventDraft(title: String) -> ScheduleDraft {
    ScheduleDraft(
        kind: .event,
        title: title,
        memberIDs: [KidID(rawValue: "kid-1")],
        startTime: Date(timeIntervalSince1970: 1_800_000_000),
        endTime: Date(timeIntervalSince1970: 1_800_003_600),
        dueAt: nil,
        location: nil,
        alertLeadTimeMinutes: 0,
        clarification: nil,
        confidence: 0.9
    )
}

@MainActor
private final class TestSpeechCapture: ScheduleSpeechCapture {
    private var onTranscript: (@MainActor @Sendable (String) -> Void)?
    private(set) var isRecording = false

    func start(
        onTranscript: @escaping @MainActor @Sendable (String) -> Void,
        onFailure: @escaping @MainActor @Sendable (String) -> Void
    ) {
        self.onTranscript = onTranscript
        isRecording = true
    }

    func stop() {
        isRecording = false
    }

    func emit(_ transcript: String) {
        onTranscript?(transcript)
    }
}

private actor QueueDraftExtractor: ScheduleDraftExtractor {
    private var results: [Result<[ScheduleDraft], Error>]
    private var inputs: [String] = []

    init(results: [Result<[ScheduleDraft], Error>]) {
        self.results = results
    }

    func extract(
        text: String,
        inputType: ScheduleDraftInputType,
        timeZone: String
    ) async throws -> [ScheduleDraft] {
        inputs.append(text)
        guard !results.isEmpty else { return [] }
        return try results.removeFirst().get()
    }

    func recordedInputs() -> [String] { inputs }
}

private actor DelayedDraftExtractor: ScheduleDraftExtractor {
    func extract(
        text: String,
        inputType: ScheduleDraftInputType,
        timeZone: String
    ) async throws -> [ScheduleDraft] {
        if text == "Old details" {
            do { try await Task.sleep(for: .milliseconds(60)) } catch {}
            return [eventDraft(title: "Old")]
        }
        try await Task.sleep(for: .milliseconds(5))
        return [eventDraft(title: "New")]
    }
}

private actor SlowDraftExtractor: ScheduleDraftExtractor {
    func extract(
        text: String,
        inputType: ScheduleDraftInputType,
        timeZone: String
    ) async throws -> [ScheduleDraft] {
        try await Task.sleep(for: .seconds(5))
        return [eventDraft(title: "Too late")]
    }
}

private struct DelayedImageRecognizer: ScheduleImageTextRecognition {
    func recognizeText(in imageData: Data) async throws -> String {
        do { try await Task.sleep(for: .milliseconds(50)) } catch {}
        return "Stale image text"
    }
}

private struct TestImageRecognizer: ScheduleImageTextRecognition {
    let text: String

    func recognizeText(in imageData: Data) async throws -> String { text }
}

@MainActor
private final class TestDraftPersistence: ScheduleDraftPersistence {
    struct Attempt: Equatable {
        let eventID: UUID
        let idempotencyKey: UUID
    }

    private var shouldFailFirstEvent: Bool
    private(set) var eventAttempts: [Attempt] = []

    init(failFirstEventOnce: Bool = false) {
        shouldFailFirstEvent = failFirstEventOnce
    }

    func saveEvent(
        _ event: FamilyEvent,
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult {
        eventAttempts.append(Attempt(eventID: event.id, idempotencyKey: idempotencyKey))
        if shouldFailFirstEvent {
            shouldFailFirstEvent = false
            throw TestFailure()
        }
        return EventMutationResult(conflicts: [], notificationOutcome: .sent)
    }

    func saveReminder(_ reminder: FamilyReminder) async throws {}
}
