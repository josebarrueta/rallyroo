import AppIntents
import FamilyCore
import Foundation

// MARK: - No-op web session for background intents

/// An `OAuthWebSession` that never starts a UI session.
/// Background Siri intents only need to load a saved session from Keychain;
/// They never perform interactive OAuth.
actor NoOpOAuthWebSession: OAuthWebSession {
    func authenticate(using authorizationURL: URL, callbackScheme: String) async throws -> URL {
         throw AppIntentError.oauthRequired
         }
}

// MARK: - Create Event Intent

@available(iOS 16.0, *)
struct CreateEventIntent: AppIntent {
    static var title: LocalizedStringResource =
         "Create a family schedule event"

    static var description = IntentDescription(
         "Creates a new event in the family schedule."
         )

    // MARK: Parameters

    @Parameter(
        title: "Event title",
        description: "What should the event be called?",
        default: "New Event"
        )
    var eventTitle: String

    @Parameter(
        title: "Family member",
        description: "Is this for a specific person?",
        default: nil
        )
    var memberName: String?

    @Parameter(
        title: "Day",
        description: "Which day? e.g. Monday, tomorrow",
        default: nil
        )
    var dayText: String?

    @Parameter(
        title: "Time",
        description: "What time? e.g. 5pm, morning",
        default: nil
        )
    var timeText: String?

    @Parameter(
        title: "Location",
        description: "Where is the event?",
        default: nil
        )
    var location: String?

    static var openAppWhenRun = false

    // MARK: Execute

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // 1. Load configuration
        guard let configuration = try? AppConfiguration.load() else {
            throw AppIntentError.invalidConfiguration
        }

        guard configuration.dataMode == .remote,
             let baseURL = configuration.remoteBaseURL
        else {
            throw AppIntentError.notRemoteMode
        }

        // 2. Build the same remote stack the main app uses.
        let transport = URLSessionHTTPTransport()
        let authentication = RemoteAuthentication(
            baseURL: baseURL,
            transport: transport,
            webSession: NoOpOAuthWebSession(),
            sessionStore: KeychainAuthSessionStore()
        )

        let authenticatedTransport = AuthenticatedHTTPTransport(
            transport: transport,
            authentication: authentication
        )

        // 3. Check session
        let session = try await authentication.currentSession()
        guard let session else {
            return .result(
                dialog: "Sign in to Rallyroo in the app, then try again."
            )
        }

        // 4. Create the event
        let eventStore = RemoteEventStore(
            baseURL: baseURL,
            transport: authenticatedTransport,
            accountID: { session.accountID }
        )

        var event = FamilyEvent(
            title: eventTitle,
            kidID: nil,
            startTime: Date(),
            endTime: .distantFuture,
            source: .voice,
            status: .confirmed
        )

        // 5. Parse day / time
        if let dayText {
            event.startTime = SiriTimeParser.parseDay(from: dayText) ?? event.startTime
        }

        if let timeText {
            event.startTime =
                 SiriTimeParser.parseTime(from: timeText, relativeTo: event.startTime)
                 ?? event.startTime
        }

        event.endTime = event.startTime.addingTimeInterval(3600)

        // 6. Assign to a family member if provided
        if let memberName {
            let memberStore = RemoteFamilyMemberStore(
                baseURL: baseURL,
                transport: authenticatedTransport
            )
            if let members = try? await memberStore.members() {
                event.participantIDs = members
                    .filter {
                        $0.name.caseInsensitiveCompare(memberName) == .orderedSame
                    }
                    .map(\.id)
            }
        }

        // 7. Set location
        event.location = location

        // 8. Save
        do {
            let result =
                 try await eventStore.save(
                    event,
                    notifyParticipants: true,
                    idempotencyKey: UUID()
                )
            let timeStr = event.startTime.formatted(date: .abbreviated, time: .shortened)
            let conflicts = result.conflicts
            let suffix: String
            switch conflicts.count {
            case 0:
                suffix = "."
            case 1:
                suffix = " (with one scheduled conflict)."
            default:
                suffix = " (with \(conflicts.count) scheduled conflicts)."
            }
            return .result(
                dialog: "Added \(event.title) for \(timeStr)\(suffix)"
            )
        } catch {
            return .result(
                dialog: "I couldn't add that event. Check your connection and try again in the app."
            )
        }
    }
}

// MARK: - Errors

private enum AppIntentError: Error {
    case invalidConfiguration
    case notRemoteMode
    case oauthRequired
}

// MARK: - Siri time/date parsing lives in FamilyCore (SiriTimeParser.swift)
