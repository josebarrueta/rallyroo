# Rallyroo as the iPhone default calendar through CalDAV

Status: **experimental non-recurring timed/all-day preview implemented locally; account-restricted existing-Family in-app test requested, no production activation or new TestFlight delivery yet**. The complete design below remains the target, not a claim that all release gates have passed.

## Implemented preview

The backend has opt-in, parent-scoped calendar credentials; encrypted resource bindings; conditional non-recurring timed/all-day create/update/delete through the existing Event mutation transaction; discovery properties; bounded namespace-aware XML; full ETag listings; calendar-query and calendar-multiget. The iOS app has parent-only setup, one-time password presentation, revocation, and an all-day editor/display. PostgreSQL and HTTP tests cover encryption, retries/concurrency, stale writes, hidden Family fields, credential isolation, and date-only persistence across native edits.

All-day identity is explicit: Gregorian start/exclusive end dates plus a stable IANA anchor zone determine the native scheduling instants; display retains the dates across viewing zones. Connection zones initialize new date-only resources and interpret report ranges; existing Event anchors are preserved when another connection edits them. Default next-day ends, day/week durations, DST gaps/folds, explicit conversion to timed, and older-client mutation guards are covered by tests. Entirely skipped anchor dates and all-day recurrence fail closed.

**This is an interoperability preview, not a conformant/release-ready CalDAV server.** It does not advertise the `calendar-access` DAV compliance token or RFC 6578 synchronization. Recurring/series, pending-review and imported Events are excluded; writes using recurrence, floating timed values, invitations, or unsupported time-zone rules are explicitly rejected. Extension data, notes and alarms remain encrypted in the retained calendar representation but are not mapped to native Rallyroo note/alert behavior. ETags for supported native changes are derived from the current Event plus its preserved representation; no incremental journal/tombstone support is claimed.

Routes stay unregistered unless `CALDAV_PREVIEW_PUBLIC_ORIGIN` and an explicit `CALDAV_PREVIEW_IDENTITY_SUBJECTS` JSON cohort are configured. Broad activation remains forbidden; the tester approved the [restricted in-app existing-Family path](caldav-in-app-testing.md), whose backend/operator and CI gates must pass first. See [preview setup and limitations](caldav-preview.md). **Physical-iPhone account discovery, default selection, and generic Siri routing have not been verified.** Do not expose this beyond the approved test account or describe the requested default-calendar feature as complete.

## Requested outcome

A parent adds Rallyroo as a writable calendar account in iPhone Settings, explicitly selects its calendar as Default Calendar, and can say “Siri, add dentist tomorrow at 3 PM” without naming Rallyroo. The event should be saved to the native Rallyroo Family schedule, not Google. Creating, editing, and deleting from Apple Calendar and Rallyroo should synchronize both ways without duplication or silent overwrites.

This does not replace Apple's Calendar app or silently change the phone's default. Google calendars and their existing Events remain untouched. Existing Google Events are not migrated. A read-only `.ics` subscription and the shipped Rallyroo App Shortcut do not satisfy this requirement.

## Confirmed platform behavior

Apple documents adding a CalDAV account under **Settings → Apps → Calendar → Calendar Accounts → Add Account → Add Other Account → CalDAV account**, and selecting a calendar under **Settings → Apps → Calendar → Default Calendar**. Labels can vary with iOS version. The parent must perform both steps; adding an account alone is not evidence that Siri uses it.

The end-to-end generic Siri routing behavior must be verified on a physical iPhone. Server protocol tests and App Intent metadata extraction cannot establish it. CalDAV synchronization may use the device's Fetch schedule; do not promise immediate server-to-device delivery or Apple push support.

