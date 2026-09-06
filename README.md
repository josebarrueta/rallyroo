# Rallyroo

Rallyroo is a colorful native iOS planner for keeping the whole home team in sync. The app is being built local-first: event data
and images stay on the device during Phase 1. The iOS client depends only on
backend-neutral storage contracts; Supabase is one optional implementation for later
sign-in and realtime sync.

## Repository layout

- `clients/ios/` — iOS app and its testable Swift domain module.
- `server/api/` — scalable TypeScript/Fastify API with PostgreSQL and Stytch.
- `server/supabase/` — optional Supabase-specific infrastructure, not an iOS dependency.
- `.github/workflows/` — CI workflows.
- `deploy/helm/rallyroo/` — Helm chart for the API, PostgreSQL, Redis, and NGINX.
- `deploy/local/` — isolated kind-based local deployment scripts.
- `deploy/flux/rallyroo/` — Flux OCI release reconciliation manifests.
- `deploy/alerts/` — HMAC-verified Cloudflare Worker and Resend alert setup wizard.
- `site/` — tracker-free public and legal site deployed as Cloudflare Workers Static Assets.
- `family-app-architecture.md` — product architecture and delivery phases.
- `docs/deployment-architecture-journal.md` — deployment decisions, trade-offs, and reusable guidance.

## Local development

Requirements: Xcode 16+ with iOS 16 SDK support.

```bash
cd clients/ios
swift build
swift test
```

Open `clients/ios/FamilyApp.xcodeproj` in Xcode to run the SwiftUI app on an iOS
simulator or device. The app links the local `FamilyCore` package, which contains
the event domain and persistence layer.

## Data modes

Rallyroo defaults to local mode and requires no account or backend:

```bash
RALLYROO_DATA_MODE=local
```

The built-in HTTP adapters can be selected without changing app features or domain code:

```bash
RALLYROO_DATA_MODE=remote
RALLYROO_REMOTE_BASE_URL=https://api.example.com
```

A complete backend stack can be hosted locally on Kubernetes without a registry:

```bash
brew install helm kind
./deploy/local/deploy-local.sh
```

See [`deploy/README.md`](deploy/README.md) for persistence, credentials, inspection,
and the later domain/TLS path.

Remote mode configuration is validated by `AppConfiguration`. Authentication,
events, reminders, family members, and calendar subscriptions use vendor-neutral interfaces;
a custom server or another provider can implement `server/http-api.md`. Parents can
add HTTPS iCalendar feeds for TeamSnap, schools, and sports calendars from Settings.
Imported events remain read-only, participate in conflict detection, and consolidate
exact duplicates across family members' subscriptions while preserving combined
participants and provenance. Native events support participant-only alerts at their
start or a selected lead time, including recurring occurrences. Family reminders have
one due instant, shared completion, multiple assignees, and optional alerts without
blocking schedule time or creating conflicts. Local mode schedules on-device alerts;
remote mode delivers participant- or assignee-scoped APNs notifications from the API.
Remote schedules keep an account-scoped last-good cache for read-only offline viewing.
Conflict alerts remain local to each device for now.

## Secret scanning

Install the repository's pre-commit guard once per clone:

```bash
brew install pre-commit
pre-commit install
```

The pinned Gitleaks hook scans staged changes with the rules in `.gitleaks.toml`.
The Security workflow independently scans Git history on every pull request and
push to `main`, so CI still blocks leaks when a local hook is skipped. Findings are
redacted; a real credential finding requires immediate revocation or rotation.

## Continuous integration

The API workflow runs unit tests, typechecking, production builds, and isolated
integration tests against PostgreSQL 17 and Redis 8.10.1. The iOS workflow builds
the complete simulator app, runs the Swift package suite against a live Fastify
contract server, and drives a local-mode parent smoke path with XCUITest. Neither
workflow requires production credentials; Stytch, Google Places, and APNs live
smoke tests remain opt-in.
