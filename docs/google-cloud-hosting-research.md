# Google Cloud hosting and edge-database research

## Question

How can Rallyroo move production services off the development Mac while keeping local development isolated and costs low? Could an Arduino UNO Q with 4 GB RAM and 32 GB storage safely host the production PostgreSQL database?

## Current state

Rallyroo currently has two logically separate stacks on one physical Mac:

| Purpose | Runtime | PostgreSQL/Redis persistence |
|---|---|---|
| Production-like deployment | Dedicated kind cluster, kubeconfig, and `rallyroo` namespace | Host paths below `~/.rallyroo/data` |
| API development | Docker Compose | Docker volumes `api_rallyroo-postgres` and `api_rallyroo-redis` |

The stacks do not share database files, but they do share the Docker daemon, host resources, and failure domain. A Mac restart, Docker failure, resource exhaustion, or developer cleanup can affect production. The Compose ports are now bound to `127.0.0.1` so development PostgreSQL, Redis, and API ports are not exposed to the local network.

Observed persistent usage is small (about 65 MB in total and about 9.5 MB reported by PostgreSQL), so reliability and operational simplicity matter more than database capacity today. The running API, Nginx, PostgreSQL, and Redis containers currently use roughly 87, 22, 77, and 83 MiB respectively at idle. This supports an `e2-micro` trial, but load testing and hard memory limits are still required because the deployed Kubernetes limits exceed 1 GB in aggregate.

The production chart also contains machine-specific assumptions that must be removed before migration:

- PostgreSQL and Redis use host-path storage.
- Ollama is reached through `host.docker.internal`.
- Flux reconciles into the local kind cluster.
- The API process runs recurring notification, retention, family-data-protection, commuter-alert, and Caltrain-polling timers.

The unrelated authenticated gcloud account has been removed and the stale `seam-ai-prod` project has been unset from the local default configuration. No account or project is currently active. Create a dedicated Rallyroo Google account/project, billing account, and named gcloud configuration before provisioning anything.

## Google Cloud findings

### Compute Engine always-free VM

Google Cloud's Free Tier currently includes one non-preemptible `e2-micro` VM per month in `us-west1`, `us-central1`, or `us-east1`, plus 30 GB-months of standard persistent disk and a limited amount of outbound transfer. Usage beyond the documented limits is billed. The VM has shared vCPU capacity and 1 GB RAM.

This can run a small Docker Compose installation containing the API, PostgreSQL, and possibly Redis, but 1 GB leaves little room for Kubernetes. A VM deployment should therefore replace kind/Flux on the host rather than reproduce that stack. Add swap only as a safety valve; do not treat swap as application capacity.

This is the lowest-cost complete off-Mac option, but it remains a single host and requires OS patching, database maintenance, monitoring, backups, and recovery by the project owner. Do not assume a zero-dollar bill: public IPv4 addresses, snapshots, backup storage, and traffic beyond Free Tier allowances can be charged even when VM compute and the standard persistent disk remain within their allowances.

### Cloud Run

Cloud Run has a monthly free usage allowance, but it is request-oriented. Rallyroo's API currently performs important work from process-local timers. With scale-to-zero, those timers stop. Keeping a minimum instance warm consumes billable resources and still does not provide a strong exactly-once scheduling contract.

Cloud Run becomes a good fit after recurring work is moved to explicit idempotent worker endpoints or jobs invoked by Cloud Scheduler. Cloud Scheduler currently provides three jobs per billing account at no charge; Rallyroo has more recurring concerns than that, although compatible jobs could be grouped behind one authenticated dispatcher.

### Cloud SQL for PostgreSQL

Cloud SQL does not have an ongoing always-free PostgreSQL instance. New-customer credits are temporary. Even a small shared-core instance accrues compute, storage, backup, and possible network charges.

Cloud SQL offers the strongest operational baseline of the evaluated options: managed patching, automated backups, point-in-time recovery options, monitoring, and private connectivity. It is the preferred production database when a modest recurring bill is acceptable. Confirm a fresh estimate in the Google Cloud Pricing Calculator before provisioning because region, storage, backup retention, and network topology affect price.

### Budgets are alerts, not caps

Cloud Billing budgets can notify at thresholds but do not automatically cap spending. Pair a low budget with alerts to more than one recipient, quota review, least-privilege IAM, and a documented shutdown procedure. Do not automatically disable billing as the primary control; that can destroy availability and complicate recovery.