Source: [Apple — Change your Calendar settings on iPhone](https://support.apple.com/guide/iphone/change-calendar-settings-iphc37be2016/ios).

## Existing implementation and integration seams

- `server/api/src/app.ts` authenticates the JSON interface with identity-provider sessions. Apple Calendar cannot reuse Rallyroo's interactive Apple/Google sign-in or an expiring in-app session as its unattended calendar password.
- `server/api/src/event-mutation.ts` owns parent authorization, Member validation, imported Event protection, conflict privacy, and schedule update notification intents. CalDAV must not bypass this module with direct `saveEvent` calls.
- `server/api/src/event-mutation-persistence.ts` and `postgres-repository.ts` serialize changes per Family and commit Event changes, change cursors, idempotency results, and notifications atomically. Conditional CalDAV writes must extend this transaction, not check an ETag before entering it.
- `server/api/src/calendar-source-module.ts` imports external calendars. It is not an outgoing writable calendar account. Do not export imported Google/TeamSnap/Outlook calendars back through this integration; that can duplicate Events or create import loops and broaden visibility.
- `FamilyEvent` stores timed instants, optional all-day bounds/anchor metadata, and bounded daily/weekly/monthly timed recurrence, not the full iCalendar object model. The native editor and voice creation preserve all-day metadata; all-day recurrence, full series mapping, and native note/alarm parity remain outstanding.
- Recurrence series can have split rows and durable occurrence dispositions/overrides. Export must account for those states, rather than regenerate deleted occurrences from a rule.
- Protected Family details are encrypted per Family in PostgreSQL. Raw iCalendar payloads contain the same protected details and must receive equivalent protection.

Related decisions: [transactional Event mutations](adr/0001-transactional-event-mutations.md), [Family data encryption](adr/0003-per-family-data-encryption.md), [durable recurrence occurrences](adr/0007-durable-recurrence-occurrences.md), [all-day calendar dates](adr/0008-preserve-all-day-calendar-dates.md).

## Proposed product scope

One pre-provisioned, writable **Rallyroo Family** calendar per Family, accessed through a parent's individual calendar connection. Each parent opts in separately. No public sharing, child credentials, email invitation scheduling, VTODO/Reminders, attachment fetching, or imported calendar re-export in the first release.

Account access grants read/write access to the native Family Events that parent is authorized to access; onboarding must explain this before issuing a credential. Family participants and external email attendees are not interchangeable. Editing a title or time in Apple Calendar must not clear participants, drivers, arrival targets, Travel plans, or other Rallyroo-only data.

Unsupported semantic changes must fail explicitly without changing the Event. Never claim successful sync after silently discarding recurrence constraints, all-day identity, attendees, alarms, or occurrence exceptions. Preserve non-standard iCalendar data as required by the protocol, even if Rallyroo does not display it. Do not advertise scheduling/inbox/outbox capabilities that are not implemented.

## Module design

Use one CalDAV module with a small interface for authenticated calendar operations. Keep HTTP/XML and iCalendar details behind that interface. Use a PostgreSQL adapter in production and an in-memory adapter for deterministic protocol tests; both must satisfy the same contract.

### 1. Calendar connection lifecycle

Authenticated parent-only JSON operations create, list, and revoke calendar connections. Create returns an opaque username and cryptographically random app-specific password **once**, with the configured public HTTPS server address. Persist only a password verifier, owner identity, Family/Member association, and connection lifecycle metadata. Never log or recover the plaintext password.

CalDAV uses HTTP Basic authentication only over HTTPS. The edge must enforce HTTPS; do not trust arbitrary forwarded headers or reflect an untrusted Host into discovery URLs. Calendar credentials authenticate only CalDAV, never the existing JSON interface. Every request checks that the connection is active and its owner still has the required Family membership and parent role. Revocation, account deletion, and membership changes invalidate access. Apply request and failed-authentication limits; redact Authorization and calendar payloads from logs.

Revocation prevents future server access; it cannot erase Events already cached on another device. Explain account removal and local cache implications to the parent.

### 2. Durable resource identity and representation

Maintain a Family-scoped association between the client-chosen resource name, opaque iCalendar UID, native Event/series identity, and representation revision. The resource URL and UID are independent; do not assume Apple uses our UUID or that a resource name equals its UID. Enforce UID uniqueness within the calendar and stable URLs for a resource's lifetime.

Retain accepted iCalendar content encrypted at rest, including extension properties and components. Changes from Rallyroo must update its calendar representation and revision in the same transaction as the Event. ETags must represent the actual serialized resource, not an unrelated global Family counter or a random value generated on every read.

Preserve all-day dates, exclusive end dates, original time-zone semantics, and supported alarms. The preview persists date-only bounds and their anchor zone explicitly; retain that identity while implementing series support. Define supported recurrence conversion and duration semantics; the existing 732-day bound and lack of yearly/unbounded native recurrence are compatibility gaps, not permission to silently truncate incoming rules.

A recurring master and its exceptions share one UID and one calendar resource. Integrate recurrence splits, skipped/deleted occurrences, and overrides with the existing occurrence lifecycle. Do not flatten a recurring series into unrelated editable Events merely to make it fit.

### 3. Atomic writes and retries

Extend the Event mutation seam to handle a calendar resource's expected revision, stable operation identity, and representation update inside the same Family transaction. Do not implement a separate, divergent authorization/notification path.

- New resource with `If-None-Match: *`: create once; racing creates cannot both succeed.
- Update/delete with `If-Match`: compare with the current resource inside the transaction; return `412 Precondition Failed` on a stale representation.
- Enforce CalDAV UID collision/replacement rules.
- A retried request cannot create a second native Event or duplicate notification intent.
- HTTP success means the authoritative Event and calendar representation committed together; notification retry does not roll back a successful save.
- Preserve hidden native fields while applying supported calendar edits to the current snapshot, not a stale pre-read copy.

### 4. Discovery, reads, and synchronization

Implement and test well-known discovery, principal discovery, calendar-home discovery, collection properties, namespace-aware XML, OPTIONS, PROPFIND, GET/HEAD, PUT/DELETE, and the relevant CalDAV REPORTs. Read the complete WebDAV/CalDAV conformance requirements before choosing a protocol engine or advertising `calendar-access`; a few hand-written routes are not a compliant server.

Return strong ETags on GET. If a PUT transforms the submitted bytes, follow RFC 4791 §5.3.4 instead of returning a strong PUT ETag for bytes the client never submitted. Reports must respect time-range overlap, recurrence instances/exceptions, requested properties, and per-resource missing/error statuses.

Incremental sync requires a calendar-scoped durable change journal, deletion tombstones, consistent snapshot cursors, and token expiry/full-resync behavior. A Family change counter alone cannot enumerate deleted calendar URLs. Do not advertise RFC 6578 support until those semantics exist; if initially using full ETag listings, prove Apple client interoperability and deletion convergence first.

Bound XML/body size, nesting, href count, query range, response size, and recurrence work. Disable DTDs and entity expansion. Do not fetch external ATTACH/URL values or multiget hrefs. Validate each requested href against the authenticated calendar and configured origin. Never allow arbitrary path traversal, cross-Family resource access, or client-selected account ownership.

### 5. iPhone onboarding

Add a parent-only **Use Rallyroo in Apple Calendar** Settings destination, separate from **Connected calendars** (incoming read-only imports). Show connection creation/revocation, server address, one-time credentials, and version-appropriate setup instructions. Keep credentials out of analytics, URLs, screenshots used for support, and persistent view state.

After successful account setup, instruct the parent to select **Rallyroo Family** under Default Calendar. Include a test phrase without “Rallyroo” and tell them to verify the destination. Do not report success just because an App Shortcut ran. State that existing Google Events are not moved and that sync may be delayed by Fetch settings.

## Implementation sequence and release gates

1. **Protocol compatibility spike:** choose and evaluate a maintained protocol engine versus a native adapter using the complete RFC requirements; use synthetic data and a non-production HTTPS endpoint. Prove account discovery, writable/default-calendar eligibility, and generic Siri routing on a physical iPhone. This is the highest-risk assumption; do not deploy a partial production endpoint to test it.
2. **Lossless model and transaction seam:** schema/migration for all-day/time-zone identity, encrypted calendar representation, stable URL/UID bindings, revisions, conditional mutations, and sync journal/tombstones. Verify backup/restore and migration compatibility before production changes.
3. **Credentials and protocol module:** revocable parent-scoped credentials, authentication isolation, parser/work limits, discovery/reports, and two-way mutations through the shared Event mutation module. Add in-memory and PostgreSQL integration tests for concurrency and revocation.
4. **iOS onboarding and account management:** parent-only UI, one-time credential presentation, setup/default instructions, revocation, accessibility and synthetic UI coverage.
5. **Device acceptance and rollout:** complete the checklist below on a non-production Family, then deploy the backend and ship a TestFlight build. Do not label the integration available before those gates pass. Public/legal documentation must explain that calendar clients can cache Family details.

## Automated acceptance tests

- Valid parent connection succeeds; invalid, revoked, deleted-owner, changed-membership, and child credentials fail. Calendar credentials cannot authenticate JSON requests. No authorization header or raw calendar content appears in diagnostics.
- Discovery and property/report requests work with arbitrary namespace prefixes; unknown properties and unsupported filters get correct protocol errors rather than false success.
- Calendar queries/multiget stay within the authenticated Family; personal imported calendars and other Family data cannot leak through events, free/busy, hrefs, errors, or conflict information.
- Client-chosen URLs and UIDs round-trip independently; duplicate UID, stale update/delete, racing creates, offline retries, and concurrent Rallyroo edits are deterministic and cannot lose data or duplicate notifications.
- All-day dates, DST, time zones, Unicode/folded lines, duration, recurrence, exceptions, extension fields, and alarms round-trip without semantic loss. Unsupported changes preserve the previous resource unchanged.
- Native Rallyroo saves/deletes update resource ETags, journal/tombstones, and all relevant cursors atomically; full and incremental sync converge after process restart and token expiry.
- Malformed/oversized XML and iCalendar, DTD/entity payloads, invalid hrefs, expensive recurrence, and external URLs cannot cause secret disclosure, network fetches, unbounded work, or partial mutations.

## Physical-iPhone acceptance (not yet executed)

- [ ] Add the account over HTTPS with synthetic credentials. Discover the writable Rallyroo Family calendar and create an Event in Apple Calendar that appears in the Rallyroo app after sync.
- [ ] With Google still selected as default, verify adding Rallyroo has not changed the default or any existing Google Events. Explicitly select Rallyroo Family, then say “Siri, add dentist tomorrow at 3 PM” without the app name. Verify the Event appears once in Rallyroo and not in Google.
- [ ] Create, edit, and delete in each direction between Apple Calendar and the Rallyroo app. Confirm Family participants and Rallyroo-only fields are preserved after supported Apple Calendar edits.
- [ ] Create while offline, reconnect, and verify exactly one server Event after retries and repeated synchronization.
- [ ] Change the same Event from two clients while one is stale; verify stale writes do not silently overwrite the newer server state.
- [ ] Verify all-day and multi-day dates, DST/time-zone changes, recurring series, moved occurrences, and deleted occurrences in both clients. Confirm alarms behave as documented, including possible alerts from both apps.
- [ ] Revoke the connection in Rallyroo; verify subsequent CalDAV reads/writes fail while Rallyroo's ordinary login and another active connection still work. Remove the account from the phone and check local-cache behavior.
- [ ] Select Google as default again and remove the Rallyroo calendar account. Verify native Rallyroo Events remain on the server and Google Events are unchanged.

## Primary protocol sources

- [RFC 4791 — CalDAV](https://www.rfc-editor.org/rfc/rfc4791), particularly §§2, 3.2, 4.1, 5.3.2–5.3.4, 7, 8.2, and 11: conformance, recurring resource identity, UID/URL independence, conditional requests, representations, reports, and security.
- [RFC 6578 — WebDAV Collection Synchronization](https://www.rfc-editor.org/rfc/rfc6578), particularly §§3.1–3.6 and 4: initial/incremental synchronization, removal tombstones, token expiry, truncation, and sync-token semantics.
- WebDAV (RFC 4918), iCalendar (RFC 5545), discovery (RFC 6764), and current-user principal discovery (RFC 5397) are required further reading before protocol implementation; this design does not claim their conformance has been established.
