# Production configuration and secret bootstrap

This runbook inventories Rallyroo production configuration, identifies the source
of every value, and describes how to generate values that are owned by Rallyroo
rather than issued by another service. It also records the planned destructive
PostgreSQL reset for adopting a new production password.

> **Never paste secret values into Git, issue trackers, chat, screenshots, shell
> history, or Helm values.** Store production credentials in the `rallyroo-prod`
> 1Password vault. Store readable configuration in the Helm-generated Kubernetes
> ConfigMap.

## Status and cutover prerequisite

The cluster runs the pinned 1Password Operator with direct Service Account
authentication, and Flux owns the first `OnePasswordItem`. Create and populate the
remaining items now, but **do not reset the cluster or database until all item
manifests, split Secret references, ConfigMap values, and bootstrap recovery steps
are merged and tested**.

The target design is:

- local development continues using `server/api/.env`;
- readable production configuration is committed as Helm/Flux values and rendered
  into `rallyroo-runtime-config`;
- an in-cluster 1Password Operator authenticates directly with a read-only Service
  Account and synchronizes each item into one narrowly scoped Kubernetes Secret;
- secret values are mounted as read-only files and loaded into memory by a
  provider-neutral runtime configuration module;
- PostgreSQL and migration Jobs receive only the PostgreSQL password file;
- no application credential is committed to Git or passed in Helm command-line
  values.

## Classification rules

Use these classifications consistently:

1. **Rallyroo-generated secret** — generate randomly and store only in 1Password.
2. **Provider-issued secret** — obtain from the provider dashboard and store only
   in 1Password.
3. **Readable configuration** — keep in Helm/Flux configuration, not 1Password.
4. **Derived configuration** — construct from other values in the chart; do not
   maintain another independent source of truth when avoidable.

Use one 1Password item per credential or provider credential set, not one item per
environment variable and not one catch-all runtime item.

## 1Password item inventory

Create these items in the `rallyroo-prod` vault. `API Credentials` is a suitable
category. Leave built-in `username`, `credential`, and website fields empty. Custom
field labels are case-sensitive because the 1Password Operator maps them to
Kubernetes Secret keys.

