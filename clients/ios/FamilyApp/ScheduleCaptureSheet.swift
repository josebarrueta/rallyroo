import AVFoundation
import PhotosUI
@preconcurrency import Speech
import SwiftUI
import UniformTypeIdentifiers
import Vision
import FamilyCore

struct ScheduleCaptureSheet: View {
    let extractor: any ScheduleDraftExtractor
    let members: [FamilyMember]
    let onSaveEvent: (FamilyEvent, Bool) async throws -> Void
    let onSaveReminder: (FamilyReminder) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var speech = ScheduleSpeechTranscriber()
    @State private var pauseDetector = SpeechPauseDetector()
    @State private var inputText = ""
    @State private var inputType: ScheduleDraftInputType = .text
    @State private var isShowingPhotoPicker = false
    @State private var isShowingNotifyPrompt = false
    @State private var drafts: [EditableScheduleDraft] = []
    @State private var isWorking = false
    @State private var workingMessage = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Describe your schedule") {
                    TextEditor(text: $inputText)
                        .frame(minHeight: 110)
                        .accessibilityLabel("Schedule description")
                    HStack {
                        Button {
                            inputType = .voice
                            if speech.isRecording {
                                finishVoiceCapture()
                            } else {
                                speech.toggle()
                            }
                        } label: {
                            Label(speech.isRecording ? "Stop" : "Speak", systemImage: speech.isRecording ? "stop.circle" : "mic")
                        }
                        .buttonStyle(.bordered)
                        Spacer()
                        Button("Read image", systemImage: "photo") {
                            pauseDetector.cancel()
                            speech.stop()
                            isShowingPhotoPicker = true
                        }
                        .buttonStyle(.bordered)
                    }
                    Text("AI creates drafts only. Review every item before adding it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if !drafts.isEmpty {
                        Button("Update drafts from revised text") { extract() }
                            .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isWorking)
                    }
                }

                if !drafts.isEmpty {
                    Section("Review drafts") {
                        ForEach($drafts) { $draft in
                            VStack(alignment: .leading, spacing: 10) {
                                Toggle(isOn: $draft.isSelected) {
                                    Label(draft.kind == .event ? "Event" : "Reminder", systemImage: draft.kind == .event ? "calendar" : "checklist")
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
                                    Label("Choose at least one family member.", systemImage: "person.crop.circle.badge.questionmark")
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
                }

                if isWorking {
                    Section {
                        ProgressView()
                            .progressViewStyle(.linear)
                        Text(workingMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
            .navigationTitle("Create with AI")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        pauseDetector.cancel()
                        speech.stop()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isWorking {
                        ProgressView()
                    } else if drafts.isEmpty {
                        Button("Create") { extract() }
                            .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    } else {
                        Button("Add selected") {
                            if drafts.contains(where: { $0.isSelected && $0.canImport && $0.kind == .event }) {
                                isShowingNotifyPrompt = true
                            } else {
                                save(notifyParticipants: false)
                            }
                        }
                        .disabled(!drafts.contains(where: { $0.isSelected && $0.canImport }))
                    }
                }
            }
            .alert("Notify family?", isPresented: $isShowingNotifyPrompt) {
                Button("Yes, notify") { save(notifyParticipants: true) }
                    .keyboardShortcut(.defaultAction)
                Button("Add without notifying") { save(notifyParticipants: false) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Send one immediate schedule-update notification for each selected event? Scheduled event alerts remain separate.")
            }
            .onChange(of: speech.transcript) { transcript in
                guard speech.isRecording || !transcript.isEmpty else { return }
                inputText = transcript
                inputType = .voice
                pauseDetector.receivedSpeech {
                    finishVoiceCapture()
                }
            }
            .sheet(isPresented: $isShowingPhotoPicker) {
                SchedulePhotoPicker { data in
                    isShowingPhotoPicker = false
                    guard let data else { return }
                    Task { await recognize(data) }
                }
            }
            .onChange(of: speech.errorMessage) { message in
                if let message { errorMessage = message }
            }
            .onDisappear {
                pauseDetector.cancel()
                speech.stop()
            }
        }
    }

    private func memberBinding(_ memberID: KidID, draft: Binding<EditableScheduleDraft>) -> Binding<Bool> {
        Binding(
            get: { draft.wrappedValue.memberIDs.contains(memberID) },
            set: { selected in
                if selected { draft.wrappedValue.memberIDs.insert(memberID) }
                else { draft.wrappedValue.memberIDs.remove(memberID) }
            }
        )
    }

    private func finishVoiceCapture() {
        guard !isWorking,
              !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        pauseDetector.cancel()
        speech.stop()
        extract()
    }

    private func extract() {
        isWorking = true
        workingMessage = "Creating your schedule… This can take up to 60 seconds."
        errorMessage = nil
        pauseDetector.cancel()
        speech.stop()
        Task {
            defer { isWorking = false }
            do {
                drafts = try await extractor.extract(
                    text: inputText,
                    inputType: inputType,
                    timeZone: TimeZone.autoupdatingCurrent.identifier
                ).map(EditableScheduleDraft.init)
                if drafts.isEmpty { errorMessage = "No schedule items were found." }
            } catch {
                errorMessage = "Rallyroo could not make drafts right now. Try again."
            }
        }
    }

    private func recognize(_ data: Data) async {
        isWorking = true
        workingMessage = "Reading text from the image…"
        errorMessage = nil
        do {
            inputText = try await ScheduleImageTextRecognizer.recognize(data)
            inputType = .image
            isWorking = false
            if inputText.isEmpty {
                errorMessage = "No readable text was found in that image."
            } else {
                extract()
            }
        } catch {
            isWorking = false
            errorMessage = "Rallyroo could not read that image."
        }
    }

    private func save(notifyParticipants: Bool) {
        isWorking = true
        workingMessage = "Adding selected items…"
        errorMessage = nil
        Task {
            defer { isWorking = false }
            do {
                let selectedIndices = drafts.indices.filter { drafts[$0].isSelected && drafts[$0].canImport }
                for index in selectedIndices {
                    let draft = drafts[index]
                    switch draft.kind {
                    case .event:
                        try await onSaveEvent(
                            draft.event(source: inputType == .voice ? .voice : .manual),
                            notifyParticipants
                        )
                    case .reminder: try await onSaveReminder(draft.reminder)
                    }
                    drafts[index].isSelected = false
                }
                NotificationCenter.default.post(name: .familyDataDidChange, object: nil)
                dismiss()
            } catch {
                errorMessage = "Some drafts could not be added. Items already added are now deselected."
            }
        }
    }
}

private struct EditableScheduleDraft: Identifiable {
    let id = UUID()
    let kind: ScheduleDraftKind
    var title: String
    var memberIDs: Set<KidID>
    var startTime: Date
    var endTime: Date
    var dueAt: Date
    var location: String
    var alertLeadTimeMinutes: Int?
    let clarification: String?
    let confidence: Double
    var isSelected: Bool

    init(_ draft: ScheduleDraft) {
        kind = draft.kind
        title = draft.title
        memberIDs = Set(draft.memberIDs)
        startTime = draft.startTime ?? .now
        endTime = draft.endTime ?? (draft.startTime ?? .now).addingTimeInterval(60 * 60)
        dueAt = draft.dueAt ?? .now
        location = draft.location ?? ""
        alertLeadTimeMinutes = draft.alertLeadTimeMinutes
        clarification = draft.clarification
        confidence = draft.confidence
        isSelected = draft.clarification == nil
    }

    var canImport: Bool {
        guard clarification == nil, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !memberIDs.isEmpty else { return false }
        return kind == .reminder || endTime > startTime
    }

    func event(source: EventSource) -> FamilyEvent {
        let sortedMemberIDs = memberIDs.sorted { $0.rawValue < $1.rawValue }
        return FamilyEvent(
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

    var reminder: FamilyReminder {
        FamilyReminder(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            assigneeIDs: memberIDs.sorted { $0.rawValue < $1.rawValue },
            dueAt: dueAt,
            alertLeadTime: alertLeadTimeMinutes.flatMap(ReminderAlertLeadTime.init(rawValue:))
        )
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

private enum ScheduleImageTextRecognizer {
    static func recognize(_ data: Data) async throws -> String {
        try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(data: data)
            try handler.perform([request])
            return (request.results ?? [])
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: "\n")
        }.value
    }
}

@MainActor
private final class ScheduleSpeechTranscriber: ObservableObject {
    @Published private(set) var transcript = ""
    @Published private(set) var isRecording = false
    @Published private(set) var errorMessage: String?
    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func toggle() {
        errorMessage = nil
        if isRecording { stop() }
        else {
            SFSpeechRecognizer.requestAuthorization { @Sendable [weak self] status in
                Task { @MainActor in
                    guard let self else { return }
                    guard status == .authorized else {
                        self.errorMessage = "Allow Speech Recognition and Microphone access in Settings to use voice capture."
                        return
                    }
                    AVAudioSession.sharedInstance().requestRecordPermission { @Sendable granted in
                        Task { @MainActor in
                            guard granted else {
                                self.errorMessage = "Allow Speech Recognition and Microphone access in Settings to use voice capture."
                                return
                            }
                            do { try self.start() }
                            catch { self.errorMessage = "Voice capture could not start." }
                        }
                    }
                }
            }
        }
    }

    func stop() {
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

    private func start() throws {
        stop()
        transcript = ""
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
                if let text { self?.transcript = text }
                if error != nil || isFinal { self?.stop() }
            }
        }
    }
}
