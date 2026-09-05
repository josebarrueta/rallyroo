# Automatic internal TestFlight uploads

## Current status

The previous manual upload workflow was defective and has been replaced by
`.github/workflows/testflight.yml`. Static checks and archive-validation unit tests
are available; a real signed upload is still required before this is operational.
Issue #8 must remain open until that acceptance run succeeds.

## Trigger and destination

A successful **iOS** main-push workflow wakes a durable FIFO queue. Main's
first-parent history after repository variable `TESTFLIGHT_START_SHA` is the
queue; GitHub deployments in `rallyroo-testflight` are its completion ledger.
Set that immutable variable to the last main commit that must **not** be published
(full SHA), before merging the uploader. Every subsequent main commit changing
`clients/ios/` is queued. PR validation runs cannot upload.

Each wake publishes the oldest unpublished commit after its main-push iOS CI
succeeds. A failing or unfinished CI run blocks the queue, rather than publishing
out of order. Re-run that commit's CI to recover. The exact queued SHA is built
in a detached worktree using the current trusted main delivery scripts.

Manual dispatch and a 15-minute scheduled wake recover coalesced/missed events.
The workflow concurrency group is only a mutex, not the queue: replacing a pending
wake does not discard commits. Idle polls run on Ubuntu, not a signing macOS runner.
One commit is processed per wake; a backlog drains over subsequent scheduled runs.
GitHub schedule delays may increase latency. Do not force-push main or delete the
bootstrap commit/deployment ledger.

There is no approval gate for this internal-testing path, as requested. Protect
main with required PR reviews and required iOS CI checks: merged code can execute
with signing secrets. This workflow does not itself enforce branch protection.

Fastlane uploads and waits for processing with `skip_submission: true`. It passes
no group or distribution arguments, so it cannot request external beta review or
App Store Review. App Store Connect's **internal** automatic-distribution setting
is solely responsible for making processed builds available to Rallyroo Internal.

## Required one-time setup

Store these repository Actions secrets using GitHub's secret UI or a secure
file/stdin upload, never by pasting values into command arguments or chat:

- `APPLE_API_KEY_ID`: App Store Connect team API key ID.
- `APPLE_API_ISSUER_ID`: issuer ID.
- `ASC_API_PRIVATE_KEY`: complete PEM .p8 contents, not base64.
- `APPLE_DISTRIBUTION_CERT`: base64 .p12 including its private key.
- `APPLE_DISTRIBUTION_CERT_PWD`: .p12 password (may be empty).
- `APPLE_PROVISIONING_PROFILE`: base64 App Store distribution profile for
  `dev.rallyroo.app`, team `5LS29Z8553`, including Apple sign-in and production APNs.

Use a narrowly scoped key with the permissions necessary to upload and manage
internal TestFlight distribution (App Manager); do not use an Admin key.
Create/verify the internal group named exactly `Rallyroo Internal` before enabling.
No beta-group ID or hardcoded numeric app ID is needed.

Both UI CI and signed archives pin Xcode 26.3 on macOS 15, satisfying App Store
Connect's iOS 26 SDK minimum; upload tooling pins Fastlane 2.232.2. Missing tooling fails the job—there is no silent fallback.
Confirm availability on the selected hosted runner during the first acceptance run.

## Build numbers and recovery

Build integers start at 101. Before signing, the serialized worker reserves the
next number in a deployment payload. Failed/interrupted attempts consume their
numbers; retries allocate a fresh number, never reuse one. The bound is 9999;
migrate deliberately before exhaustion. The marketing version is unchanged.

Only successful processing/distribution marks a commit complete. If an upload
succeeded but its completion record was lost, a retry can produce a second build
for that SHA with a new number (at-least-once delivery). Completed commits are
skipped. Do not use another uploader or delete deployment records: the ledger
and workflow mutex jointly own numbering and ordering. App Store Connect remains
authoritative; pre-existing builds above the reserved range require a planned
numbering migration, not a silent fallback.

## Verification and credential lifecycle

The script validates bundle ID, build number, iOS 26-or-later SDK, remote production
configuration, iPhone-only device family, privacy manifest presence/parseability, encryption
flag, code signature, Apple sign-in, production APNs, team/application identifiers,
and absence of a debug entitlement before export/upload.

Credentials live in a private temporary directory and ephemeral keychain. Keychain
password commands are sent over stdin to `security -i`, not process arguments.
Cleanup restores the runner keychain search list and removes installed signing
material on normal failure/success. Hosted-runner disposal is the final boundary
for cancellation or machine failure. Raw build/provider logs are deliberately not
printed or uploaded: errors identify only the failing stage/tool.

Rotate certificates/profiles before expiry and API keys after exposure or personnel
changes. App Store profiles contain no device UDIDs. Revoke compromised keys in
App Store Connect and certificates in the Apple Developer portal, replace secrets,
and validate a new upload. Never put credentials in screenshots or issues.

## Acceptance

- Run `./scripts/test-app-store-upload-workflow.sh` locally.
- Configure secrets and verify required branch protections.
- Merge an iOS PR; confirm successful iOS CI triggers the exact SHA's upload.
- Confirm the build finishes processing and appears in Rallyroo Internal.
- Confirm a retry gets a different build number.
- Test issue #9 on a physical device; CI smoke tests do not prove delivery.
