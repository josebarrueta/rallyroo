# Rallyroo GCP VM module

This Terraform root module provisions Rallyroo's single-node GCP production host.
It is deliberately an infrastructure boundary: Terraform creates the host and
installs deployment dependencies, but it never receives application, Cloudflare,
or 1Password credentials.

## What it creates

- a custom VPC and subnet with Private Google Access;
- one reserved public IP for outbound package downloads and the Cloudflare Tunnel;
- an ingress rule allowing SSH **only** through Google IAP;
- a Shielded Debian 12 `e2-standard-4` VM with OS Login and deletion protection;
- a separate `pd-balanced` data disk mounted at `/var/local/rallyroo`;
- a dedicated VM service account with only logging, metrics, metadata, and
  bucket-scoped backup object access;
- a private, versioned GCS backup bucket with lifecycle retention;
- optional IAP/OS Login IAM grants for explicitly named operators.

The idempotent first-boot script installs and configures:

- k3s with Traefik and ServiceLB disabled, Kubernetes secret encryption enabled,
  and pod/service CIDRs that do not overlap the GCP subnet;
- the Flux source, Helm, and notification controllers;
- pinned Helm, Flux CLI, and cloudflared binaries with release checksums;
- Google Cloud CLI, unattended upgrades, and the Cloud Ops Agent;
- helper commands for secret-safe Cloudflare Tunnel and 1Password Operator setup.

No firewall rule exposes HTTP, PostgreSQL, Redis, Kubernetes, Ollama, or an
administrative port publicly. The Cloudflare Tunnel is installed but remains
stopped until its token is supplied interactively.

## Prerequisites

1. Create a dedicated GCP project and attach billing.
2. Install Terraform >= 1.6 and authenticate Application Default Credentials:

   ```bash
   gcloud auth application-default login
   ```

3. The caller needs permission to enable APIs and manage Compute Engine, IAM,
   Storage, and project IAM members.
4. Bootstrap a dedicated, access-controlled GCS state bucket. It must be
   separate from the application backup bucket because Terraform cannot create
   the bucket that it needs before initialization. Terraform does not receive
   application secrets, but its state still describes production infrastructure.

## Provision

The Google Service Usage API and state bucket must exist before the first
Terraform initialization:

```bash
# Use PROJECT_ID, not the human-readable project NAME. Confirm with:
# gcloud projects list --format='table(projectId,name)'
PROJECT_ID=project-id-from-gcloud
STATE_BUCKET="rallyroo-terraform-state-$PROJECT_ID"

gcloud services enable serviceusage.googleapis.com storage.googleapis.com \
  --project "$PROJECT_ID"
gcloud storage buckets create "gs://$STATE_BUCKET" \
  --project "$PROJECT_ID" \
  --location us-central1 \
  --uniform-bucket-level-access \
  --public-access-prevention
gcloud storage buckets update "gs://$STATE_BUCKET" --versioning
```

Then initialize the partially configured GCS backend:

```bash
cd deploy/gcp
cp terraform.tfvars.example terraform.tfvars
# Edit project_id and admin_members.
terraform init \
  -backend-config="bucket=$STATE_BUCKET" \
  -backend-config="prefix=production/gcp"
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

If this directory already has local state, replace the initialization command
with `terraform init -migrate-state` and the same two `-backend-config` arguments.
Do not delete the local state until migration is confirmed.

Follow bootstrap progress with the `bootstrap_log_command` output. Completion is
also recorded at `/var/lib/rallyroo-bootstrap-complete` on the VM.

## Administration and credential bootstrap

Connect only through IAP using the emitted `iap_ssh_command`. Then provide the two
bootstrap credentials without putting either value in Terraform, command-line
arguments, or shell history:

```bash
sudo rallyroo-install-onepassword-operator
sudo rallyroo-set-cloudflare-token
```

The first command installs pinned 1Password chart `2.4.1` in service-account mode,
watching only the `rallyroo` namespace. Production polls every two hours to stay
within 1Password Families service-account daily read limits. After a 429 response,
the Operator may still retry every 15 minutes until the account-wide window resets.
The second command enables the Cloudflare systemd service. Configure the named tunnel in Cloudflare to route the public API hostname
to `http://localhost:30080`; do not add a public GCP firewall rule for that port.

