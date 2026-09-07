import Foundation

/// Debounces partial speech-recognition results into a single pause event.
@MainActor
public final class SpeechPauseDetector {
    private let delay: Duration
    private var pendingPause: Task<Void, Never>?

    public init(delay: Duration = .seconds(3)) {
        self.delay = delay
    }

    public func receivedSpeech(onPause: @escaping @MainActor @Sendable () -> Void) {
        pendingPause?.cancel()
        pendingPause = Task { [delay] in
            do {
                try await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                onPause()
            } catch is CancellationError {
                return
            } catch {
                return
            }
        }
    }

    public func cancel() {
        pendingPause?.cancel()
        pendingPause = nil
    }

    deinit {
        pendingPause?.cancel()
    }
}
