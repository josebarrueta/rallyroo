# Rallyroo deployments

For the production GCP host infrastructure, see [`gcp/README.md`](gcp/README.md).
The instructions below cover the isolated local Kubernetes environment.

## Local Kubernetes deployment

The Helm chart runs the API, PostgreSQL 17, Redis 8.10.1, and an unprivileged
NGINX edge proxy. The local profile uses a dedicated kind cluster and exposes
NGINX only on `127.0.0.1:8080`; it does not modify or deploy to an existing cloud
Kubernetes context.

## Requirements

- Docker Desktop
- `kubectl`
- Helm 3 or 4
- kind
- `server/api/.env` with valid Stytch test credentials

On macOS, install missing tools with `brew install helm kind`.

## Deploy locally

```bash
cp server/api/.env.example server/api/.env
# Configure STYTCH_* and any optional Resend, Places, or APNs credentials.
./deploy/local/deploy-local.sh
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/ready
```

The script uses a dedicated `~/.rallyroo/kubeconfig`, so it never selects or authenticates
to Kubernetes clusters in the default kubeconfig.

The script:

1. creates the isolated `kind-rallyroo` context if needed;
2. mounts `~/.rallyroo/data` into the cluster for durable PostgreSQL and Redis data;
3. builds and loads `rallyroo-api:local` without requiring a registry;
4. creates the provider/runtime Kubernetes Secret outside Helm values;
5. installs or upgrades the chart and waits for readiness.

Database migrations are bundled into the API image, serialized with a PostgreSQL
advisory lock, and recorded with checksums and application versions in
`schema_migrations`. `migrations/pre/` contains mandatory backward-compatible
changes. The API init container handles them on first install; a blocking Helm
`pre-upgrade` Job gates later rollouts before workloads change. Optional compatible
work in `migrations/post/` can run after a healthy rollout by explicitly enabling
`migrations.postUpgrade.enabled`. A failed migration rolls back its transaction and
fails the Helm release before promotion. Running the script again is safe.

Inspect the release without relying on the current kubectl context:

```bash
kubectl --kubeconfig ~/.rallyroo/kubeconfig --context kind-rallyroo -n rallyroo get all
kubectl --kubeconfig ~/.rallyroo/kubeconfig --context kind-rallyroo -n rallyroo logs deployment/rallyroo-api
helm --kubeconfig ~/.rallyroo/kubeconfig --kube-context kind-rallyroo -n rallyroo status rallyroo
```

Delete the cluster while retaining local database files:

```bash
./deploy/local/delete-local.sh
```

Delete `~/.rallyroo/data` separately only when a full data reset is intended.

## Published releases

Pushing a semantic version tag publishes both release artifacts to GHCR:

```bash
git tag -a v0.1.0 -m "Rallyroo 0.1.0"
git push origin v0.1.0
```

The release workflow publishes:

- a native Linux AMD64/ARM64 API image manifest at `ghcr.io/josebarrueta/rallyroo-api:0.1.0`;
- immutable API image tag `sha-<commit>`;
- `latest` for stable releases only;
- OCI Helm chart `oci://ghcr.io/josebarrueta/charts/rallyroo:0.1.0`;
- packaged Helm chart as a workflow artifact.

A release can also be published from **Actions → Release → Run workflow** by
entering a semantic version. No repository secret is required; publishing uses
the workflow-scoped `GITHUB_TOKEN`.

Pull or install a published chart with:

```bash
helm pull oci://ghcr.io/josebarrueta/charts/rallyroo --version 0.1.0
helm install rallyroo oci://ghcr.io/josebarrueta/charts/rallyroo \
  --version 0.1.0 \
  --namespace rallyroo \
  --create-namespace
```

Local chart installs expect the `.env`-derived `rallyroo-runtime` Secret.
Production uses `rallyroo-runtime-config` plus provider-scoped Secrets synchronized
by the 1Password Operator; it does not reference the catch-all Secret. The API
image and chart packages must be public for anonymous Kubernetes pulls;
package visibility is configured once from their GHCR package settings.

## Automatic patch releases with Flux

Flux polls the public OCI chart and upgrades to patch releases in the configured
minor series. It uses outbound HTTPS only; no deployment webhook is exposed.
Before enabling production reconciliation, create the isolated Kind cluster and
persistent data paths, install the 1Password Operator, and confirm every production
item exists. Then install the Flux CLI and run:

```bash
brew install fluxcd/tap/flux
./deploy/local/enable-flux.sh
```

To deliver Helm and migration failures by email, configure the HMAC-signed
Cloudflare Worker and Resend Automation with the interactive wizard:

```bash
./deploy/alerts/setup-alerting.sh
```

The Worker is published at the Custom Domain `alerts.rallyroo.dev`; Cloudflare
creates its DNS record and certificate, and `workers.dev` is disabled. The Resend
API key and recipient exist only as encrypted Worker secrets. Flux stores only the
Worker endpoint and shared HMAC key in the
`rallyroo-deployment-alert-webhook` Kubernetes Secret. The Worker accepts only
signed Rallyroo HelmRelease errors and converts them into Resend's
`deployment.failed` custom event. Resend owns the published template, Automation
run history, and delivery. Production bootstrap blocks until the Operator has
synchronized the alert webhook Secret with its exact `address,token` key contract.

The script installs Flux's source, Helm, and notification controllers, applies the
namespace-scoped reconciler in `deploy/flux/rallyroo/`, adopts the existing
`rallyroo` Helm release, waits for its Helm test, and runs the public HTTP
contract. Change the semver range in `deploy/flux/rallyroo/source.yaml` to
promote a new minor series. Inspect or pause reconciliation with:

```bash
export KUBECONFIG=~/.rallyroo/kubeconfig
flux get sources oci -n rallyroo
flux get helmreleases -n rallyroo
flux suspend helmrelease rallyroo -n rallyroo
flux resume helmrelease rallyroo -n rallyroo
```

Architecture rationale and reusable guidance are recorded in
[`docs/deployment-architecture-journal.md`](../docs/deployment-architecture-journal.md).
The production value inventory, 1Password item layout, secret-generation procedures,
and destructive PostgreSQL password reset are documented in
[`docs/production-configuration-and-secret-bootstrap.md`](../docs/production-configuration-and-secret-bootstrap.md).

## Domain hosting

The home-hosted deployment uses a Cloudflare Tunnel terminating public TLS and
forwarding `api.rallyroo.dev` to NGINX at `127.0.0.1:8080`. No router ports are
opened. Never expose PostgreSQL, Redis, Kubernetes, or the Docker socket—only
NGINX through the tunnel.

Cloudflare Workers Static Assets independently hosts the tracker-free product
and legal site from [`site/public/`](../site/public/). The `Rallyroo Site`
workflow validates pull requests and deploys changes from `main` to
`rallyroo.dev` and `www.rallyroo.dev`. Those hostnames must not be attached to
the home tunnel; only `api.rallyroo.dev` reaches NGINX. The API root and unknown
API paths retain their branded HTML `404` response.

Website deployment uses a narrowly scoped `CLOUDFLARE_SITE_API_TOKEN` GitHub
Actions secret and the readable `CLOUDFLARE_ACCOUNT_ID` repository variable.
The Worker keeps `workers.dev` and preview URLs disabled. Before using the
public URLs in Google Auth Platform or App Store Connect, configure and verify
Cloudflare Email Routing for `support@rallyroo.dev`.
