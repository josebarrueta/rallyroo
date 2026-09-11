import AVFoundation
import PhotosUI
@preconcurrency import Speech
import SwiftUI
import UniformTypeIdentifiers
import Vision
import FamilyCore

struct ScheduleCaptureSheet: View {
    let members: [FamilyMember]

    @Environment(\.dismiss) private var dismiss
    @StateObject private var intake: ScheduleDraftIntake
    @State private var isShowingNotifyPrompt = false
     @State private var speechLanguage: SpeechLanguage = .english

     enum SpeechLanguage: String, CaseIterable, Identifiable {
         case english = "English"
         case spanish = "Español"
         var id: String {
             rawValue
          }
         var locale: Locale {
             switch self {
             case .english: Locale(identifier: "en-US")
             case .spanish: Locale(identifier: "es-ES")
            }
          }
      }

    init(
        extractor: any ScheduleDraftExtractor,
        members: [FamilyMember],
        onSaveEvent: @escaping @MainActor (FamilyEvent, Bool, UUID) async throws -> EventMutationResult,
        onSaveReminder: @escaping @MainActor (FamilyReminder) async throws -> Void,
        speechLocale: Locale = Locale(identifier: "en-US")
    ) {
        self.members = members
        let persistence = ClosureScheduleDraftPersistence(
            onSaveEvent: onSaveEvent,
            onSaveReminder: onSaveReminder
        )
        _intake = StateObject(wrappedValue: ScheduleDraftIntake(
            extractor: extractor,
            speech: ScheduleSpeechTranscriber(locale: speechLocale),
            imageRecognizer: AppleScheduleImageTextRecognizer(),
            persistence: persistence
        ))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Describe your schedule") {
                    TextEditor(text: $intake.inputText)
                        .frame(minHeight: 110)
                        .accessibilityLabel("Schedule description")
                    HStack {
                        Button {
                            intake.toggleVoiceCapture()
                        } label: {
                            Label(
                                intake.phase == .recording ? "Stop" : "Speak",
                                systemImage: intake.phase == .recording ? "stop.circle" : "mic"
                            )
                        }
                        .buttonStyle(.bordered)
                        .disabled(intake.isWorking)
                        Spacer()
                        Button("Read image", systemImage: "photo") {
                            intake.requestImage()
                        }
                        .buttonStyle(.bordered)
                        .disabled(intake.isWorking)
                    }
                    scheduleLanguagePicker
                    Text("AI creates drafts only. Review every item before adding it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if !intake.drafts.isEmpty {
                        Button("Update drafts from revised text") { intake.extract() }
                            .disabled(
                                intake.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    || intake.isWorking
                            )
                    }
                }

