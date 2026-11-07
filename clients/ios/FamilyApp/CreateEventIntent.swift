import AppIntents
import FamilyCore
import Foundation
#if compiler(>=6.4)
import GeoToolbox
#endif

actor NoOpOAuthWebSession: OAuthWebSession {
    func authenticate(using authorizationURL: URL, callbackScheme: String) async throws -> URL {
        throw SiriEventError.signInRequired
    }
}

@available(iOS 16.0, *)
struct CreateEventIntent: AppIntent {
    static let title: LocalizedStringResource = "Create a family schedule event"
    static let description = IntentDescription("Creates a new event in the Rallyroo family schedule.")
    static let openAppWhenRun = false

    @Parameter(
        title: "Event title",
        description: "What should the event be called?",
        requestValueDialog: "What should I call the event?"
    )
    var eventTitle: String

    @Parameter(
        title: "Start date",
        description: "When does the event start?",
        requestValueDialog: "When does the event start?"
    )
    var startDate: Date

    @Parameter(title: "End date", description: "When does the event end?")
    var endDate: Date?

    @Parameter(title: "Family member", description: "Who is the event for?")
    var memberName: String?

    @Parameter(title: "Location", description: "Where is the event?")
    var location: String?

    @Parameter(title: "Notes", description: "Additional event details")
    var notes: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$eventTitle) at \(\.$startDate)") {
            \.$endDate
            \.$memberName
            \.$location
            \.$notes
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        do {
            let service = try await SiriEventEnvironment.makeCreationService()
            let result = try await service.create(VoiceEventCreationRequest(
                title: eventTitle,
                startTime: startDate,
                endTime: endDate,
                memberName: memberName,
                location: location,
                notes: notes
            ))
            return .result(dialog: SiriEventDialog.success(for: result))
        } catch let error as VoiceEventCreationError {
            return .result(dialog: SiriEventDialog.failure(for: error))
        } catch SiriEventError.signInRequired {
            return .result(dialog: "Sign in to Rallyroo in the app, then try again.")
        } catch {
            return .result(dialog: "I couldn’t add that event. Check your connection and try again.")
        }
    }
}

@available(iOS 16.0, *)
struct RallyrooAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CreateEventIntent(),
            phrases: [
                "Create an event with \(.applicationName)",
                "Add a family event in \(.applicationName)",
                "Schedule with \(.applicationName)",
            ],
            shortTitle: "Create family event",
            systemImageName: "calendar.badge.plus"
        )
    }
}

private enum SiriEventEnvironment {
    static func makeCreationService() async throws -> VoiceEventCreationService {
        guard let configuration = try? AppConfiguration.load(),
              configuration.dataMode == .remote,
              let baseURL = configuration.remoteBaseURL else {
            throw SiriEventError.invalidConfiguration
        }

        let transport = URLSessionHTTPTransport()
        let authentication = RemoteAuthentication(
            baseURL: baseURL,
            transport: transport,
            webSession: NoOpOAuthWebSession(),
            sessionStore: KeychainAuthSessionStore()
        )
        guard let session = try await authentication.currentSession() else {
            throw SiriEventError.signInRequired
        }
        let authenticatedTransport = AuthenticatedHTTPTransport(
            transport: transport,
            authentication: authentication
        )
        let eventStore = RemoteEventStore(
            baseURL: baseURL,
            transport: authenticatedTransport,
            accountID: { session.accountID }
        )
        let memberStore = RemoteFamilyMemberStore(
            baseURL: baseURL,
            transport: authenticatedTransport
        )
        return VoiceEventCreationService(eventStore: eventStore, memberStore: memberStore)
    }
}

private enum SiriEventDialog {
    static func success(for result: VoiceEventCreationResult) -> IntentDialog {
        let time = result.event.startTime.formatted(date: .abbreviated, time: .shortened)
        switch result.conflicts.count {
        case 0:
            return "Added \(result.event.title) for \(time)."
        case 1:
            return "Added \(result.event.title) for \(time), with one scheduled conflict."
        default:
            return "Added \(result.event.title) for \(time), with \(result.conflicts.count) scheduled conflicts."
        }
    }

