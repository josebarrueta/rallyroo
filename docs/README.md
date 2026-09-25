# Rallyroo documentation

[Public beta guide](https://rallyroo.dev/docs) · [Repository home](../README.md) · [Product site](https://rallyroo.dev)

These are the maintainer-facing guides and design records for Rallyroo. The public guide covers using the iPhone beta; the documents here explain implementation, decisions, and operations. Design and research documents may describe deferred work—check their status before treating an idea as shipped.

## Start here

- [Repository README](../README.md) — what Rallyroo does, project layout, and local development.
- [Domain language](../CONTEXT.md) — Family, Member, Event, Reminder, Travel plan, Stock evidence, and other terms used in code.
- [Original architecture plan](../family-app-architecture.md) — historical proposal, **not** the current implementation or deployment instructions.
- [HTTP API contract](../server/http-api.md) — backend-neutral client/server interface.

## Feature guides and design

- [Day Brief and Shopping](day-brief-and-shopping-design.md) — implemented v1 behavior, privacy rules, and explicitly deferred ideas.
- [Event Travel planning](event-travel-planning-design.md) — arrival targets, route previews, and Leave alerts.
- [Commuter integration research](511-open-data-module-research.md) — provider data and constraints; consult the current implementation for shipped scope.

## Architecture decisions

The [ADR directory](adr/) records why foundational boundaries exist:

1. [Transactional Event mutations](adr/0001-transactional-event-mutations.md)
2. [Schedule draft intake](adr/0002-schedule-draft-intake-module.md)
3. [Per-Family data encryption](adr/0003-per-family-data-encryption.md)
4. [Family-installed Commuter module](adr/0004-family-installed-commuter-module.md)
5. [Unified Notification Center](adr/0005-unified-notification-center.md)
6. [Separate Event Travel planning](adr/0006-separate-event-travel-planning.md)
7. [Durable recurrence occurrences](adr/0007-durable-recurrence-occurrences.md)

## Development and operations

- [API development and test setup](../server/api/README.md)
- [Deployment overview and local Kubernetes](../deploy/README.md)
- [GCP VM, backups, and isolated restore](../deploy/gcp/README.md)
- [Site build and publishing](../site/README.md)
- [App Store and TestFlight upload](app-store-upload-guide.md)
- [Deployment architecture journal](deployment-architecture-journal.md)
- [Production configuration and secret bootstrap](production-configuration-and-secret-bootstrap.md)
- [Secure Ollama tunnel](secure-ollama-tunnel.md)

Production promotion is separate from publishing artifacts: verify the backup, exact image/chart and commit, rollout, and TestFlight build as applicable. Production kubeconfig and credentials never belong in the repository or hosted CI.

## Background research

- [GCP hosting research](google-cloud-hosting-research.md) — decision background, **not** the production runbook.
- [Brand name research](brand-name-research.md) — historical exploration.
