variable "project_id" {
  description = "Immutable GCP project ID (not its display name) in which to create Rallyroo resources."
  type        = string
}

variable "region" {
  description = "GCP region for regional resources."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone for the single-node VM and data disk."
  type        = string
  default     = "us-central1-a"
}

variable "name" {
  description = "Prefix used for provisioned resources."
  type        = string
  default     = "rallyroo-prod"
}

variable "machine_type" {
  description = "Compute Engine machine type. Resize this in place after reviewing metrics."
  type        = string
  default     = "e2-standard-4"
}

variable "boot_disk_size_gb" {
  description = "Replaceable VM boot disk size in GiB."
  type        = number
  default     = 40

  validation {
    condition     = var.boot_disk_size_gb >= 20
    error_message = "boot_disk_size_gb must be at least 20 GiB."
  }
}

variable "data_disk_size_gb" {
  description = "Persistent balanced disk size in GiB for PostgreSQL and Redis."
  type        = number
  default     = 50

  validation {
    condition     = var.data_disk_size_gb >= 20
    error_message = "data_disk_size_gb must be at least 20 GiB."
  }
}

variable "subnet_cidr" {
  description = "RFC1918 CIDR used by the Rallyroo subnet."
  type        = string
  default     = "10.42.0.0/24"
}

variable "k3s_cluster_cidr" {
  description = "Non-overlapping CIDR used for Kubernetes pods. Must not overlap subnet_cidr."
  type        = string
  default     = "10.244.0.0/16"
}

variable "k3s_service_cidr" {
  description = "Non-overlapping CIDR used for Kubernetes services."
  type        = string
  default     = "10.96.0.0/16"
}

variable "k3s_cluster_dns" {
  description = "CoreDNS service address contained by k3s_service_cidr."
  type        = string
  default     = "10.96.0.10"
}

variable "admin_members" {
  description = "IAM members allowed to open IAP tunnels and use OS Login as administrator (for example, user:name@example.com)."
  type        = set(string)
  default     = []
}

variable "backup_bucket_name" {
  description = "Globally unique backup bucket name. Null derives a name from the resource prefix and project ID."
  type        = string
  default     = null
}

variable "backup_retention_days" {
  description = "Number of days before backup objects are deleted. Object versioning remains enabled."
  type        = number
  default     = 30

  validation {
    condition     = var.backup_retention_days >= 7
    error_message = "backup_retention_days must be at least 7."
  }
}

variable "deletion_protection" {
  description = "Protect the VM from accidental deletion. Set false explicitly before intentional replacement or destroy."
  type        = bool
  default     = true
}

variable "enable_os_login_2fa" {
  description = "Require two-factor authentication for OS Login."
  type        = bool
  default     = true
}

variable "install_ops_agent" {
  description = "Install the Google Cloud Ops Agent during first boot."
  type        = bool
  default     = true
}

variable "k3s_version" {
  description = "Pinned k3s release installed by the startup script."
  type        = string
  default     = "v1.36.4+k3s1"
}

variable "helm_version" {
  description = "Pinned Helm release installed by the startup script (without a leading v)."
  type        = string
  default     = "4.3.0"
}

variable "flux_version" {
  description = "Pinned Flux CLI release installed by the startup script (without a leading v)."
  type        = string
  default     = "2.9.5"
}

variable "cloudflared_version" {
  description = "Pinned cloudflared release installed by the startup script."
  type        = string
  default     = "2026.9.1"
}

variable "cloudflared_sha256" {
  description = "SHA-256 digest of the pinned cloudflared Linux AMD64 binary. Update this with cloudflared_version."
  type        = string
  default     = "03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc"

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.cloudflared_sha256))
    error_message = "cloudflared_sha256 must be a lowercase SHA-256 digest."
  }
}

variable "labels" {
  description = "Additional labels applied to supported resources."
  type        = map(string)
  default     = {}
}