This module installs Flux controllers but intentionally does not apply
`deploy/flux/rallyroo`: the `OnePasswordItem` resources must synchronize and be
validated before the `HelmRelease` is created. Perform that application bootstrap
with the repository deployment tooling after credential setup.

## Data and backups

The data disk mounts at `/var/local/rallyroo`, matching the chart's production
PostgreSQL and Redis host paths. The bootstrap assigns the PostgreSQL host path
to the image's UID/GID `70` before k3s starts. The VM service account can manage
objects only in the emitted backup bucket.

### Scheduled database backups

From the repository root, run `./deploy/gcp/install-backups.sh` on an operator
machine with IAP / OS Login access. This interactive installer does **not** rerun
the VM startup script or transfer a kubeconfig. It tests the scripts locally,
transfers only the reviewed job files, asks for confirmation before pruning, then
runs one backup and an isolated restore before enabling the timers. If direct SSH
fails, have an authorized operator run the wizard; CI must not have production
kubeconfig or VM credentials. New hosts receive the same files through Terraform
metadata at bootstrap; do not apply Terraform just to install these jobs on the
existing host.

`rallyroo-backup.timer` runs daily at **04:00 UTC**. Its oneshot service reads the
PostgreSQL password only inside the container from
`/run/secrets/postgres/password`, writes a PostgreSQL custom archive to a
root-only temporary directory on the mounted disk, validates its table of
contents, uploads it to GCS, downloads and byte-compares it, and **only then**
prunes to the **three newest live backup objects across the dedicated bucket**.
This includes older one-off archives outside `dumps/` with `.dump`, `.backup`, or
`.sql.gz` extensions. Unknown objects or listing failures abort pruning instead
of silently deleting them. An incomplete/unverified upload is removed when
possible; if GCS operations fail, alert on the failed service and reconcile the
live object count. The upload may briefly create a fourth live object while it
is verified. The bucket remains versioned and has a separate age-based lifecycle:
noncurrent and soft-deleted generations may exist beyond the three live objects.

`rallyroo-backup-verify.timer` runs monthly on the first at **06:00 UTC**, downloads
the newest archive, restores it into a disposable database on the PostgreSQL
server, checks for application tables, and drops the database. It never restores
over the production database. Check `systemctl list-timers --all
rallyroo-backup.timer rallyroo-backup-verify.timer`, `systemctl --failed`, and
`journalctl -u rallyroo-backup.service -u rallyroo-backup-verify.service --since
today` on the VM. Do not paste raw journal contents or archives into tickets.
Investigate failed jobs promptly: systemd timer activation is not an alerting
system. Before migrations or promotions, independently verify a recent backup;
a timer being active does not prove the backup or restore succeeded.

The data disk has Terraform `prevent_destroy`, the bucket has `force_destroy =
false`, and the VM defaults to GCP deletion protection. For an intentional teardown:

1. take and verify a final backup;
2. set `deletion_protection = false` and apply;
3. empty/delete retained bucket objects as intended;
4. remove the data disk's `prevent_destroy` lifecycle rule only after explicit
   approval, then destroy.

## Reuse from another Terraform root

The directory can also be called as a local module:

```hcl
module "rallyroo_host" {
  source = "../path/to/family_app/deploy/gcp"

  project_id = "project-id-from-gcloud"
  admin_members = [
    "user:operator@example.com",
  ]
}
```

Review version variables and the matching `cloudflared_sha256` during planned
upgrades. Changing a version updates VM metadata and reruns the idempotent startup
script.