| Item title | Required custom fields | Source |
|---|---|---|
| `rallyroo-postgres` | `POSTGRES_PASSWORD` | Rallyroo-generated |
| `rallyroo-stytch` | `STYTCH_SECRET` | Stytch Live environment |
| `rallyroo-google-places` | `GOOGLE_PLACES_API_KEY` | Google Cloud |
| `rallyroo-resend-invitations` | `RESEND_API_KEY` | Resend, Sending access |
| `rallyroo-apns` | `APNS_PRIVATE_KEY`, `APNS_KEY_ID` | Apple Developer |
| `rallyroo-calendar-encryption` | `CALENDAR_SOURCE_ENCRYPTION_KEY` | Rallyroo-generated |
| `rallyroo-family-data-encryption` | `FAMILY_DATA_ENCRYPTION_KEY` | Rallyroo-generated |
| `rallyroo-observability` | `METRICS_BEARER_TOKEN` | Rallyroo-generated |
| `rallyroo-deployment-alert-webhook` | concealed `token`, text `address` | Rallyroo-generated shared HMAC and `https://alerts.rallyroo.dev/flux` |
| `rallyroo-alert-worker-resend` | `RESEND_API_KEY` | Resend, Full access |
| `rallyroo-cloudflare-tunnel` | `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Zero Trust |

The alert Worker Resend key and invitation-email Resend key are deliberately
separate. Invitation delivery should use a domain-restricted Sending-access key.
Resend custom Events currently requires Full access, so the Worker uses the
separate Full-access key.

Production does not store `DATABASE_URL`. PostgreSQL host, port, database, and user
are readable configuration; only `POSTGRES_PASSWORD` is secret. The API reads the
mounted password file and passes a structured configuration object to the
PostgreSQL client. Migration Jobs build a temporary mode-`0600` libpq password file
without placing the password in a URL, process argument, or environment variable.

The read-only 1Password Service Account token is a bootstrap credential and cannot
be synchronized by the Operator that needs it to start. Save its recovery copy in
a separate administrator-only vault that the Service Account cannot access.
Bootstrap places it only in
`onepassword-system/onepassword-service-account-token`. Never pass the value through
Helm `--set` because Helm stores release values in the cluster.

## Rallyroo-generated secrets

Generate each secret independently. The commands below place a value on the macOS
clipboard without adding the value itself to shell history or printing it. Paste it
immediately into the indicated concealed 1Password field, save the item, and clear
the clipboard.

Clear the clipboard after each value:

```bash
printf '' | pbcopy
```

### PostgreSQL password

Use a 32-byte hexadecimal password. Hexadecimal is URL-safe, so it can be embedded
in the current PostgreSQL connection URL without additional encoding.

```bash
openssl rand -hex 32 | tr -d '\n' | pbcopy
```

Paste it into `rallyroo-postgres` → `POSTGRES_PASSWORD`. Do not create a
`DATABASE_URL` field. The API reaches PostgreSQL through readable connection
configuration for the internal Kubernetes Service `rallyroo-postgres`.

### Calendar source encryption key

The API requires exactly 32 random bytes encoded as Base64 for AES-256-GCM:

```bash
openssl rand -base64 32 | tr -d '\n' | pbcopy
```

Paste it into `rallyroo-calendar-encryption` →
`CALENDAR_SOURCE_ENCRYPTION_KEY`. Keep this key stable after calendar subscriptions
exist. Losing or changing it makes stored subscription URLs unreadable.

### Family data encryption key

The API requires exactly 32 random bytes encoded as standard Base64. This key
wraps independent per-Family AES-256-GCM data keys; it does not directly encrypt
Event or Reminder details.

```bash
openssl rand -base64 32 | tr -d '\n' | pbcopy
```

Paste it into `rallyroo-family-data-encryption` →
`FAMILY_DATA_ENCRYPTION_KEY`. Keep an administrator-only recovery copy. Losing
this key makes every wrapped Family data key, and therefore all protected Family
details, unreadable. Never reuse the calendar-source key.

### Metrics bearer token

```bash
openssl rand -hex 32 | tr -d '\n' | pbcopy
```

Paste it into `rallyroo-observability` → `METRICS_BEARER_TOKEN`.

### Deployment-alert HMAC secret

```bash
openssl rand -hex 32 | tr -d '\n' | pbcopy
```

Paste it into `rallyroo-deployment-alert-webhook` → `token`. This one value must be
installed in two places by the alert setup process:

- Kubernetes/Flux reads it as the Secret key `token`;
- the Cloudflare Worker reads the same value as `FLUX_HMAC_SECRET`.

Do not generate separate values for those two consumers.

## Provider-issued secrets

### Stytch

Use the **Live** Stytch environment for production. In the Stytch Dashboard, open
**Project ID & API keys** and collect:

- secret → `rallyroo-stytch` / `STYTCH_SECRET`;
- Project ID → readable `STYTCH_PROJECT_ID`;
- Public token → readable `STYTCH_PUBLIC_TOKEN`.

Each Stytch environment has distinct credentials and data. Production uses
`STYTCH_ENV=live`; Test credentials must remain local-development credentials.
Configure Apple and Google OAuth and register `rallyroo://oauth-callback` in the
Live environment.

