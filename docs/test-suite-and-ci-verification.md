# Test-suite and CI verification

Audit base: `176fc26b78a6964dd2dc8258b10b43c3b7d13a05` (TestFlight 187).
Date: 2026-10-26. External-beta tracking: [#210](https://github.com/josebarrueta/rallyroo/issues/210).
These checks use synthetic data and disposable services, not production credentials.
The table below records the original CI audit, not a permanent suite size. Subsequent
submission-readiness changes expand the source inventory to 251 core/live cases,
64 full UI cases and seven small-screen selections (including signed-in legal/support
access and screenshot review above the keyboard). Current CI verifies those source identities rather than trusting these counts.
The small-screen lane additionally compiles the actual alert scheduler into an
unbundled simulator executable. This reproduced the early
`UNUserNotificationCenter.current()` bundle-proxy assertion (exit 134); deferring
lookup to the actor's first scheduling/cancellation call makes construction pass
without an application bundle. This is a separate native startup contract, not
an extra XCTest case or proof of real-device notification delivery.

## Verified inventory and ownership

| Surface | Verified locally in this audit | CI owner |
| --- | --- | --- |
| Swift/core + live HTTP contract | **237 executed/passed, zero skipped**, including the local API contract | iOS `core-contract` |
| Full iPhone UI | **61 executed/passed, zero skipped**, real xcresult matched against current source | iOS `ui` |
| Small-screen/accessible calendar | **5 selected tests passed**, newly created iPhone SE 3 simulator; manifest/result inventory matched | iOS `ui-narrow` (new) |
| Upload/queue/archive/report helpers | **23 tests passed on macOS**, including a real temporary-keychain lifecycle | Security workflow contracts + iOS `delivery-contracts` (new macOS coverage) |
| API unit | **408 passed, 1 opt-in live-provider test skipped** | API `quality`; Release `verify` |
| PostgreSQL + Redis repositories | **36 passed**, disposable PostgreSQL 17 and Redis containers | API `integration`; Release `verify` (new release gate) |
| Migrations | Migration lifecycle/ledger/failure contracts passed against disposable PostgreSQL | API `integration`; Release `verify` |
| Alert Worker | **11 passed**, typecheck and deploy dry-run passed | Deployment Alert Worker `verify` |
| Backup/restore/monitor | **7 monitor/off-host unit tests**, plus shell retention/failure/restore contracts passed | API `chart` already called `test-backup-job.sh`; now also Release `verify` |
| Site | Site contracts and deploy dry-run passed | Site `verify` |
| Chart/Flux | Helm lint and rollout/Flux contracts passed | API/chart, Worker and Release as applicable |
| AI capture concurrency | Bridge contract passed | iOS `core-contract` |
| NGINX → API HTTP routing | Real rendered NGINX + synthetic API container smoke passed, cleanup verified | API `http-contract` + Release `verify` (new) |
| Workflow syntax/wiring | actionlint 1.7.7 and all shell/coverage/release-gate contracts passed | Required Security workflow contracts (expanded) |

Counts describe executed cases, not a code-coverage percentage. The live SF511
provider check requires authorized provider access and is intentionally not a
secret-dependent PR test. Real OAuth, APNs delivery, production restoration and
physical-device accessibility/performance remain separate acceptance work.

## Gaps closed

### 1. A successful test command was not proof of complete discovery

`verify-xctest-results.py` inventories the current XCTest methods and compares
identifiers with actual case-completion results. Full suites must match exactly;
small-screen execution uses `scripts/ios-narrow-tests.txt` as its explicit subset.
It rejects empty/missing/malformed reports, missing/newly undiscovered tests,
unexpected/duplicate cases, skips and failures. Unsupported source declaration
styles fail rather than silently losing inventory coverage.

Two real SwiftPM pitfalls were reproduced during this audit:

- A serial `swift test --xunit-output` returned success but did not produce the
  expected JUnit file on this toolchain.
- Parallel SwiftPM JUnit output represented a deliberately `XCTSkip`ped live
  contract as a passing `<testcase>` without a `<skipped>` element.

Accordingly, core CI uses **serial XCTest completion records**, not that parallel
JUnit export. `--disable-swift-testing` removes the unrelated Swift Testing
runner's “0 tests passed” footer. `pipefail` preserves the real test exit status
through `tee`; the verifier independently requires every current source case to pass
(237 at the original audit base).
The real skipped-test probe was correctly rejected by the verifier.

UI CI exports structured `xcresulttool get test-results tests` JSON, checks all
current source methods, and retains the synthetic `.xcresult` for seven days,
including on failure. An explicit fresh derived-data directory prevents accidental
reuse of a stale UI test bundle. No signing or production logs are uploaded.

### 2. Platform-specific tests were being skipped in CI

The real Security CLI temporary-keychain test existed but ran only inside a Linux
workflow, where its platform guard skipped it. The new macOS delivery job executes
it on applicable script/workflow changes. No production signing material is needed.
The small-screen job independently creates an iPhone SE 3 and executes the
calendar/large-text, legal/support and screenshot-review regressions with an explicit result inventory. A larger default
simulator is not a substitute for this bounded small-screen regression lane.

### 3. Tagged API releases had weaker runtime gates than API PRs

Release verification now provisions Redis as well as PostgreSQL and runs the
repository integration suite, backups/monitor contracts and synthetic HTTP edge
smoke before publish can succeed. GitHub Release creation now depends on successful
artifact publication, not only image building. No release tag was pushed during
the audit; the new release wiring is statically checked and its underlying test
commands were actually executed locally/through the API workflow.

### 4. Edge HTTP smoke existed but had no CI execution

`test-ci-http-contract.sh` renders the actual chart's NGINX configuration and runs
it against the existing credential-free contract server. Only Kubernetes service
resolution changes to isolated loopback; routing, headers and branded errors use
the rendered config. Containers share a private network namespace; only NGINX is
published on a random host-loopback port. The build context is an explicit source
allow-list, not the operator's `.env`/npm credentials. Containers/images are cleaned
up even on failure. This is **not** a full Kubernetes, production OAuth or migration
rollout acceptance test.

## Running the checks

```sh
./scripts/test-app-store-upload-workflow.sh
./scripts/test-ci-workflow-contracts.sh
./deploy/local/test-ci-http-contract.sh
./deploy/gcp/test-backup-job.sh
./deploy/helm/rallyroo/test-chart-contract.sh
./deploy/flux/rallyroo/test-flux-contract.sh
```

The HTTP smoke needs Docker, Helm, Ruby and curl. API development/migration
commands remain in the [API README](../server/api/README.md); use disposable local
services. For core, start the local contract server and set
`RALLYROO_CONTRACT_BASE_URL`, then capture serial completion records:

```sh
# In clients/ios; configure the real local contract URL first.
set -o pipefail
swift test --disable-swift-testing 2>&1 | tee /tmp/rallyroo-core-tests.log
python3 ../../scripts/verify-xctest-results.py --source Tests/FamilyCoreTests \
  --report /tmp/rallyroo-core-tests.log --format xctest-log
```

For UI, use `FamilyAppCI`, a fresh explicit `-derivedDataPath`, and an explicit
`-resultBundlePath`; export the report and verify it:

```sh
xcrun xcresulttool get test-results tests --path /tmp/rallyroo-ui.xcresult > /tmp/rallyroo-ui-tests.json
python3 scripts/verify-xctest-results.py \
  --source clients/ios/FamilyAppUITests/FamilyAppUITests.swift \
  --report /tmp/rallyroo-ui-tests.json --format xcresult
```

## Required checks and remaining limits

The always-reporting **iOS verification** job aggregates change detection, core,
full UI, narrow UI and macOS delivery results. It accepts intentional skips only
when the corresponding change flag is false; failed/cancelled/missing applicable
jobs fail. Its success/failure/skip matrix is tested by the workflow contract.
Once this workflow lands and the context has passed, add that context to existing
strict branch protection **without removing the existing required checks**.
Main's overall iOS workflow success continues to gate the automatic uploader.

The initial branch-policy readback required `core-contract`, `ui`, Secret scanning
and Workflow contract checks with strict up-to-date protection. API/Site/Worker
workflows remain path-filtered and are not globally required contexts; do not add
them blindly or unrelated PRs can wait forever. A future repository-wide aggregate
requires always-reporting gates or explicit change-aware orchestration. This audit
does not claim that every existing workflow is enforced by branch protection.

No production credentials, provider accounts, reviewer accounts, public link or
external-review submission were created by CI. See the [external-beta guide](external-testflight-readiness.md)
for the human review/access/privacy and on-device acceptance that CI cannot replace.
