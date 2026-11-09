# Account-restricted in-app calendar testing

Status: **existing-Family testing approved by the tester; implementation verified locally, not activated or delivered in a new TestFlight build yet**. The previous disposable endpoint is stopped. This is not general production availability or proof of Apple Calendar/Siri compatibility.

## Intended experience

Use the existing Rallyroo login and Family in a normal signed TestFlight build. Only an operator-selected parent sees **Settings → Apple Calendar preview → Use Rallyroo in Apple Calendar**. Create a one-time calendar password after explicit consent, add the account in iPhone Settings, then explicitly select its calendar as Default Calendar for a dummy Siri request. These writes affect the live Family schedule. Existing Google Events are neither migrated nor modified.

The app checks authenticated preview eligibility before showing the entry. Disabled or unenrolled accounts do not see it. Basic calendar credentials cannot access the JSON API. The server checks cohort eligibility as well as current parent role/Family membership on every DAV request. Owner revocation remains available even after cohort access is removed.

## Backend activation gates

1. Merge reviewed code only after required API, migration, security and iOS checks pass. Let the normal release/Flux and serialized TestFlight queues deliver it; do not run a second uploader or assume a successful upload means the build is available.
2. Verify the current production destination and live image/chart, not the retired project. Confirm migrations through `040_calendar_resource_private_identity.sql`, healthy workloads, and a recent recoverable backup before activating the preview.
3. Identify the tester's **exact current parent identity subject**. Do not infer identity from a display name or enable every parent. Keep the JSON array in a separate Kubernetes Secret with key `identity-subjects`; never put actual identity values in Git, command arguments, screenshots, or CI logs.
4. Explicitly update the live HelmRelease's `calendarPreview` values: `enabled: true`, `publicOrigin: https://api.rallyroo.dev`, and `identitySubjectsSecret: <the dedicated Secret name>`. Defaults remain disabled. The chart supplies both environment fields to the API and enables a separate DAV/discovery NGINX location.
5. The public listener must remain reachable only through the trusted Cloudflare tunnel. The DAV location rejects non-HTTPS forwarding before authentication, preserves the edge's verified protocol, and suppresses href-containing proxy logs. Verify the real public edge rejects HTTP and overwrites forged forwarding headers; local header tests alone cannot establish that trust boundary.
6. Verify unauthenticated DAV challenges, authenticated eligibility for the selected account, denial for a non-selected parent, and app setup visibility before asking the tester to change Default Calendar. Do not request the tester's login session token/password in chat.

Client-selected resource names and UIDs are encrypted without guessable equality hashes; uniqueness is checked against the decrypted snapshot under the shared Family mutation lock, including cross-instance concurrent creates. Only opaque Event identity is indexed.

Malformed, missing, or wildcard identity configuration fails closed. An explicit empty array admits nobody. A cohort change requires an API rollout because the list is snapshotted at startup; urgent individual revocation through the app takes effect in shared storage immediately. Disabling the chart flag removes the public DAV location and API preview configuration without deleting native Events.

## Delivery and device acceptance

The existing internal TestFlight pipeline builds the production-configured app from main after CI. A new build is required; build 191 does not include these screens. Account restriction is a backend/UI capability gate, **not a claim that the entire binary is distributed to only one internal tester**. Keep the existing internal distribution policy unless a separately approved distribution change is required.

Once the processed build is actually available, the tester signs in normally and opens the in-app setup. Paste the one-time password into the CalDAV form first; return to Rallyroo for the non-secret server/username after the password view clears on background. Keep SSL enabled. Record the previous Default Calendar, test with dummy titles, inspect the actual destination, and restore the previous default on failure. Do not count an App Shortcut success as generic Siri routing.

Record the device observations in [physical acceptance](caldav-device-acceptance.md). Confirm native↔Apple edits and deletions before relying on the calendar; recurrence/series, full note/alarm mapping, timed-zone preservation and broader protocol compatibility remain unfinished.

## Current verification and blocker

- 447 API unit tests passed (one optional provider test skipped).
- 38 PostgreSQL/Redis integration tests passed against disposable PostgreSQL 17 and Redis 8; migration deployment contract passed.
- All 275 Swift core/live-contract tests passed with none skipped.
- Helm contracts and the rendered NGINX/API Docker test passed, including opt-in DAV discovery, HTTPS boundary, PROPFIND, REPORT, PUT, GET and DELETE.
- iOS app/UI-test targets compile. The new UI regressions have not executed locally because CoreSimulator enumeration hangs; required CI must execute them.
- Production VM status is running, but the agent's SSH attempt requires interactive operator verification and was denied. No permission weakening, authentication bypass, production preview activation, or new TestFlight delivery has been performed.