## Arduino UNO Q assessment

Arduino documents the UNO Q as a Debian Linux-capable board with a quad-core Arm Cortex-A53 processor, Wi-Fi 5, Bluetooth 5.1, USB-C, and an available 4 GB RAM / 32 GB eMMC configuration. PostgreSQL has Debian arm64 packages, so running PostgreSQL is technically plausible.

It is **not recommended as Rallyroo's authoritative production database host**. The blocker is not database size or CPU; it is the failure and recovery profile:

- the 32 GB eMMC also holds the OS and provides no storage redundancy;
- Arduino does not publish a database-workload endurance guarantee for the onboard eMMC;
- onboard networking is Wi-Fi rather than dedicated Ethernet;
- residential power, router, and ISP failures become production outages;
- inbound database exposure would create substantial security risk;
- hosting the API in Google Cloud while keeping its database on a home network creates a high-latency, fragile cross-internet dependency;
- backups, restore drills, monitoring, patching, physical security, and spare-device replacement all remain manual.

Do not expose PostgreSQL port 5432 to the internet. A VPN or outbound tunnel reduces exposure but does not solve availability, storage endurance, or disaster recovery.

A safer UNO Q role is non-authoritative: development, staging, an encrypted backup receiver, or a delayed read-only replica. Even then, use durable external storage where supported, wired networking through a compatible adapter, a UPS, temperature/storage monitoring, unattended security updates, encrypted backups, and periodic restore tests. Verify each accessory and boot/storage arrangement on the actual board before relying on it.

## Designs considered

### A. Single always-free Compute Engine VM

Run Docker Compose on an `e2-micro` VM:

- Caddy or another small TLS reverse proxy
- Rallyroo API
- PostgreSQL with tightly constrained memory
- Redis only if production behavior proves it is required
- scheduled encrypted `pg_dump` backups copied off-VM

**Advantages:** low cost when kept within the Free Tier compute/disk allowances, simple topology, moves the entire production failure domain off the Mac, and preserves process-local timers.

**Disadvantages:** one small shared-core host, no automatic failover, owner-operated database, and limited memory. A VM or zone failure causes downtime until recovery.

### B. Cloud Run plus Cloud SQL

Run the request-serving API on Cloud Run, PostgreSQL on Cloud SQL, and recurring work as authenticated scheduled jobs/endpoints.

**Advantages:** managed database operations, independent scaling, smaller server-maintenance burden, and a cleaner long-term architecture.

**Disadvantages:** recurring monthly database cost, application refactoring for background work, and additional IAM/networking complexity.

### C. Cloud API plus home/UNO Q database

**Rejected for production.** It combines cloud cost with home-network latency and availability, places the database in the weaker failure domain, and makes secure connectivity and recovery harder.

### D. Preserve Helm on Google Cloud

Cloud Run cannot run a Helm chart; Helm targets Kubernetes. The closest equivalent to the local deployment is a single-zone GKE Standard cluster with one `e2-medium` node, the existing Helm chart and Flux, PVC-backed PostgreSQL/Redis, and an outbound Cloudflare Tunnel instead of a Google external load balancer. At current US-region prices, budget roughly **$30–40/month** for the node, public IPv4 or NAT, disks, backups, and low traffic. The GKE free-tier credit offsets one zonal cluster's management fee, but not node compute.

Using a Google external load balancer instead of the tunnel adds a roughly $18/month forwarding-rule floor, putting the stack around **$50–60/month**. Replacing the PostgreSQL pod with single-zone Cloud SQL `db-g1-small` adds roughly $28/month, producing a safer managed-database variant around **$60–75/month** with the tunnel or **$80–90/month** with a Google load balancer.

A Compute Engine VM running k3s and Helm has a similar **$30–40/month** all-in estimate on `e2-medium` and avoids GKE-specific configuration, but makes the Kubernetes control plane, node OS, and database entirely owner-operated. An `e2-small` is around half the VM compute cost but its 2 GiB RAM is too close to the approximately 2 GiB currently consumed by the complete local kind node. Use 4 GiB initially and resize only after measurement.

Running Cloud Run plus the unchanged full Helm release is not useful: it deploys the API twice. A split design could run the API on Cloud Run and only PostgreSQL/Redis on Kubernetes, but Cloud SQL is operationally better than maintaining a Kubernetes cluster solely for data services.