    static func failure(for error: VoiceEventCreationError) -> IntentDialog {
        IntentDialog(stringLiteral: failureMessage(for: error))
    }

    static func failureMessage(for error: VoiceEventCreationError) -> String {
        switch error {
        case .emptyTitle:
            "The event needs a title."
        case .endTimeMustFollowStartTime:
            "The event must end after it starts."
        case .memberStoreUnavailable:
            "I couldn’t look up family members. Try again in the app."
        case .memberNotFound(let name):
            "I couldn’t find a family member named \(name)."
        case .ambiguousMember(let name):
            "More than one family member is named \(name). Choose the person in the app."
        }
    }
}

private enum SiriEventError: Error {
    case invalidConfiguration
    case signInRequired
}

#if compiler(>=6.4)
// MARK: - Calendar App Schema (iOS 27+)

@available(iOS 27.0, *)
@AppEntity(schema: .calendar.calendar)
struct RallyrooCalendarEntity: AppEntity {
    let id: String
    @Property var title: String

    static let defaultQuery = RallyrooCalendarQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", image: .init(systemName: "person.3"))
    }

    init(id: String = "rallyroo-family", title: String = "Rallyroo Family") {
        self.id = id
        self.title = title
    }
}

@available(iOS 27.0, *)
struct RallyrooCalendarQuery: EnumerableEntityQuery, EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [RallyrooCalendarEntity] {
        identifiers.contains("rallyroo-family") ? [RallyrooCalendarEntity()] : []
    }

    func allEntities() async throws -> [RallyrooCalendarEntity] {
        [RallyrooCalendarEntity()]
    }

    func entities(matching string: String) async throws -> [RallyrooCalendarEntity] {
        let calendar = RallyrooCalendarEntity()
        return calendar.title.localizedCaseInsensitiveContains(string) ? [calendar] : []
    }
}

@available(iOS 27.0, *)
@AppEnum(schema: .calendar.attendeeStatus)
enum RallyrooAttendeeStatus: String {
    case accepted
    case declined
    case tentative

    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .accepted: "Accepted", .declined: "Declined", .tentative: "Tentative"
    ]
}

@available(iOS 27.0, *)
@AppEnum(schema: .calendar.attendeeType)
enum RallyrooAttendeeType: String {
    case person

    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [.person: "Person"]
}

@available(iOS 27.0, *)
@AppEntity(schema: .calendar.attendee)
struct RallyrooCalendarAttendee: TransientAppEntity {
    @Property var person: IntentPerson
    @Property var status: RallyrooAttendeeStatus?
    @Property var isAttendanceOptional: Bool
    @Property var type: RallyrooAttendeeType?

    var displayRepresentation: DisplayRepresentation { person.displayRepresentation }

    init() {
        person = IntentPerson(identifier: .unknown, name: .unknown, handle: nil)
        status = nil
        isAttendanceOptional = false
        type = .person
    }

    init(person: IntentPerson, isAttendanceOptional: Bool = false) {
        self.person = person
        status = nil
        self.isAttendanceOptional = isAttendanceOptional
        type = .person
    }
}

@available(iOS 27.0, *)
@UnionValue
enum RallyrooCalendarLocation {
    case place(PlaceDescriptor)
    case address(String)

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Event Location"
    static let caseDisplayRepresentations: [Cases: DisplayRepresentation] = [
        .place: "Place",
        .address: "Address"
    ]

    var text: String {
        switch self {
        case let .place(place):
            if let commonName = place.commonName, !commonName.isEmpty { return commonName }
            for representation in place.representations {
                if case let .address(address) = representation { return address }
            }
            return place.description
        case let .address(address):
            return address
        }
    }
}

