# Rallyroo HTTP adapter contract

This contract is backend-vendor neutral. A custom server, Supabase Edge Functions,
or another provider can implement it. All successful responses use a 2xx status;
JSON requests use `Content-Type: application/json`. Dates are ISO 8601 strings.

## Push notifications

- `PUT /v1/devices/{apnsToken}` registers or transfers the authenticated device.
- `DELETE /v1/devices/{apnsToken}` removes that member's device.

Event creates and updates send family-scoped APNs alerts. Conflict writes use a
conflict-specific message. Scheduled native-event alerts are sent only to devices
registered by the event's participants, including each occurrence of a recurring event.
Due reminder alerts are sent only to devices registered by the reminder's assignees.
Device registration is optional, and APNs failures never roll back PostgreSQL
source-of-truth data.

## Notification inbox

- `GET /v1/notifications` lists at most 100 newest durable inbox records belonging
  to the authenticated member.
- `PATCH /v1/notifications/{id}/read` marks only that member's record read.
- `DELETE /v1/notifications/{id}` removes only that member's visible inbox record;
  it terminally cancels pending delivery while retaining non-visible audit state.

Both mutation routes return `204`, or `404` when the record does not belong to the member.

Inbox records are distinct from APNs delivery attempts. Their presentation and typed
opaque destination are encrypted per Family; API responses omit Family IDs and
server-side deduplication digests. Event, Reminder, schedule-update, Commuter, driver,
and saved-conflict producers use distinct categories. APNs work uses separate bounded
claims, stale-claim recovery, exponential backoff, and terminal failure after ten attempts.
Visible records expire after 180 days; member-deleted records retain audit state for 30 days.

## Synchronization

- `GET /v1/changes` → `{ "version": 42 }` for the authenticated family.

Every event, reminder, or family-member mutation advances this cursor. Remote iOS sessions
poll the small cursor every five seconds and reload visible family data only when
it changes. The app also refreshes whenever it becomes active.

## Events

- `GET /v1/events` → JSON array of events.
- `PUT /v1/events/{id}?notifyParticipants=true|false` with an event body → mutation result.
- `DELETE /v1/events/{id}` → empty 2xx response.

Clients should send a stable UUID in `Idempotency-Key` for both mutations and
reuse it only when retrying the same user action. The server accepts older
clients without the header, but can only prevent duplicate effects when the
client supplies a stable key.

Event bodies use the Swift `FamilyEvent` fields, including `id`, `title`,
`participantIDs`, `startTime`, `endTime`, `location`, `driver`, `source`, and
`status`. Native events also support optional `alertLeadTimeMinutes` (`0`, `5`,
`15`, `60`, `1440`, or null) and `recurrence`. An omitted alert on a write defaults
to `0` (at start). `kidID` is temporarily included for
compatibility and may be null. A recurrence contains `frequency` (`daily`,
`weekly`, or `monthly`), a positive `interval`, and an ISO 8601 `endDate`.
Weekly recurrences may include `weekdays`, a unique array using ISO weekday
numbers (`1` Monday through `7` Sunday). Omitting `weekdays` retains legacy
once-per-week behavior. New or updated recurrences must end no more than 732
days after their start, keeping expansion, conflict checks, and alerts bounded.

`notifyParticipants=true` records one durable schedule update notification
intent for devices owned by selected participants, excluding the parent making
the change. Rallyroo attempts delivery immediately for up to two seconds and
retries queued intent in the background. It is separate from
`alertLeadTimeMinutes`, which schedules a notification for each occurrence.
Passing `false` saves without creating the intent. The query defaults to `true`
for older clients.

Save response:

```json
{
  "notificationOutcome": "sent",
  "conflicts": [
    {
      "kind": "overlapping_participant",
      "memberID": "parent-1",
      "driver": null,
      "eventIDs": ["existing-uuid", "new-uuid"]
    }
  ]
}
```

`notificationOutcome` is `sent`, `queuedForRetry`, `noRecipients`, or
`notRequested`. Event persistence succeeds independently of external delivery.

Supported conflict kinds are `overlapping_participant` and
`double_booked_driver`.

Imported calendar events additionally use `source: "calendar"`, `readOnly: true`,
and a `provenance` array containing `sourceID`, `sourceName`, and `externalUID`.
They participate in conflict detection but cannot be edited as native Rallyroo events.
Exact duplicates are consolidated by external identity or normalized title, time,
and location; participant IDs and provenance are combined.

## Reminders

- `GET /v1/reminders` lists reminders visible to the authenticated member. Parents
  see the family's reminders; kids see only reminders assigned to them.
- `PUT /v1/reminders/{id}` creates or updates a reminder. Parents only.
- `POST /v1/reminders/{id}/complete` completes a reminder. Parents and assigned
  kids may complete it; completion is shared and records the authenticated member.
- `POST /v1/reminders/{id}/reopen` reopens a reminder. Parents only.
- `DELETE /v1/reminders/{id}` deletes a reminder. Parents only.

