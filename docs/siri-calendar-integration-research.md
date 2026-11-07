# Siri event creation integration research

## Conclusion

Yes. Rallyroo can create family schedule events through Siri, and the repository already contains most of a first-generation implementation.

There are two integration levels:

1. **App Shortcut (iOS 16+)** — an explicit phrase such as “Create an event with Rallyroo” launches an App Intent and Siri asks for missing values.
2. **Calendar App Schema (iOS 27+)** — the new `calendar.createEvent` schema lets the new Siri understand natural scheduling language, resolve parameters, ask follow-up questions, and participate in multi-turn conversations without Rallyroo maintaining its own natural-language parser.

The recommended approach is to ship the App Shortcut path for existing supported devices and add a schema-backed implementation for iOS 27 and later.

## What Rallyroo already has

- `clients/ios/FamilyApp/CreateEventIntent.swift` defines an iOS 16 `AppIntent` that creates a remote Rallyroo `FamilyEvent` without opening the app.
- It loads the existing Keychain session, uses the authenticated remote event store, optionally resolves a member by name, saves the event, and reports conflicts.
- `clients/ios/Sources/FamilyCore/SiriTimeParser.swift` parses a limited set of day and time strings.
- The app builds successfully with App Intents metadata extraction.

However, the build reports **“No AppShortcuts found - Skipping.”** There is no `AppShortcutsProvider`, so the action can appear as an action in the Shortcuts app but does not currently have a zero-setup Siri invocation phrase. Apple’s App Shortcuts guidance says an `AppShortcutsProvider` supplies the phrases that make an intent directly available from Siri, Spotlight, and Shortcuts.

## What the new iOS capability adds

The installed iOS 27 SDK exposes a Calendar App Schema with:

- `calendar.createEvent`
- `calendar.updateEvent`
- `calendar.deleteEvent`
- Calendar, Event, and Attendee entity schemas

The SDK marks the Calendar schema as available from iOS 27. Apple’s calendar integration guidance demonstrates a schema-backed Create Event intent that receives structured title, dates, calendar, location, recurrence, and related values. Siri performs the natural-language interpretation, clarification, and confirmation.

This is a substantially better fit than Rallyroo’s current `dayText` and `timeText` strings. For example, Siri can interpret a request such as “Create soccer practice in Rallyroo next Tuesday at 5 for Alex” into structured parameters rather than requiring Rallyroo to parse “next Tuesday” and “5” itself.

## Gaps in the current implementation

### Direct Siri discoverability

Add one `AppShortcutsProvider` with a small set of memorable phrases containing `\.applicationName`, for example:

- “Create an event with Rallyroo”
- “Add a family event in Rallyroo”
- “Schedule with Rallyroo”

Open-ended event titles cannot be embedded in an App Shortcut trigger phrase. Siri should invoke the shortcut and then collect required open-ended values. Apple documents parameterized trigger phrases as suitable for predefined entity values, not arbitrary strings.

### Parameter modeling

The current intent models day, time, and member as free-form strings. Prefer:

- Native `Date` or structured date parameters.
- A Rallyroo member `AppEntity`, backed by an entity query, rather than exact string matching.
- A parameter summary that includes all important parameters.
- Required values or explicit value prompts for title and start date rather than silently creating “New Event” at the current time.

### iOS 27 Calendar schema

Add a separate iOS 27 schema-backed intent using:

```swift
@available(iOS 27.0, *)
@AppIntent(schema: .calendar.createEvent)
struct CreateRallyrooEventIntent {
    // Schema parameters and perform implementation
}
```

The intent should call a shared event-creation service also used by the existing iOS 16 App Intent. This avoids duplicating authentication, member resolution, event construction, conflict reporting, and persistence.

For the fullest iOS 27 integration, Rallyroo should also model its events and members/calendars as schema-backed App Entities. Indexed event entities would later enable requests such as “When is soccer practice?”, “Move this event to 6,” and “Who is attending this event?” Apple recommends Spotlight indexing for semantic entity resolution.

### Correctness and UX

Before release, address these current behaviors:

- `eventTitle` defaults to “New Event,” so missing speech input can create an unintended event.
- Missing or unrecognized day/time input falls back to the current time without confirmation.
- The parser documentation mentions minute values such as `3:30pm`, but the implementation discards minutes.
- Exact member-name matching can silently produce an event with no participant when there is no match or ambiguity.
- Authentication and network failures are converted into generic success-style dialog results instead of typed intent errors or actionable prompts.
- User-facing dialog and metadata should be localized.

## Suggested rollout

### Phase 1 — low-risk, broad compatibility

1. Add `AppShortcutsProvider` for the existing intent.
2. Make title and start date required/prompted.
3. Replace day/time strings with native date input where practical.
4. Add a member `AppEntity` and disambiguation.
5. Test on a physical device through Shortcuts and Siri.

This provides useful Siri event creation on the app’s existing iOS 16 deployment target.

### Phase 2 — iOS 27 natural-language integration

1. Extract shared event-creation logic from `CreateEventIntent.swift`.
2. Add the `calendar.createEvent` schema-backed intent under an iOS 27 availability guard.
3. Add schema-backed Calendar/Event/Attendee entities as needed.
4. Index events if Rallyroo wants Siri search, follow-up, update, and delete experiences.
5. Add App Intents integration tests when adopting the new testing framework, plus physical-device Siri tests.

## Feasibility assessment

- **Technical feasibility:** High. The current authenticated event save path already works from an App Intent.
- **Smallest useful change:** Add an `AppShortcutsProvider` and fix required parameter handling.
- **Best new-iOS experience:** Adopt `calendar.createEvent` on iOS 27 while retaining an App Shortcut fallback.
- **Main risks:** Silent defaults, ambiguous member resolution, authentication state, availability on devices without the new Siri/Apple Intelligence experience, and insufficient physical-device testing.

## Primary sources

- Apple, [App Intents](https://developer.apple.com/documentation/appintents/app-intents.md) — App Intents expose app actions to Siri, Spotlight, and Shortcuts.
- Apple, [App Shortcuts](https://developer.apple.com/documentation/appintents/app-shortcuts) — zero-setup shortcuts and invocation phrases.
- Apple, [Implement App Shortcuts with App Intents (WWDC22)](https://developer.apple.com/videos/play/wwdc2022/10170/) — `AppShortcutsProvider`, phrase requirements, prompts, and parameterized-phrase limitations.
- Apple, [Bring your app’s core features to users with App Intents (WWDC24)](https://developer.apple.com/videos/play/wwdc2024/10210/) — App Intents, entities, App Shortcuts, Siri, and Spotlight integration.
- Apple, [Calendar App Schema](https://developer.apple.com/documentation/appintents/app-schema-domain-calendar) — Calendar-domain schemas.
- Apple, [`calendar.createEvent`](https://developer.apple.com/documentation/appintents/appschema/calendarintent/createevent) — Create Event schema.
- Apple, [Integrating your calendar app with Apple Intelligence](https://developer.apple.com/documentation/appintents/integrating-your-calendar-app-with-apple-intelligence) — calendar entities and actions.
- Apple, [Code-along: Make your app available to Siri (WWDC26)](https://developer.apple.com/videos/play/wwdc2026/344/) — end-to-end Calendar schema implementation and Siri event creation.