                if !intake.drafts.isEmpty {
                    Section("Review drafts") {
                        ForEach($intake.drafts) { $draft in
                            VStack(alignment: .leading, spacing: 10) {
                                Toggle(isOn: $draft.isSelected) {
                                    Label(
                                        draft.kind == .event ? "Event" : "Reminder",
                                        systemImage: draft.kind == .event ? "calendar" : "checklist"
                                    )
                                }
                                .disabled(!draft.canImport)
                                TextField("Title", text: $draft.title)
                                if draft.kind == .event {
                                    DatePicker("Starts", selection: $draft.startTime)
                                    DatePicker("Ends", selection: $draft.endTime)
                                    TextField("Location", text: $draft.location)
                                } else {
                                    DatePicker("Due", selection: $draft.dueAt)
                                }
                                Picker("Alert", selection: $draft.alertLeadTimeMinutes) {
                                    Text("None").tag(Int?.none)
                                    Text(draft.kind == .event ? "At start" : "At due time").tag(Int?.some(0))
                                    Text("5 minutes before").tag(Int?.some(5))
                                    Text("15 minutes before").tag(Int?.some(15))
                                    if draft.kind == .event {
                                        Text("30 minutes before").tag(Int?.some(30))
                                        Text("45 minutes before").tag(Int?.some(45))
                                    }
                                    Text("1 hour before").tag(Int?.some(60))
                                    Text("1 day before").tag(Int?.some(1_440))
                                }
                                if !members.isEmpty {
                                    ForEach(members) { member in
                                        Toggle(member.name, isOn: memberBinding(member.id, draft: $draft))
                                            .font(.subheadline)
                                    }
                                }
                                if let clarification = draft.clarification {
                                    Label(clarification, systemImage: "questionmark.circle")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                } else if draft.memberIDs.isEmpty {
                                    Label(
                                        "Choose at least one family member.",
                                        systemImage: "person.crop.circle.badge.questionmark"
                                    )
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                                }
                                Text("Confidence: \(Int(draft.confidence * 100))%")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .disabled(intake.phase == .extracting || intake.phase == .saving)
                }

                if intake.isWorking {
                    Section {
                        ProgressView()
                            .progressViewStyle(.linear)
                        Text(intake.workingMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if let errorMessage = intake.errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle("Create with AI")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        intake.cancel()
                        dismiss()
                    }
                    .disabled(intake.phase == .saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if intake.isWorking {
                        ProgressView()
                    } else if intake.drafts.isEmpty {
                        Button("Create") { intake.extract() }
                            .disabled(intake.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    } else {
                        Button("Add selected") {
                            if intake.drafts.contains(where: {
                                $0.isSelected && $0.canImport && $0.kind == .event
                            }) {
                                isShowingNotifyPrompt = true
                            } else {
                                intake.saveSelected(notifyParticipants: false)
                            }
                        }
                        .disabled(!intake.drafts.contains(where: { $0.isSelected && $0.canImport }))
                    }
                }
            }
            .alert("Notify family?", isPresented: $isShowingNotifyPrompt) {
                Button("Yes, notify") { intake.saveSelected(notifyParticipants: true) }
                    .keyboardShortcut(.defaultAction)
                Button("Add without notifying") { intake.saveSelected(notifyParticipants: false) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Send one schedule update notification for each selected Event? Scheduled Event alerts remain separate.")
            }
            .sheet(isPresented: imagePickerBinding) {
                SchedulePhotoPicker { data in intake.completeImageSelection(data) }
            }
            .onChange(of: intake.didComplete) { didComplete in
                guard didComplete else { return }
                NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
                if let message = completionMessage {
                    NotificationCenter.default.post(
                        name: .scheduleUpdateNotice,
                        object: nil,
                        userInfo: ["message": message]
                    )
                }
                dismiss()
            }
            .interactiveDismissDisabled(intake.phase == .saving)
            .onDisappear { intake.cancel() }
        }
    }

    private var imagePickerBinding: Binding<Bool> {
        Binding(
            get: { intake.isRequestingImage },
            set: { if !$0 { intake.completeImageSelection(nil) } }
        )
    }

    private var completionMessage: String? {
        guard let summary = intake.saveSummary else { return nil }
        return ScheduleUpdateNotificationMessage.make(
            queuedCount: summary.queuedNotificationCount,
            noRecipientCount: summary.noRecipientCount
        )
    }

    private func memberBinding(
        _ memberID: KidID,
        draft: Binding<EditableScheduleDraft>
    ) -> Binding<Bool> {
        Binding(
            get: { draft.wrappedValue.memberIDs.contains(memberID) },
            set: { selected in
                if selected { draft.wrappedValue.memberIDs.insert(memberID) }
                else { draft.wrappedValue.memberIDs.remove(memberID) }
            }
        )
    }
    @ViewBuilder
    private var scheduleLanguagePicker: some View {
        Picker(
               "Voice language",
             selection: $speechLanguage
             ) {
                ForEach(SpeechLanguage.allCases) { language in
                    Text(language.rawValue).tag(language)
                      }
                   }
                   .pickerStyle(.segmented)
                   .accessibilityLabel("Voice language")
                   .onChange(of: speechLanguage) { newLanguage in
                     intake.setSpeechLocale(newLanguage.locale)
                      }
        }

}

@MainActor
private final class ClosureScheduleDraftPersistence: ScheduleDraftPersistence {
    private let onSaveEvent: @MainActor (FamilyEvent, Bool, UUID) async throws -> EventMutationResult
    private let onSaveReminder: @MainActor (FamilyReminder) async throws -> Void

    init(
        onSaveEvent: @escaping @MainActor (FamilyEvent, Bool, UUID) async throws -> EventMutationResult,
        onSaveReminder: @escaping @MainActor (FamilyReminder) async throws -> Void
    ) {
        self.onSaveEvent = onSaveEvent
        self.onSaveReminder = onSaveReminder
    }

    func saveEvent(
        _ event: FamilyEvent,
        notifyParticipants: Bool,
        idempotencyKey: UUID
    ) async throws -> EventMutationResult {
        try await onSaveEvent(event, notifyParticipants, idempotencyKey)
    }

    func saveReminder(_ reminder: FamilyReminder) async throws {
        try await onSaveReminder(reminder)
    }
}

private enum ScheduleCaptureError: Error { case speechUnavailable }

private struct SchedulePhotoPicker: UIViewControllerRepresentable {
    let onSelection: @MainActor @Sendable (Data?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onSelection: onSelection) }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        private let onSelection: @MainActor @Sendable (Data?) -> Void

        init(onSelection: @escaping @MainActor @Sendable (Data?) -> Void) {
            self.onSelection = onSelection
        }

        nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider,
                  provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else {
                Task { @MainActor in onSelection(nil) }
                return
            }
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { @Sendable [onSelection] data, _ in
                Task { @MainActor in onSelection(data) }
            }
        }
    }
}

private struct AppleScheduleImageTextRecognizer: ScheduleImageTextRecognition {
    func recognizeText(in imageData: Data) async throws -> String {
        try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(data: imageData)
            try handler.perform([request])
            return (request.results ?? [])
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: "\n")
        }.value
    }
}

