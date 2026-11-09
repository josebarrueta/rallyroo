# Calendar account interoperability preview

**Status: experimental, disabled by default, no production activation or new TestFlight delivery yet. The temporary endpoint is stopped; the tester chose [account-restricted in-app testing with the existing Family](caldav-in-app-testing.md). This is not the completed default-calendar feature.**

The implementation is an incremental preview toward [the CalDAV design](caldav-default-calendar-design.md). It is not a general-purpose/conformant CalDAV server and intentionally does not advertise the `calendar-access` DAV compliance token. A physical Apple client may require additional protocol behavior before accepting the account. Do not enable this broadly or change a phone's default silently. Existing-Family testing requires explicit tester consent and the restricted activation gates in the in-app testing guide.

## Current scope

- An explicit operator-selected identity cohort, checked for both credential enrollment and every DAV request. Other accounts do not see the in-app entry. Owner revocation remains permitted after removal from the cohort.
- Individual parent-owned, revocable calendar connections; at most ten per identity. Each password is a server-generated 256-bit secret, returned once. The database stores only its SHA-256 verifier.
- One calendar view of **confirmed, timed or all-day, non-recurring native Family Events**. Recurring/series, imported, pending-review Events and Reminders are excluded from this preview view. This is clearly labeled in the iOS UI and calendar description.
- Conditional create/update/delete, strong GET ETags, full resource listings, calendar-query time ranges, and calendar-multiget. No incremental synchronization, journal/tombstones, WebDAV locking, arbitrary collection creation, free/busy, email invitation scheduling, or push support is claimed.
- Existing native participants, drivers, arrival targets and other native-only fields survive supported Apple Calendar edits. A time edit that would invalidate an arrival target is rejected.
- Incoming calendar bytes, UIDs, client-selected names, notes, alarms and extension properties are retained encrypted per Family. Native title/time/location edits update the served representation and ETag without clearing unknown properties. Calendar notes and alarms are not yet integrated with native note display or server alert scheduling. Calendar clients may execute their own alarms; do not assume notification parity.
- All-day resources retain Gregorian start/exclusive end dates and a stable named anchor zone for native conflicts and alerts. Display preserves dates across device zones. A missing all-day end defaults to the next date; day/week durations are accepted. DST midnight gaps/folds use the first real instant, while entirely skipped anchor dates, mixed DATE/date-time bounds, and clock-based all-day durations are rejected. All-day native alerts default off; older-client title edits retain dates and alert settings. Changing dates requires matching canonical instants; explicit `allDay: null` converts to timed.
- Each connection has a named calendar zone (default UTC; new iOS connections use the device zone). It initializes new all-day Events and interprets floating-date report ranges. Edits through another connection retain an existing Event's anchor. Report-level `<c:timezone>` overrides are currently rejected rather than ignored.
- Recurring, floating timed-value and invitation writes are explicitly rejected without saving. Private/confidential classification and transparent/free-time Events are rejected because native Family Events are shared and occupy Schedule time. Only bounded DISPLAY alarms are retained. Zoned timed Events require a self-contained supported VTIMEZONE; the parser accepts a bounded annual-rule profile and never downloads time-zone data, attachments, or hrefs. Native time edits currently serialize both endpoints in UTC while retaining the opaque original VTIMEZONE; lossless native time-zone identity is still future work.
- Safety limits: 64 KiB per submitted resource, 1,000 native Events, 1 MiB of aggregate retained calendar data, 100 multiget hrefs, XML nesting depth 16, and 4 MiB per XML response. Requests exceeding limits fail rather than return a misleading partial full listing.
- Writes require `If-None-Match: *` for creation or `If-Match` for updates/deletes. Stale operations fail with 412. Conditional checks and Event/resource persistence run under the same Family transaction. Retried creates cannot duplicate native Events.

## Non-production setup