A reminder has a title, one `dueAt` instant, one or more `assigneeIDs`, shared
`status`, and optional `alertLeadTimeMinutes` (`0`, `5`, `15`, `60`, or `1440`).
It has no duration and never participates in event overlap conflict detection.
Members with open assigned reminders cannot be deleted until those reminders are
completed or reassigned.

## AI-assisted schedule drafts

`POST /v1/schedule-drafts` accepts authenticated parent requests containing `text`,
`inputType` (`text`, `voice`, or `image`), and an IANA `timeZone`. It returns strictly
validated event/reminder drafts or clarification questions and never mutates schedule data.
Only transcript or OCR text reaches this endpoint; raw audio and images stay on the device.
Requests are rate-limited and draft member identifiers are restricted to the caller's family.
The endpoint returns `503` when no extraction adapter is configured and `502` when the
configured adapter fails or produces invalid output.

## Commuter module

Commuter is a parent-enabled Family capability. A single Family installation owns
personal and Family-visible commute subscriptions:

- `GET /v1/modules/commuter` returns the installation, independently computed provider
  health, and only subscriptions visible to the authenticated member.
- `GET /v1/modules/commuter/catalog` returns the stations from the last-good normalized
  Caltrain static schedule and its freshness status.
- `POST /v1/modules/commuter/journeys/search` accepts an origin station, destination
  station, and either weekday-only or weekend-only day selection. It returns at most
  500 scheduled trains that operate at the same departure and arrival times on every
  selected day. Parents only; commute selections remain in the request body rather
  than query strings.
- `PUT /v1/modules/commuter` enables the module. Parents only.
- `PATCH /v1/modules/commuter` with `{ "status": "disabled" }` stops provider fan-out
  while preserving configuration. `PUT` enables it again.
- `DELETE /v1/modules/commuter` removes module-owned subscriptions and alert outbox
  records. Native Events previously created through explicit parent action remain
  independent.
- `POST /v1/modules/commuter/subscriptions` creates a personal or Family subscription.
  Parents only.
- `PUT /v1/modules/commuter/subscriptions/{id}` atomically replaces an authorized
  subscription's configuration while preserving its identity, owner, and active/paused
  status. Opaque schedule options and versions are revalidated; stale or fabricated
  journeys are rejected without changing the stored subscription.
- `PATCH /v1/modules/commuter/subscriptions/{id}` accepts an `active` or `paused`
  status. Any parent may manage Family subscriptions; personal subscriptions remain
  owner-only.
- `DELETE /v1/modules/commuter/subscriptions/{id}` follows the same ownership rules.

The initial typed model is Caltrain-only (`agencyID: "CT"`). New subscriptions bind
an opaque static-schedule option, selected weekdays, immutable origin departure and
destination arrival, alert kinds, and minimum delay. The server revalidates the
schedule version and option before saving. Legacy service-window subscriptions remain
readable and continue matching without silent conversion. Commute details are
encrypted per Family in PostgreSQL.

Caltrain's bounded static GTFS schedule is refreshed every 24 hours, normalized behind
the provider adapter, and atomically replaces both the schedule and station catalog.
Malformed, empty, expired, or out-of-order snapshots cannot replace the last-good
schedule. A failed refresh retains that schedule and reports degraded or stale health.
Catalog and real-time health remain independent. Trip Updates and Service Alerts are fetched once per Caltrain polling cycle, decoded
with bounded GTFS-Realtime schemas, rejected when stale, and normalized without
requiring optional Trip Update `start_date` values. Real-time conditions are fanned
out across active subscriptions, must be fresh, and match a scheduled subscription at
its selected origin stop (legacy subscriptions remain route/window-matched). Matches enter
an encrypted PostgreSQL outbox idempotently. The notification dispatcher recovers
stale claims, targets personal alerts only to the owning member and Family alerts to
Family devices, uses privacy-safe generic copy, times out stalled APNs requests, and
retries with bounded exponential backoff. Alerts with no registered devices complete
without an APNs call. Shared production polling uses the approved quota-aware profile.

Live transit data never automatically creates Events or Reminders.

## Calendar subscriptions

Authenticated parents can manage read-only iCalendar subscriptions:

- `POST /v1/calendar-sources` with
  `{ "name", "url", "participantIDs", "visibility": "personal" | "family" }`
  creates a connection and attempts its complete initial import before returning.
  The response remains `201` with `status: "error"` when the connection is saved but
  its first import fails, so the parent can retry. HTTPS links are required;
  `webcal:` links are normalized to HTTPS. Participant IDs must belong to the family.
- `GET /v1/calendar-sources` lists family-shared connections plus personal
  connections owned by the requesting parent, without revealing feed URLs.
- `PATCH /v1/calendar-sources/{id}` with
  `{ "visibility": "personal" | "family" }` changes visibility. Only the parent
  who connected the source can change it.
- `POST /v1/calendar-sources/{id}/sync` atomically refreshes imported events.
- `DELETE /v1/calendar-sources/{id}` removes the connection and its imported events.