@MainActor
private final class ScheduleSpeechTranscriber: ScheduleSpeechCapture {
    private(set) var isRecording = false
    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var onTranscript: (@MainActor @Sendable (String) -> Void)?
    private var onFailure: (@MainActor @Sendable (String) -> Void)?
    private var captureGeneration = UUID()
    private var locale: Locale

    init(locale: Locale = Locale(identifier: "en-US")) {
        self.locale = locale
        self.recognizer = SFSpeechRecognizer(locale: locale)
      }
      func updateLocale(_ newLocale: Locale) {
          locale = newLocale
          recognizer = SFSpeechRecognizer(locale: newLocale)
      }


    func start(
        onTranscript: @escaping @MainActor @Sendable (String) -> Void,
        onFailure: @escaping @MainActor @Sendable (String) -> Void
    ) {
        stop()
        let generation = UUID()
        captureGeneration = generation
        self.onTranscript = onTranscript
        self.onFailure = onFailure
        SFSpeechRecognizer.requestAuthorization { @Sendable [weak self] status in
            Task { @MainActor in
                guard let self, self.captureGeneration == generation else { return }
                guard status == .authorized else {
                    onFailure("Allow Speech Recognition and Microphone access in Settings to use voice capture.")
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { @Sendable granted in
                    Task { @MainActor in
                        guard self.captureGeneration == generation else { return }
                        guard granted else {
                            onFailure("Allow Speech Recognition and Microphone access in Settings to use voice capture.")
                            return
                        }
                        self.recognizer = SFSpeechRecognizer(locale: self.locale)
                        do { try self.beginAudioCapture() }
                        catch { onFailure("Voice capture could not start.") }
                    }
                }
            }
        }
    }

    func stop() {
        captureGeneration = UUID()
        guard isRecording else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func beginAudioCapture() throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        guard let recognizer, recognizer.isAvailable else { throw ScheduleCaptureError.speechUnavailable }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1_024, format: format) { @Sendable buffer, _ in
            request.append(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()
        isRecording = true
        task = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal == true
            Task { @MainActor in
                guard let self else { return }
                if let text { self.onTranscript?(text) }
                if error != nil || isFinal { self.stop() }
            }
        }
    }

}