1. Apply migrations through `039_all_day_anchor_guard.sql` with the existing migration runner against an isolated development database. `037` adds credential verifier and encrypted resource-binding tables; `038` adds all-day metadata and connection zones; `039` prevents older API images from changing all-day instants behind unchanged date metadata. Do not edit previously applied migrations.
2. Start the API against that database and a non-production identity project. Set `CALDAV_PREVIEW_PUBLIC_ORIGIN` to the exact HTTPS origin (for example `https://calendar.example`, without a trailing slash or path) and `CALDAV_PREVIEW_IDENTITY_SUBJECTS` to a JSON array containing only the chosen parent identity subjects. No wildcard is accepted. Keep real identity IDs outside Git; leave both fields empty unless the operator explicitly activates a restricted preview.
3. Provide HTTPS externally, ensure plain HTTP is not reachable for authenticated calendar operations, and check that the proxy forwards WebDAV verbs and request bodies. Do not trust client-supplied forwarding headers or relax TLS validation. The API does not derive discovery URLs from Host headers.
4. Use a synthetic parent and Family. In an app built from this branch, open Settings → Apple Calendar preview → Use Rallyroo in Apple Calendar. Disabled servers return an explicit unavailable message.
5. Read the limited scope/access warning and create a password. Store it securely before switching apps: the app clears its one-time password view when it leaves the foreground. List responses never return password verifiers or plaintext passwords; a lost password must be revoked and replaced.
6. Test account setup on a non-primary physical iPhone. Enter the HTTPS server URL ending in `/dav/`, opaque username and one-time password in Settings → Apps → Calendar → Calendar Accounts → Add Account → Add Other Account → CalDAV account. Keep SSL enabled. Labels vary with iOS version.
7. Record whether Apple accepts the account and displays a writable calendar. Only after this passes, test selecting **Rallyroo Family (calendar preview)** under Default Calendar and use a plain Siri request without “Rallyroo.” Verify the destination manually. Do not infer acceptance from server tests or an App Shortcut working.

No configuration profiles, production credentials, certificates, or real Family data belong in fixtures, screenshots, issues, logs, or this guide. A revocation prevents future access, not access to copies already cached on a device. Remove the calendar account from the phone when the test is complete; do not delete server Events just to remove local copies.

## JSON management interface

These routes are present only when the preview is explicitly enabled. They require ordinary Rallyroo Bearer authentication and a current parent account. A calendar password cannot authenticate these or any other JSON routes.

- `GET /v1/calendar-connections`: `{ serverURL, connections: [{ id, username, createdAt, timeZone }] }`, scoped to the current parent.
- `POST /v1/calendar-connections`: optional `{ timeZone }` body (a named IANA zone, default `UTC`; numeric-offset identifiers are rejected); returns 201 with `{ id, username, createdAt, timeZone, serverURL, password }`. The password is not retrievable again. If the response is lost, list/revoke the orphan connection before retrying. Creation is rate-limited and capped at ten active connections.
- `DELETE /v1/calendar-connections/:id`: revoke the current parent's connection; 204 on success, 404 for absent or another parent's connection. A lost response can be resolved by listing connections.

CalDAV Basic authentication is isolated to `/dav/` and its registered descendants. Each request re-checks the connection and its owner's current parent role, Family, and Member. Discovery at `/.well-known/caldav` redirects to the configured server URL. Invalid/revoked credentials return a Basic challenge without disclosing account existence.

## Verification

See [physical-iPhone acceptance status](caldav-device-acceptance.md) for the isolated endpoint's edge checks and still-pending device observations.

- `cd server/api && npm run typecheck && npm run test:unit`
- `INTEGRATION_DATABASE_URL=... npm run test:integration` against disposable PostgreSQL/Redis services; the PostgreSQL suite includes encrypted persistence, concurrent create, native edit, stale ETag, and owner deletion coverage.
- `INTEGRATION_DATABASE_URL=... npm run test:migrations`
- `swift test --package-path clients/ios` (set the local contract server URL to execute the live-contract case rather than skip it).
- UI regressions: `testCalendarAccountPreviewRequiresConsentAndCanRevokeOneTimeCredentials` and `testAllDayEventCanBeSavedReopenedAndExplicitlyConvertedToTimed` use synthetic local fixtures, never a real calendar password.

Local validation: TypeScript typecheck; 447 API unit tests passed (one optional live-provider test skipped); 38 PostgreSQL/Redis integration tests passed, including 15 concurrent snapshot reads, all-day persistence, and older-image anchor guards; migration deployment contract passed; all 275 Swift core/live-contract tests passed without skips; iOS simulator app and UI-test targets built successfully. The rendered Docker NGINX/API contract also passed for the opt-in DAV edge and all supported methods. The new UI regressions have **not executed locally**: local `simctl list devices available` repeatedly timed out. Physical-device CalDAV account setup and default-Siri routing have **not** been tested.

Before release, complete the design's remaining protocol, recurrence/series model, native note/alarm and timed-zone semantics, interoperability, privacy, backup/restore and physical-device gates. The preview's full-listing synchronization must be verified for deletion convergence before relying on it; RFC 6578 is neither advertised nor implemented.
