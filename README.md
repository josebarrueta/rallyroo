# Rallyroo

**One colorful schedule for the whole crew.** Rallyroo is a native iPhone app for coordinating Family Events, Reminders, connected calendars, and the plans that go with them. It is currently an invitation-only TestFlight beta.

[Website](https://rallyroo.dev) · [Public beta docs](https://rallyroo.dev/docs) · [Maintainer docs](docs/README.md) · [Support](https://rallyroo.dev/support)

## What Rallyroo does

- **Schedule:** Coordinate Event participants, drivers, locations, recurrence, and conflicts. Past Events are visually de-emphasized; imported calendars are read-only, with Personal calendars visible only to their owner.
- **Reminders and alerts:** Track responsibilities with due times, assignees, and shared completion, without blocking Schedule time. The Notification Center keeps Member inbox records separate from push delivery.
- **Travel and Commuter:** Add optional arrival targets and Travel plans to Events; see Caltrain trains and configure commute alerts when the Family enables Commuter. Live provider data can be delayed or unavailable.
- **Day Brief:** Opt into a Member-specific morning summary built from visible facts. Verified leave guidance can move it earlier, but an unavailable route does not become a guess. A missed brief does not turn into a late-night push.
- **Shopping and Pantry:** Manage routines and Pantry items, collect Family requests and Stock observations, then review trip decisions and record Purchase history. Evidence is not authoritative inventory.

Parents review AI-assisted Schedule drafts before anything is saved. AI cannot add Events or Reminders on its own or expand a Member's access to Family information.

## How it is built

The iOS app contains testable, backend-neutral domain code in `FamilyCore`. Development builds can run with local on-device storage; hosted beta builds use the Fastify API, PostgreSQL, and Redis. Apple and Google sign-in are verified by the server through Stytch. Protected Family details are encrypted per Family in PostgreSQL. The production stack runs on a GCP VM with k3s, Flux, a Cloudflare Tunnel for the API, and independently hosted Cloudflare Workers Static Assets for the [public site](https://rallyroo.dev).

`server/supabase/` is an optional historical adapter, **not** the current production backend.

## Get started developing

Use Xcode with Swift 6 support and an iOS 16+ simulator or device. The local app mode requires no production credentials:

```bash
cd clients/ios
swift build
swift test
```

Open `clients/ios/FamilyApp.xcodeproj` to run the SwiftUI app. `AppConfiguration` defaults to local mode in development; hosted beta builds use remote mode. For a local API stack or non-production remote configuration, see [API development](server/api/README.md) and [local Kubernetes deployment](deploy/README.md). Do not point development builds at production by accident or commit `.env` files.

To check the public site locally:

```bash
cd site
npm ci
npm test
npm run deploy:dry-run
```

## Documentation by theme

- **For beta families:** [Branded docs](https://rallyroo.dev/docs), [Privacy](https://rallyroo.dev/privacy), and [Support](https://rallyroo.dev/support).
- **Domain and interfaces:** [Domain language](CONTEXT.md), [historical architecture plan](family-app-architecture.md), [HTTP API contract](server/http-api.md), and [ADRs](docs/adr/).
- **Feature design:** [Day Brief and Shopping](docs/day-brief-and-shopping-design.md), [Travel planning](docs/event-travel-planning-design.md), and [Commuter research](docs/511-open-data-module-research.md).
- **Build and release:** [API](server/api/README.md), [TestFlight and App Store](docs/app-store-upload-guide.md), [site](site/README.md), and [deployments](deploy/README.md).
- **Operations:** [GCP host and backups](deploy/gcp/README.md), [production configuration](docs/production-configuration-and-secret-bootstrap.md), and [deployment decisions](docs/deployment-architecture-journal.md).

The [maintainer documentation index](docs/README.md) links the full set and distinguishes shipped behavior from design proposals and historical research.

## Releases and safety

A semantic tag publishes an API image and OCI Helm chart; publication alone does **not** verify or promote the live cluster. Before production migrations or promotion, independently verify a recent backup and restore path, then check the exact chart, image, rollout, and migrations. TestFlight acceptance requires an uploaded build tied to the intended commit and on-device verification. Production kubeconfig and credentials stay off GitHub-hosted runners.

Install the repository's secret-scanning hook before committing:

```bash
brew install pre-commit
pre-commit install
```

CI also checks for secrets and runs the API, iOS, chart, and site contracts without production credentials. Never put Family data, credentials, or raw production diagnostics in issues or logs.
