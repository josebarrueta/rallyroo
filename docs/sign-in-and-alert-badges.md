# Sign-in guidance and unread Alert badges (#182, #185)

## Organizer acknowledgment: option 2

The implementation uses an **adult-organizer statement without a checkbox**. Creating a Family still requires an organizer aged 18 or older under the existing Terms. The signed-out screen explains that continuing without an invitation creates a Family for the signer to organize, and that children join through a parent/guardian-authorized invitation. Both OAuth controls remain enabled. Continuing acknowledges the linked Terms and Privacy Policy; no new age field or purported age-verification evidence is collected.

This removes only the existing client-side checkbox, not the eligibility requirement. OAuth, invitation redemption, guardian authorization collection and stored consent evidence, session handling, sign-out, and deletion API behavior are unchanged. Existing Privacy and Terms language is consistent with this approach, so policy text has not been relaxed or rewritten.

**Merge authorization:** after reviewing the proposed option 2 and its remaining checks, the product owner requested that PR #189 be marked ready and merged once its build is green. This is product-owner authorization to merge the implementation, not a claim of completed legal review. Existing adult eligibility and guardian-consent commitments remain unchanged. If legal review requires durable age acknowledgment, that needs a separate reviewed API/storage design; the old toggle never supplied durable evidence. Manual accessibility and physical-device release verification remain outstanding.

The sign-in screen scrolls, decorative imagery is hidden from VoiceOver, Google text can wrap without a fixed-height clip, and legal links can stack at large text sizes. UI tests exercise the real signed-out screen and invitation URL, enabled Apple/Google controls, and reachable controls/error/legal links at accessibility text size.

## Badge contract

- Source: unread, non-deleted durable Alerts for the authenticated Family/Member. Legacy local saved conflicts and future scheduled local notifications are not badge items.
- Internal counts remain exact. The icon and Alerts tab both display `min(99, count)`, including 0 to clear. This deliberately uses numeric **99**, not `99+`, so both surfaces have identical caps. The Alerts screen exposes the same bounded total as readable accessibility text.
- `GET /v1/notifications/unread-count` returns the full unread count, independent of the 100-record inbox page. Authentication and account scoping are the same as the inbox endpoint. `POST /v1/notifications/read-all` marks the authenticated Member's full inbox read atomically on the server, including items beyond the current page; the Alerts toolbar exposes this action.
- Notification delivery calculates the current durable recipient count after inbox creation and on every retry, then sends an absolute, bounded `aps.badge` to all of that Member's registered devices. It never increments a device counter. Durable creation and delivery retries retain existing failure semantics.
- iOS reconciles through `NotificationBadgeCoordinator` at session start, activation, inbox refresh/read/delete, and inbox delivery/change. Account changes clear the old count before reconciliation; successful sign-out/deletion invalidate in-flight requests and clear the icon. Signed-out launch also clears stale badges.
- Foreground presentation excludes APNs badge writes: inbox reconciliation owns the foreground count. Local notifications do not assign a speculative badge at scheduling time.
- Permission denial is tolerated; badge-write errors are ignored without logging content, tokens, or Family data. A failed refresh retains the last known account-scoped count, rather than fabricating a zero. Cached remote counts are account-scoped and adjusted for known read/delete transitions while offline.

## Limits and release verification

APNs delivery order is not guaranteed: an older in-flight payload can arrive after a newer one. Activation reconciles that stale value. Reads/deletes on one device immediately update that device; other devices converge on activation, refresh, or the next authoritative Alert push. This change does not introduce silent badge-only pushes for every read/delete.

Automated tests cover payload JSON/bounds, durable full-count/account isolation/retries, the authenticated unread-count API, count caching and mark-all-read, coordinator launch/read/delete/sign-out/account-switch behavior and stale in-flight completion, and visible Alerts-tab behavior.

Validated in an isolated worktree based on `80c1fa1`: TypeScript typecheck; 386 API unit tests passed (one unrelated live-provider test skipped); 32 PostgreSQL integration tests passed against a temporary local PostgreSQL database; FamilyCore's 217 tests completed with one unrelated HTTP-contract test skipped and no failures; site contract passed; all seven targeted UI tests passed on an iPhone SE (3rd generation), iOS 26.5. iPhone 14 simulator checks also exercised the signed-out and badge paths during implementation.

Before release, use signed APNs-enabled physical devices to verify terminated/background delivery, multiple registered devices, badge permission denial, VoiceOver reading order, and actual home-screen icon updates. Simulator/unit tests do not establish physical APNs delivery or a human accessibility/legal review.
