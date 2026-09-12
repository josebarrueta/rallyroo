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
watching only the `rallyroo` namespace. The second enables the Cloudflare systemd
service. Configure the named tunnel in Cloudflare to route the public API hostname
to `http://localhost:30080`; do not add a public GCP firewall rule for that port.

This module installs Flux controllers but intentionally does not apply
`deploy/flux/rallyroo`: the `OnePasswordItem` resources must synchronize and be
validated before the `HelmRelease` is created. Perform that application bootstrap
with the repository deployment tooling after credential setup.

## Data and backups

The data disk mounts at `/var/local/rallyroo`, matching the chart's production
PostgreSQL and Redis host paths. The bootstrap assigns the PostgreSQL host path
to the image's UID/GID `70` before k3s starts. The VM service account can manage objects only in
the emitted backup bucket. Creating the bucket is not a backup system by itself;
backup scheduling, encryption, restore validation, and alerts must be configured
before cutover.

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