Source: [Stytch API keys and environments](https://stytch.com/docs/resources/workspace-management/api-keys).

### Google Places

In Google Cloud:

1. select the dedicated Rallyroo production project;
2. enable **Places API (New)**;
3. create a server-side API key;
4. restrict the key to Places API (New);
5. where practical, restrict it to the production egress IP;
6. store it in `rallyroo-google-places` → `GOOGLE_PLACES_API_KEY`.

Use a separate key from any future client-side Maps SDK key. Google recommends one
restricted key per application and API restrictions for every key.

Source: [Google Maps Platform security guidance](https://developers.google.com/maps/api-security-best-practices).

### Resend invitation delivery

1. Verify a dedicated sending subdomain in Resend and publish the exact DNS records
   Resend supplies.
2. Create a key named for Rallyroo production invitations.
3. Select **Sending access** and restrict it to that domain.
4. Store it in `rallyroo-resend-invitations` → `RESEND_API_KEY`.
5. Set readable `INVITATION_EMAIL_FROM` to a sender on the verified domain, for
   example `Rallyroo <invites@notifications.rallyroo.dev>`.

Sources:

- [Resend: create an API key](https://resend.com/docs/create-an-api-key)
- [Resend: add and verify a domain](https://resend.com/docs/add-a-domain)

### Resend deployment-alert Events API

The Cloudflare alert Worker submits custom Resend Events, which currently requires
a Full-access key:

1. create a separate Full-access Resend API key;
2. store it in `rallyroo-alert-worker-resend` → `RESEND_API_KEY`;
3. install it only as the Cloudflare Worker secret `RESEND_API_KEY`.

Do not sync this item into the Rallyroo application namespace.

### Apple Push Notification service

After Apple Developer membership and the app identifier are active:

1. enable Push Notifications for `dev.rallyroo.app`;
2. under Certificates, Identifiers & Profiles → Keys, create an APNs key;
3. prefer a production-restricted, topic-specific key for `dev.rallyroo.app` when
   the account supports it;
4. download the `.p8` file once and store its complete contents in
   `rallyroo-apns` → `APNS_PRIVATE_KEY`;
5. store the Key ID with the private key because those values rotate together;
6. record the Team ID, bundle ID, and environment as readable configuration.

Apple only allows the private key download once. The key does not expire but can be
revoked.

Sources:

- [Apple: create a private key](https://developer.apple.com/help/account/keys/create-a-private-key)
- [Apple: APNs authentication tokens](https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens/)

### Cloudflare Tunnel

The existing tunnel token is issued by Cloudflare Zero Trust. Save a recovery copy
in `rallyroo-cloudflare-tunnel` → `CLOUDFLARE_TUNNEL_TOKEN`. It remains a system
connector credential and is not injected into Rallyroo pods.

### 1Password Service Account and Operator bootstrap

In 1Password.com, open Developer Tools / Service Accounts and create
`rallyroo-kubernetes-operator-prod`. Grant it read-only access to `rallyroo-prod`
with no create, edit, delete, archive, or share permissions. Save the token when it
is displayed because it cannot be recovered later.

Create both `onepassword-system` and the watched `rallyroo` namespace before Helm
installation; the chart creates a RoleBinding in the watched namespace. Then create
`onepassword-system/onepassword-service-account-token` without printing the value
or putting it in command arguments. Install pinned chart `2.4.1` with Operator
`1.12.0`, `connect.create=false`,
`operator.authMethod=service-account`, `operator.watchNamespace={rallyroo}`, and
automatic workload restart enabled. The Operator has no Ingress or public service.

Sources:

- [1Password Kubernetes Operator with a Service Account](https://www.1password.dev/k8s/operator)
- [1Password Operator chart 2.4.1 values](https://github.com/1Password/connect-helm-charts/blob/connect-2.4.1/charts/connect/values.yaml)
- [1Password Operator 1.12.0](https://github.com/1Password/onepassword-operator/releases/tag/v1.12.0)

## Readable production configuration

These values are not secrets. They should be reviewable in Helm/Flux values and
rendered into `rallyroo-runtime-config`.

| Variable | Production value or source |
|---|---|
| `STYTCH_PROJECT_ID` | `project-live-9211da89-0aa2-4ee9-a661-ebc8d68ae4b5` |
| `STYTCH_PUBLIC_TOKEN` | `public-token-live-7ce8cefc-8580-4e62-a385-035e81e9918d` |
| `STYTCH_OAUTH_CALLBACK_URL` | `rallyroo://oauth-callback` |
| `STYTCH_ENV` | `live` |
| `STYTCH_CUSTOM_BASE_URL` | `https://login.rallyroo.dev` |
| `INVITATION_EMAIL_FROM` | `Rallyroo <invites@rallyroo.dev>` |
| `APNS_TEAM_ID` | Apple Developer Team ID (`5LS29Z8553`) |
| `APNS_BUNDLE_ID` | `dev.rallyroo.app` |
| `APNS_ENV` | `production` |
| `LOG_LEVEL` | `info` |

The chart derives or owns these operational values:

| Variable | Value |
|---|---|
| `HOST` | `0.0.0.0` |
| `PORT` | `3000` |
| `REDIS_URL` | `redis://rallyroo-redis:6379` |
| PostgreSQL user | `rallyroo` |
| PostgreSQL database | `rallyroo` |
| PostgreSQL host | `rallyroo-postgres` |
| Public API origin | `https://api.rallyroo.dev` |
| Alert Worker address | `https://alerts.rallyroo.dev/flux` |

Do not store placeholders as empty 1Password fields. The Operator skips empty fields
by default; optional credentials should be absent until configured.

## Destructive PostgreSQL reset with a new password

This is the selected production-password cutover because Rallyroo is preproduction
and existing data may be discarded. It is simpler and safer than attempting an
in-place password handoff across old and new application pods.

### Consequences

The reset permanently removes all PostgreSQL application data, including families,
accounts, events, invitations, device tokens, calendar connections, and migration
history. Redis cache data can also be discarded. Cloudflare, 1Password, Stytch,
Resend, APNs, and bundled iOS data are unaffected.

The production chart mounts `rallyroo-postgres/POSTGRES_PASSWORD` as a read-only
file. PostgreSQL consumes it through `POSTGRES_PASSWORD_FILE`; the API builds a
structured pool configuration in memory; migration Jobs build a temporary mode
`0600` `PGPASSFILE`. Local development retains `.env`-based `DATABASE_URL` support.
No production workload receives a password-bearing `DATABASE_URL`.

The official PostgreSQL image applies the password or password-file content only
when its data directory is empty; changing the Secret does not modify an existing
database. Source: [Docker Official Image for PostgreSQL](https://github.com/docker-library/docs/blob/master/postgres/README.md#environment-variables).

### Preconditions

Do not begin until all boxes are true:

- [ ] The new `rallyroo-postgres` item contains only `POSTGRES_PASSWORD`.
- [ ] All required provider items exist in `rallyroo-prod`.
- [ ] The readable ConfigMap values have been reviewed.
- [ ] The 1Password Operator preflight created test Kubernetes Secrets without
      exposing values.
- [ ] The production bootstrap wizard and split Helm Secret references are merged.
- [ ] Flux deployment alerts remain operational during the cutover.
- [ ] Existing database data has explicitly been declared disposable, or a verified
      backup exists.
- [ ] A maintenance window has started.

### Reset sequence

1. Suspend Flux reconciliation so it cannot recreate workloads during teardown.
2. Stop the Rallyroo Helm release and verify API/PostgreSQL/Redis pods are stopped.
3. Delete the isolated Kind cluster with `deploy/local/delete-local.sh`; verify the
   dedicated `kind-rallyroo` context is gone before touching host-path data.
4. Move, rather than immediately delete, the old PostgreSQL and Redis host-path
   directories to timestamped quarantine paths.
5. Create empty `postgres` and `redis` data directories.
6. Bootstrap the isolated cluster and 1Password Operator.
7. Wait for every required `OnePasswordItem` to report Ready and validate Secret
   **key names only**. Confirm the legacy `rallyroo-runtime` Secret has no
   `DATABASE_URL` or `POSTGRES_PASSWORD` keys before starting the API.
8. Install Rallyroo. PostgreSQL initializes the empty directory with the new
   password, then migration versions 1–8 run.
9. Enable Flux reconciliation and wait for the Helm test.
10. Run local and public HTTP contracts.
11. Create a production parent account and perform calendar/import smoke tests.
12. Verify deployment-failure email alerting still works.
13. Retain the quarantined old data until the new deployment passes its acceptance
    window, then securely remove it.

Exact teardown/bootstrap commands will be added to the production 1Password wizard.
Do not improvise a broad `rm -rf` command against `~/.rallyroo/data`.

### Alternative: preserve database data

If data must be preserved later, do not reset the volume. PostgreSQL supports an
in-place role-password change. Use interactive `psql` command `\password rallyroo`
so the cleartext password is not placed in SQL history or server logs, then perform
a coordinated 1Password sync and workload restart. PostgreSQL explicitly recommends
`\password` over embedding a cleartext password in `ALTER ROLE`.

Source: [PostgreSQL 17 `ALTER ROLE`](https://www.postgresql.org/docs/17/sql-alterrole.html).

## Final validation checklist

- [ ] No production credential exists in Git, Helm values, shell history, chat, or
      screenshots.
- [ ] Every 1Password item is in `rallyroo-prod` and has exact field labels.
- [ ] No catch-all `rallyroo-runtime` item remains after cutover.
- [ ] Kubernetes Secrets contain only their expected key names.
- [ ] API pods receive all required Secret and ConfigMap variables.
- [ ] Migration Jobs receive only PostgreSQL credentials.
- [ ] PostgreSQL initializes and `/ready` succeeds.
- [ ] Stytch Apple and Google login succeed against Live.
- [ ] Places search, invitation email, APNs, and calendar sync are smoke-tested.
- [ ] Metrics require the bearer token.
- [ ] Flux-to-Worker HMAC and Resend Automation delivery are verified.
- [ ] Service Account bootstrap-token and application-secret rotation are
      documented and scheduled.
