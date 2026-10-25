# Coordinated app-improvement batch (#204)

This branch is a draft. Merging iOS changes to main can automatically distribute TestFlight, so do not merge/release it until all child-ticket acceptance is recorded.

## Implemented interfaces

- **Saved places (#197):** app composition supplies location search and the parent's existing Family-place capability. Server authorization is unchanged. Parent/kid/manual-address/save-failure UI regressions exercise the real composition root.
- **Headers (#198):** optional branding is smaller and omitted at accessibility text sizes or compact height. Content text is not shrunk. Alerts does not repeat its navigation title. Decorative artwork is not read by VoiceOver.
- **Freshness (#199):** Settings says Cloud-backed, not Synced. Remote schedule snapshots retain the real successful-refresh timestamp in the account-scoped cache. Alerts pages distinguish live, local and cached results; a cached fallback retains its timestamp and clearly says only page one was saved. Authentication failures are not disguised as offline pages. Retry/pull-to-refresh retains useful data.
- **Alerts (#200):** additive `GET /v1/notifications/page?filter=all|unread&limit=1..100&cursor=...` returns `{items,nextCursor}`. The old array endpoint remains unchanged. New pagination orders by occurrence time and UUID descending, uses bounded lookahead, scopes every query to the authenticated Family/member, and binds cursor metadata to that member and filter. A cursor is a position, not an authorization credential. New arrivals appear on refresh; deleting/marking items does not shift an offset cursor because the remote API uses keysets. Bulk actions still cover the full inbox, not the filter or loaded pages. Offline mode exposes only the cached first page, with no misleading Load more action. This is intentionally not a complete offline history cache.
- **Editors (#201):** Event/Reminder dirty state compares normalized persistence drafts against the initial form. Participant order and unused controls do not create phantom changes. Cancel offers Keep Editing/Discard; dirty/saving sheets cannot be swiped away. Saving is guarded against repeated taps and failures retain drafts. Opening travel from a dirty Event also asks before discarding.
- **Search (#202):** native search matches case/diacritics and whitespace-separated terms in the authorized data supplied by each feature. Event results span loaded event series across dates, not only the viewport; recurrence results identify the series start, not an arbitrary occurrence to edit. Details remain read-only from this search. Reminder search includes completed reminders and assignee names. Pantry search hides unrelated Shopping sections while searching; clearing restores the catalog. These are loaded-data searches, not a promise of server-global completeness.
- **Notification health (#203):** a provider reads iOS permission/alert/badge settings, exposes an explicit permission request or official Open iPhone Settings action, and refreshes on foreground. Startup no longer requests permission automatically. Granting permission refreshes local scheduling; the in-app unread count is independent of icon-badge permission. Simulator fakes do not prove APNs/device delivery.
- **Day Brief grounding (#143):** AI selects among pre-rendered pace/count summaries. Ollama receives only those approved choices, not Member names, Event titles, addresses or raw facts. Its response must contain only a recognized option ID. The domain module additionally accepts only exact approved text, renders from its own option, and ignores model titles. Unsupported claims, malformed output, timeouts and provider failures retain the verified deterministic brief. Weather and mandatory facts stay deterministic/structured. This deliberately trades unconstrained prose variety for verifiable correctness; schema/prompt instructions alone were insufficient.

## Backup acceptance (#146)

See [backup monitoring and recovery](backup-monitoring-and-recovery.md). Fault-injection tests and an actual isolated off-host restore succeeded during this batch. Production monitor installation, end-to-end operator receipt, and monitoring across VM outage still require acceptance. Do not mark #146 complete or ship the whole app batch based on local tests alone.

## Release gates still apply

- Re-run full combined-state API, PostgreSQL, live Swift/API contract, UI and worker/backup tests after the final changes.
- Record physical-device permission grant/deny/re-enable and VoiceOver review. Unit/simulator tests are not substitutes.
- Complete the operator-only monitoring acceptance above without publishing production credentials or data in CI/issues.
- Only then merge and publish the matching API release before the new TestFlight client needs its additive endpoint; verify exact live version/readiness and uploaded build SHA.
