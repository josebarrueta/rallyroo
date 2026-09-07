import XCTest
@testable import FamilyCore

@MainActor
final class SpeechPauseDetectorTests: XCTestCase {
    func testCallsOnPauseAfterSpeechStaysQuiet() async {
        let paused = expectation(description: "pause detected")
        let detector = SpeechPauseDetector(delay: .milliseconds(30))

        detector.receivedSpeech { paused.fulfill() }

        await fulfillment(of: [paused], timeout: 1)
    }

    func testNewSpeechCancelsThePreviousPauseEvent() async {
        let stalePause = expectation(description: "stale pause")
        stalePause.isInverted = true
        let latestPause = expectation(description: "latest pause")
        let detector = SpeechPauseDetector(delay: .milliseconds(30))
        detector.receivedSpeech { stalePause.fulfill() }

        detector.receivedSpeech { latestPause.fulfill() }

        await fulfillment(of: [latestPause, stalePause], timeout: 0.2)
    }
}
