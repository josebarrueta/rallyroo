# Public site released-feature inventory

This checklist prevents the Member-facing site from drifting behind the TestFlight app. It is not a roadmap. A checked item means the capability was verified in the tagged iOS source and is described publicly; it does not guarantee that every tester has the same build or that an external provider is available.

**Last review:** v0.11.19 (`80c1fa1`), October 5, 2026

**Public guide:** [`public/docs.html`](public/docs.html)

## Release review procedure

For every TestFlight release that changes Member-visible behavior:

1. Compare this inventory with the release tag, `CONTEXT.md`, iOS UI, and relevant product design document.
2. Check only shipped, enabled behavior. Describe provider or rollout dependencies as limitations.
3. Update the public guide, homepage summary when the capability is major, this review stamp, and the guide's build-freshness notice.
4. Keep Events distinct from Reminders, imported data distinct from Rallyroo-owned data, and proposals distinct from saved records.
5. Review Privacy Policy or Terms changes separately; do not turn legal pages into marketing copy.
6. Run `npm test` and `npm run deploy:dry-run` from `site/`, then verify production routes after deployment.

## Member-facing inventory

- [x] TestFlight beta status and access route
- [x] Apple and Google sign-in
- [x] Create a Family or join through an expiring invitation
- [x] Parent and kid roles, guardian confirmation, invitation resend/cancel
- [x] Family Member profiles and parent management
- [x] Native Events with participants, drivers, locations, alerts, conflicts, and recurrence
- [x] Occurrence-level edit, skip, restore, and delete scopes
- [x] Reminders with assignees, alerts, recurrence, shared completion, and parent reopen
- [x] Google Calendar, TeamSnap, Outlook, and generic iCalendar onboarding
- [x] One-way read-only imports, Personal/Family visibility, sync status, and troubleshooting
- [x] Member Alerts inbox, read state, deep links, and saved conflict controls
- [x] Private Day Brief settings and detail view
- [x] Day Brief Home weather, Timeline, Reminders, and weather attribution
- [x] Arrival targets, explicit driving Travel plans, Saved places, route preview, and leave alerts
- [x] AI schedule drafts from typed text and voice
- [x] AI schedule drafts from on-device image text recognition and the iOS Share extension
- [x] Review/clarification requirement before any draft is saved
- [x] Shopping routines, Pantry catalog, Family requests, Stock observations, reviewed trip plans, outcomes, and Purchase history
- [x] Parent-only manual Expenses ledger
- [x] Receipt photo OCR, review-only Expense proposal, and opt-in Pantry/request suggestions
- [x] Commuter installation, Caltrain subscriptions, alerts, live train data, and separate provider health
- [x] Notification, microphone, speech, photo/camera, calendar-link, and location privacy controls
- [x] Sign out, in-app account deletion, Support, Privacy, and Terms routes
- [x] Provider, notification, AI, beta, and emergency-use limitations

## Primary verification sources

- Member language and privacy boundaries: [`../CONTEXT.md`](../CONTEXT.md)
- App composition and role gates: `../clients/ios/FamilyApp/FamilyActivityCoordinatorApp.swift`
- Schedule and occurrences: `WeeklyScheduleView.swift`, `AddEventSheet.swift`, `RemindersView.swift`
- Alerts and Day Brief: `NotificationsView.swift`, `SettingsView.swift`
- AI capture and sharing: `ScheduleCaptureSheet.swift`, `../clients/ios/FamilyAppShare/ShareViewController.swift`
- Travel: `TravelPlanSheet.swift`, [`../docs/event-travel-planning-design.md`](../docs/event-travel-planning-design.md)
- Household: `SettingsView.swift`, [`../docs/day-brief-and-shopping-design.md`](../docs/day-brief-and-shopping-design.md), [`../docs/household-expenses.md`](../docs/household-expenses.md)
- Connected calendars: `SettingsView.swift`, [`../docs/connected-calendar-guidance.md`](../docs/connected-calendar-guidance.md)
- Commuter: `CommuterSettingsView.swift`, [`../docs/511-open-data-module-research.md`](../docs/511-open-data-module-research.md)