## Selected architecture: one 16 GiB GCP VM plus home AI

The selected design does not use Cloud Run or Cloud SQL. One Compute Engine VM runs the complete production Kubernetes stack, while Ollama remains on the current Mac:

```text
iOS -> Cloudflare Tunnel -> GCP VM -> k3s -> Nginx/API/PostgreSQL/Redis
                                         |
                                         +-> Cloudflare Access -> AI Tunnel on Mac
                                                                        |
                                                               narrow AI gateway
                                                                        |
                                                               localhost Ollama
```

Use `e2-standard-4` (4 vCPU, 16 GiB) on demand in `us-central1` for the credit period. Its compute list price is approximately $98/month. With an in-use IPv4 address, boot/data disks, backups, logs, and low egress, budget **$108–120/month**, or **$216–240 for two months**. Verify the live estimate before provisioning. Do not use Spot for the stateful production host.

An `e2-highmem-2` retains 16 GiB with 2 vCPU and costs approximately $66/month for compute. Consider switching to it only after two months of CPU measurements. Do not purchase a committed-use discount during the trial.

Install k3s rather than kind or kubeadm, then bootstrap the existing Flux source/release and Helm chart. Mount a separately managed balanced persistent disk below `/var/lib/rallyroo` for PostgreSQL and Redis; keep the boot disk replaceable. Use a GCP-specific values file to remove Mac paths and point `OLLAMA_BASE_URL` at the protected AI hostname.

Run one named Cloudflare Tunnel connector on the GCP VM for public API ingress. No API, PostgreSQL, Redis, Kubernetes, or SSH port should be publicly open. The AI tunnel connector runs on the Mac because the connector belongs beside its origin; the GCP API reaches it through a separate Cloudflare Access-protected HTTPS hostname.

The GCP API authenticates to the AI hostname with a Cloudflare Access service token synchronized from 1Password. Configure a Service Auth policy that permits only that token, enable Access protection/validation on the tunnel, rotate the token, and alert before expiration.

Do **not** publish Ollama's native HTTP server directly. Keep Ollama bound to loopback and put a small gateway in front of it that:

- accepts only `POST /api/chat` (or preferably a Rallyroo-specific extraction endpoint);
- enforces the configured model, request size, timeout, and low concurrency;
- rejects model-management and all other Ollama endpoints;
- does not log prompts, family names, response bodies, or authentication headers;
- validates Cloudflare Access at the origin as defense in depth;
- returns health separately without revealing model or host details.

The existing Ollama client already treats network failures as an unavailable provider and has a 90-second total timeout, but currently sends only `Content-Type`. It must be extended to attach the Access service-token headers. Consider a shorter user-facing timeout and a circuit breaker so a sleeping/offline Mac does not tie up API requests for 90 seconds.

The Mac remains an availability dependency only for AI-assisted schedule extraction. Core authentication, events, reminders, notifications, and family data must continue to work when the tunnel, home internet, Mac, or Ollama is unavailable. Run `cloudflared`, the gateway, and Ollama under supervised services, prevent sleep, and monitor the AI hostname externally.

This data path sends schedule text and member context through Cloudflare to the home machine. Document the privacy boundary, avoid content logging throughout the path, and decide whether Cloudflare TLS termination is acceptable for this family data.

## Effect of the $300 two-month credit

The credit covers the selected `e2-standard-4` design for two months with an estimated $60–84 reserve. Use that reserve for parallel migration rehearsal, backup/restore testing, and unexpected network or logging charges rather than adding services that will create a post-credit dependency.

The VM remains on-demand during measurement. Before the credit expires, inspect billing plus 30 days of CPU, memory, disk, and network metrics. If CPU is consistently low, changing to `e2-highmem-2` preserves 16 GiB while reducing estimated compute from about $98 to $66/month. If memory is also low, `e2-standard-2` provides 8 GiB at roughly half the `e2-standard-4` compute price. Either resize requires a brief VM stop but not a database migration when the data disk is separate.

## Updated recommendation

Provision one on-demand `e2-standard-4` VM with 16 GiB RAM, k3s, the existing Helm/Flux release, a separate balanced persistent data disk, Cloudflare Tunnel ingress, and encrypted off-VM backups. Keep the Mac-hosted AI service behind its own Cloudflare Access-protected tunnel and narrow gateway.