Personal source metadata, events, provenance, conflict signals, notifications, and
change cursors are hidden from other family accounts. Family visibility is not
internet publication. New events inherit their source visibility automatically,
and exact deduplication occurs only after access filtering.

Kid sessions receive `403`. Feed URLs are bearer-style secrets encrypted in
PostgreSQL. The reference adapter rejects private-network destinations and limits
redirects, response size, request duration, imported snapshots to 5,000 events, and
recurrence iteration to 50,000 candidates. Non-recurring events in a valid feed are
imported; recurring events are expanded from one year before synchronization through
two years after it. A failed refresh returns `502`, marks the connection as failed,
and preserves the last good schedule.

## Family invitations

- `POST /v1/invitations` with
  `{ "role": "parent" | "kid", "email": "recipient@example.com", "guardianConsent": true | false }`
  creates and emails a single-use, seven-day invitation. Parent authorization is
  required; kid sessions receive `403`. Kid invitations require explicit parent or
  legal-guardian authorization, and the server records when and which family member
  supplied it.
- `GET /v1/invitations` lists pending invitations without exposing their hashed codes.
- `DELETE /v1/invitations/{id}` cancels an invitation in the parent's family.
- `POST /v1/invitations/{id}/resend` rotates its code, extends expiration by seven days,
  and emails the replacement link to the stored recipient address.
- `POST /v1/sessions` may include `invitationCode` with the OAuth exchange.

Invitation delivery uses the provider-neutral `InvitationEmailSender`; the reference
adapter calls Resend. Failed delivery removes or restores the invitation so an
unshared code is never left active. Invitation codes are stored as SHA-256 hashes and embedded in
`rallyroo://invite?code=…` links; the login screen never asks users to type a code.
After opening the link, Apple or Google sign-in submits the embedded code and successful
redemption atomically creates the invited member and account in the inviter's
family. The client never chooses a family ID or overrides the invitation's role.

## Locations

- `GET /v1/locations/search?q=123%20Main` → US address suggestions.

The reference backend uses Google Places with a US region restriction. The iOS
client only knows the provider-neutral `{ "id": "…", "address": "…" }` contract.
Manual location entry remains available when search is not configured.

## Family members

- `GET /v1/family-members` → JSON array of family members.
- `PUT /v1/family-members/{id}` with a family-member body → empty 2xx response.
- `DELETE /v1/family-members/{id}` → empty 2xx response.

Family-member fields are `id`, `name`, `role` (`parent` or `kid`), optional
`gradeOrBirthYear`, and `colorTag`.

## Operations

- `GET /health` is a dependency-free process liveness check.
- `GET /ready` verifies PostgreSQL and returns `503` when unavailable. Redis is
  deliberately excluded because cache failures fall through to source providers.
- `GET /metrics` exports Prometheus metrics. Deployments can require
  `Authorization: Bearer <METRICS_BEARER_TOKEN>`.

Responses include Fastify request IDs. The API applies a global request ceiling
and stricter limits to session exchange, invitation writes, and location search;
limited requests return `429` and `Retry-After`.

## Authentication

The Rallyroo backend owns the identity-provider integration. The iOS client only
uses Rallyroo endpoints and has no Stytch SDK or Stytch configuration.

1. The client generates a PKCE verifier and opens either
   `GET /v1/auth/apple?codeChallenge=…` or `GET /v1/auth/google?codeChallenge=…`
   in a system authentication browser.
2. Rallyroo forwards the challenge and redirects the browser to its configured
   Stytch Apple or Google OAuth flow.
3. Apple or Google redirects through Stytch to `rallyroo://oauth-callback?stytch_token_type=oauth&token=…`.
4. `POST /v1/sessions` with `{ "oauthToken": "…", "codeVerifier": "…" }`
   exchanges the one-time token through the backend's `IdentityProvider` adapter.
5. If the identity is new and has no invitation, the backend atomically provisions
   it as a parent in a new family. Provisioning is idempotent across retries.
6. The backend returns the Rallyroo session contract:

```json
{
  "accountID": "parent-1",
  "displayName": "Alex",
  "role": "parent",
  "accessToken": "opaque-session-token"
}
```

`GET /v1/sessions` validates and restores a persisted client session.

Authenticated requests include `Authorization: Bearer <accessToken>`. The backend
validates the opaque Stytch session through its provider adapter, loads the Rallyroo
account, and applies family and role authorization. `DELETE /v1/sessions` revokes
the hosted session.

`DELETE /v1/account` permanently deletes the authenticated hosted identity and its
Rallyroo account. When another authenticated account remains in the family, shared
family records remain and references to the deleted member are removed. When the
deleted account is the family's last authenticated account, the backend deletes the
entire family dataset, including members, events, reminders, invitations, device tokens, and
connected calendar sources.

No Stytch secret, SDK, configuration, or provider-specific type exists in the iOS
code. The browser only interacts with Stytch after following the Rallyroo redirect.
