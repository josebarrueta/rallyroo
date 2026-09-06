# Rallyroo TypeScript API

Fastify reference backend for `../http-api.md`. It uses PostgreSQL for scalable,
shared persistence, Redis 8.10 for shared caching and vector-search readiness, and Stytch B2C for Apple and Google
identity verification. Rallyroo
roles and family membership remain in PostgreSQL, so identity providers stay
replaceable.

## Development

Requirements: Node 20+, PostgreSQL, and a Stytch test project.

```bash
cp .env.example .env
# Fill in all STYTCH_* values, enable Apple and Google OAuth in Stytch,
# and register rallyroo://oauth-callback as an allowed redirect URL.
docker compose up --build
```

The compose stack starts PostgreSQL and Redis, applies the schema to a fresh
PostgreSQL volume, and exposes the API at `http://localhost:3000`. The production
image also includes the ordered migration runner used by the Helm deployment.
For development outside Docker:

```bash
npm install
npm test
npm run typecheck
APPLICATION_VERSION=development DATABASE_URL="$DATABASE_URL" ./scripts/migrate.sh pre
npm run dev
```

Unit tests do not require infrastructure. Integration tests create and migrate a
temporary PostgreSQL database and use namespaced Redis keys:

```bash
npm run test:unit
INTEGRATION_DATABASE_URL=postgres://rallyroo:rallyroo@localhost:5432/postgres \
INTEGRATION_REDIS_URL=redis://localhost:6379 \
npm run test:integration
INTEGRATION_DATABASE_URL=postgres://rallyroo:rallyroo@localhost:5432/postgres \
npm run test:migrations
```

Migration filenames use one global numeric sequence. Put mandatory,
backward-compatible rollout changes in `migrations/pre/`. Put optional compatible
backfills or deferred work in `migrations/post/`; post migrations run only when the
chart's `migrations.postUpgrade.enabled` value is explicitly enabled. Never edit an
applied migration: the runner verifies its SHA-256 checksum and stores its version,
name, checksum, application version, and applied timestamp in
`schema_migrations`. Records created by the earlier filename-only runner are
backfilled as `legacy-unrecorded` rather than assigned a misleading release version.

GitHub Actions runs these as separate quality and service-backed integration jobs
using PostgreSQL 17 and Redis 8.10.1.

All Stytch integration and configuration is backend-owned. Never add Stytch
credentials, tokens, or SDKs to the iOS app, and never commit `.env`.

Verified Stytch identities are cached for 60 seconds and evicted on sign-out.
Normalized Google Places searches are cached for 30 minutes using hashed keys.
Redis is used when `REDIS_URL` is set; otherwise a process-local cache is used.

US address autocomplete uses Google Places when `GOOGLE_PLACES_API_KEY` is set.
Enable **Places API (New)** in Google Cloud and restrict the key to that API. If the
key is omitted, manual location entry still works and autocomplete returns no
suggestions.

## AI-assisted schedule drafts

Set `OLLAMA_BASE_URL` to enable parent-only schedule-draft extraction and optionally
set `OLLAMA_MODEL` (default `qwen3.8:27b-mlx`). For an API process running directly
on the Mac, use `http://127.0.0.1:11435`; containers can use the appropriate host
gateway address. Rallyroo sends bounded transcript, OCR, or typed text plus family
member context. The adapter uses deterministic generation and strict validation;
unsupported structured-output runtimes fall back to JSON-only generation before the
same validation. Draft extraction never writes events or reminders and request bodies
are not logged.

## Calendar subscriptions

Set `CALENDAR_SOURCE_ENCRYPTION_KEY` to a base64-encoded 32-byte random key to
activate parent-managed iCalendar imports. Store this key in the runtime secret,
not Helm values or Git, and retain it across deployments: losing it makes existing
feed URLs unreadable. Rotation requires decrypting and re-encrypting stored URLs.

The iCalendar adapter supports TeamSnap and other HTTPS subscription feeds. A
new connection immediately attempts its complete initial snapshot import. It
expands recurrences from one year before synchronization through two years after
it, caps snapshots at 5,000 events and recurrence scans at 50,000 candidates,
atomically replaces each source snapshot, and preserves the last good snapshot
on failure.

Each source is either Personal to its owning parent or Shared with family. Access
is filtered before exact cross-source deduplication and conflict detection, so a
personal event cannot leak through provenance, conflicts, notifications, or family
change cursors. Imported events remain read-only. User-supplied URLs are protected
against private-network access, redirects to private hosts, oversized responses,
and slow requests.

## Production operations

The API writes structured JSON request logs with request IDs, status codes, and
response duration. Authorization and cookie headers are redacted. Configure
verbosity with `LOG_LEVEL` (default `info`).

- `/health` reports process liveness without checking dependencies.
- `/ready` checks PostgreSQL; Redis remains an optional accelerator.
- `/metrics` exports Prometheus request, cache, and external-provider metrics.

Set a strong `METRICS_BEARER_TOKEN` in hosted environments. Session exchange,
invitation writes, and Places search have stricter route limits under a global
request ceiling. Rate-limited responses include `Retry-After`.

## Invitation email

Only authenticated parents can create or resend invitations. Configure the reference
Resend adapter with `RESEND_API_KEY` and a verified sender in
`INVITATION_EMAIL_FROM`, for example `Rallyroo <invites@yourdomain.com>`. The API
stores recipient addresses with pending invitations, rotates codes on resend, and
rolls back invitation state when delivery fails. Email delivery remains behind the
provider-neutral `InvitationEmailSender` interface.

## Push notifications

Set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY`, and
`APNS_ENV` to enable Apple Push Notification service delivery. The `.p8` private
key stays backend-only; encode line breaks as `\\n` when the deployment platform
requires a single-line secret. Without these values, device registration remains
available but delivery uses the no-op adapter.

## Account provisioning

A first-time Apple or Google identity without an invitation is provisioned just in time as
the parent of a new family. Provisioning creates the member and identity mapping
in one transaction and is idempotent across retries. Parents can create, list, cancel, and securely resend single-use, seven-day
invitations for another parent or kid. Resending rotates the code rather than
recovering its stored hash. Redeeming an invitation during Apple or Google sign-in
atomically provisions the new member
into the inviter's family; family IDs and invited roles are never client-selected.

## Architecture

- `IdentityProvider` — verifies external identity; Stytch is the first adapter.
- `RallyrooRepository` — persistence seam; PostgreSQL and in-memory adapters exist.
- `buildApp` — HTTP handler seam used by integration tests.
- Authorization is enforced server-side for every route.