This is intentionally a single failure domain. Kubernetes preserves the current deployment workflow and restarts workloads, but does not make a one-node database highly available. Recovery automation and tested backups are required before cutover.

Do not purchase a committed-use discount during the credit period. Measure CPU, memory, disk latency, and actual monthly cost first. Near credit expiry, choose between keeping `e2-standard-4` or changing the stopped VM to `e2-highmem-2`; the persistent data disk remains attached across a machine-type change.

Configure budget alerts at $50, $100, $150, and 80% of remaining credit, remembering that budgets do not cap spending.

The credit does **not** change the UNO Q conclusion. Do not use it as the primary production database. It can be evaluated later as a backup or staging target, but an offsite cloud backup must still exist.

## Migration plan

### 1. Establish account and environment boundaries

- Create a dedicated Rallyroo Google Cloud organization/project or personal project and billing account.
- Create a named gcloud configuration such as `rallyroo-prod`; require project/account checks in deployment scripts.
- Create separate production service accounts with least privilege. Do not reuse developer credentials.
- Define production DNS independently from the local Cloudflare tunnel.
- Keep production secrets in 1Password or a dedicated cloud secret store; never copy development secrets.

### 2. Prepare the application and VM deployment

- Provision the VM and disks with infrastructure as code, using deletion protection and explicit environment labels.
- Install k3s and bootstrap Flux against the existing OCI Helm release.
- Add GCP-specific Helm values for mounted persistence, Cloudflare API ingress, and the remote protected AI hostname.
- Remove `host.docker.internal`; configure Ollama through the authenticated AI tunnel and keep AI behavior optional.
- Add Cloudflare Access service-token headers to the Ollama client without logging their values.
- Add liveness/readiness checks and externally visible monitoring.
- Measure pod and node CPU, memory, disk latency, filesystem capacity, and restart behavior before cutover.

### 3. Build recovery before cutover

- Create daily encrypted logical PostgreSQL backups to a different failure domain.
- Retain multiple daily/weekly copies within a defined storage budget.
- Restore into a clean temporary PostgreSQL instance and verify record counts and application startup before declaring backups operational.
- Document recovery-time and recovery-point objectives.
- Preserve the encryption master key separately from database backups; losing it makes protected family data unrecoverable.

### 4. Rehearse migration

- Export the local production database with `pg_dump` and verify a checksum.
- Restore to an isolated candidate environment.
- Run migrations, API smoke tests, notification checks, and an iOS production-endpoint test.
- Verify APNs credentials, Cloudflare/DNS/TLS, Caltrain access, and all scheduled tasks.
- Measure VM and pod memory/CPU, PostgreSQL connections and query latency, disk latency, AI-tunnel behavior, and restart/deployment recovery for several days.

### 5. Cut over and retire local production

- Enter a short write-maintenance window.
- Take and verify a final backup, restore it remotely, then switch DNS/API configuration.
- Monitor authentication, event mutations, reminders, push notifications, recurring jobs, and error rate.
- Keep the local production stack stopped but recoverable for a defined rollback window; do not run both as writable primaries.
- After the rollback window, archive a final encrypted backup and delete local production volumes only after explicit confirmation.

## Primary sources

- [Google Cloud Free Tier](https://cloud.google.com/free/docs/free-cloud-features)
- [Compute Engine machine families: E2 shared-core](https://cloud.google.com/compute/docs/general-purpose-machines#e2_shared-core)
- [Virtual Private Cloud pricing, including external IP addresses](https://cloud.google.com/vpc/network-pricing#ipaddress)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Run minimum instances](https://cloud.google.com/run/docs/configuring/min-instances)
- [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing)
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing)
- [Cloud SQL PostgreSQL backups](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups)
- [Cloud Billing budgets](https://cloud.google.com/billing/docs/how-to/budgets)
- [Persistent Disk snapshots](https://cloud.google.com/compute/docs/disks/snapshots)
- [Arduino UNO Q hardware](https://docs.arduino.cc/hardware/uno-q/)
- [Arduino UNO Q datasheet](https://docs.arduino.cc/resources/datasheets/ABX00162-datasheet.pdf)
- [Debian PostgreSQL packages](https://packages.debian.org/stable/database/postgresql)