@available(iOS 27.0, *)
@UnionValue
enum RallyrooEventAlarm {
    case duration(Duration)
    case date(Date)

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Event Alarm"
    static let caseDisplayRepresentations: [Cases: DisplayRepresentation] = [
        .duration: "Before Event", .date: "At Date"
    ]
}

@available(iOS 27.0, *)
@AppEnum(schema: .calendar.eventStatus)
enum RallyrooCalendarEventStatus: String {
    case confirmed
    case tentative
    case cancelled

    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .confirmed: "Confirmed", .tentative: "Tentative", .cancelled: "Cancelled"
    ]
}

@available(iOS 27.0, *)
@AppEntity(schema: .calendar.event)
struct RallyrooCalendarEventEntity: AppEntity {
    let id: UUID
    @Property var calendar: RallyrooCalendarEntity
    @Property var title: String
    @Property var startDate: Date
    @Property var endDate: Date
    @Property var isAllDay: Bool
    @Property var recurrence: Foundation.Calendar.RecurrenceRule?
    @Property var note: AttributedString?
    @Property var travelTime: Duration?
    @Property var location: RallyrooCalendarLocation?
    @Property var virtualLocation: URL?
    @Property var status: RallyrooCalendarEventStatus?
    @Property var alarms: [RallyrooEventAlarm]
    @Property var organizers: [IntentPerson]
    @Property var attendees: [RallyrooCalendarAttendee]

    static let defaultQuery = RallyrooCalendarEventQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", image: .init(systemName: "calendar"))
    }

    init(
        event: FamilyEvent,
        isAllDay: Bool,
        recurrence: Foundation.Calendar.RecurrenceRule?,
        attendees: [RallyrooCalendarAttendee]
    ) {
        id = event.id
        calendar = RallyrooCalendarEntity()
        title = event.title
        startDate = event.startTime
        endDate = event.endTime
        self.isAllDay = isAllDay
        self.recurrence = recurrence
        note = event.notes.map(AttributedString.init)
        travelTime = nil
        location = event.location.map(RallyrooCalendarLocation.address)
        virtualLocation = nil
        status = .confirmed
        alarms = []
        organizers = []
        self.attendees = attendees
    }
}

@available(iOS 27.0, *)
struct RallyrooCalendarEventQuery: EntityQuery {
    func entities(for identifiers: [UUID]) async throws -> [RallyrooCalendarEventEntity] { [] }
}

@available(iOS 27.0, *)
@AppIntent(schema: .calendar.createEvent)
struct CreateRallyrooCalendarEventIntent {
    @Parameter var title: String
    @Parameter var startDate: Date
    @Parameter var endDate: Date?
    @Parameter var calendar: RallyrooCalendarEntity
    @Parameter var location: RallyrooCalendarLocation?
    @Parameter var isAllDay: Bool
    @Parameter var attendees: [RallyrooCalendarAttendee]
    @Parameter var recurrence: Foundation.Calendar.RecurrenceRule?
    @Parameter var note: AttributedString?

    func perform() async throws -> some IntentResult & ReturnsValue<RallyrooCalendarEventEntity> & ProvidesDialog {
        do {
            let service = try await SiriEventEnvironment.makeCreationService()
            let result = try await service.create(VoiceEventCreationRequest(
                title: title,
                startTime: startDate,
                endTime: endDate,
                isAllDay: isAllDay,
                memberNames: try attendeeNames(),
                location: location?.text,
                notes: note.map(String.init),
                recurrence: try eventRecurrence()
            ))
            return .result(
                value: RallyrooCalendarEventEntity(
                    event: result.event,
                    isAllDay: isAllDay,
                    recurrence: recurrence,
                    attendees: attendees
                ),
                dialog: SiriEventDialog.success(for: result)
            )
        } catch let error as VoiceEventCreationError {
            throw SiriCalendarIntentError.message(SiriEventDialog.failureMessage(for: error))
        } catch SiriEventError.signInRequired {
            throw SiriCalendarIntentError.message("Sign in to Rallyroo in the app, then try again.")
        } catch let error as SiriCalendarIntentError {
            throw error
        } catch {
            throw SiriCalendarIntentError.message("I couldn’t add that event. Check your connection and try again.")
        }
    }

    private func attendeeNames() throws -> [String] {
        try attendees.map { attendee in
            let name: String
            switch attendee.person.name {
            case let .displayName(displayName):
                name = displayName
            case let .components(components):
                name = PersonNameComponentsFormatter().string(from: components)
            case .unknown:
                throw SiriCalendarIntentError.message("I couldn’t determine one attendee’s name.")
            @unknown default:
                throw SiriCalendarIntentError.message("I couldn’t determine one attendee’s name.")
            }
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw SiriCalendarIntentError.message("I couldn’t determine one attendee’s name.")
            }
            return name
        }
    }

    private func eventRecurrence() throws -> EventRecurrence? {
        guard let rule = recurrence else { return nil }
        guard rule.calendar.identifier == .gregorian,
              rule.months.isEmpty,
              rule.daysOfTheYear.isEmpty,
              rule.weeks.isEmpty,
              rule.hours.isEmpty,
              rule.minutes.isEmpty,
              rule.seconds.isEmpty,
              rule.setPositions.isEmpty else {
            throw unsupportedRecurrence()
        }

        let recurrenceEnd: Date
        if let date = rule.end.date {
            recurrenceEnd = date
        } else if let count = rule.end.occurrences {
            var last = startDate
            for (index, date) in rule.recurrences(of: startDate).enumerated() {
                if index >= count { break }
                last = date
            }
            recurrenceEnd = last
        } else {
            recurrenceEnd = Foundation.Calendar.current.date(byAdding: .month, value: 6, to: startDate)!
        }

        switch rule.frequency {
        case .daily:
            guard rule.weekdays.isEmpty else { throw unsupportedRecurrence() }
            return EventRecurrence(
                frequency: .daily,
                interval: rule.interval,
                endDate: recurrenceEnd,
                timeZone: TimeZone.autoupdatingCurrent.identifier
            )
        case .weekly:
            let weekdays = rule.weekdays.isEmpty
                ? [Self.weekday(for: startDate)]
                : try rule.weekdays.map { weekday in
                    guard case let .every(day) = weekday else { throw unsupportedRecurrence() }
                    return Self.weekday(day)
                }
            return EventRecurrence(
                frequency: .weekly,
                interval: rule.interval,
                weekdays: weekdays,
                endDate: recurrenceEnd,
                timeZone: TimeZone.autoupdatingCurrent.identifier
            )
        case .monthly:
            guard rule.weekdays.isEmpty else { throw unsupportedRecurrence() }
            return EventRecurrence(
                frequency: .monthly,
                interval: rule.interval,
                endDate: recurrenceEnd,
                timeZone: TimeZone.autoupdatingCurrent.identifier
            )
        default:
            throw unsupportedRecurrence()
        }
    }

    private func unsupportedRecurrence() -> SiriCalendarIntentError {
        .message("That repeat schedule isn’t supported yet. Try daily, weekly, or monthly.")
    }

    private static func weekday(for date: Date) -> EventRecurrence.Weekday {
        let value = Foundation.Calendar.current.component(.weekday, from: date)
        return [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday][value - 1]
    }

    private static func weekday(_ weekday: Locale.Weekday) -> EventRecurrence.Weekday {
        switch weekday {
        case .sunday: .sunday
        case .monday: .monday
        case .tuesday: .tuesday
        case .wednesday: .wednesday
        case .thursday: .thursday
        case .friday: .friday
        case .saturday: .saturday
        @unknown default: .monday
        }
    }
}

private enum SiriCalendarIntentError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case let .message(message): message
        }
    }
}
#endif
