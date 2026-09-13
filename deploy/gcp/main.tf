locals {
  labels = merge({
    application = "rallyroo"
    environment = "production"
    managed_by  = "terraform"
  }, var.labels)

  backup_bucket_name = coalesce(var.backup_bucket_name, "${var.name}-backups-${var.project_id}")

  required_services = toset([
    "compute.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "storage.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each = local.required_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "this" {
  project                 = var.project_id
  name                    = "${var.name}-network"
  auto_create_subnetworks = false

  depends_on = [google_project_service.required]
}

resource "google_compute_subnetwork" "this" {
  project                  = var.project_id
  name                     = "${var.name}-subnet"
  region                   = var.region
  network                  = google_compute_network.this.id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
}

resource "google_compute_firewall" "iap_ssh" {
  project   = var.project_id
  name      = "${var.name}-allow-iap-ssh"
  network   = google_compute_network.this.name
  direction = "INGRESS"
  priority  = 1000

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["${var.name}-iap-ssh"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_address" "this" {
  project      = var.project_id
  name         = "${var.name}-egress"
  region       = var.region
  address_type = "EXTERNAL"
  network_tier = "PREMIUM"

  depends_on = [google_project_service.required]
}

resource "google_service_account" "vm" {
  project      = var.project_id
  account_id   = substr(replace("${var.name}-vm", "_", "-"), 0, 30)
  display_name = "Rallyroo production VM"

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "vm_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = google_service_account.vm.member
}

resource "google_project_iam_member" "vm_metrics" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = google_service_account.vm.member
}

resource "google_project_iam_member" "vm_metadata" {
  project = var.project_id
  role    = "roles/stackdriver.resourceMetadata.writer"
  member  = google_service_account.vm.member
}

resource "google_project_iam_member" "admin_iap" {
  for_each = var.admin_members

  project = var.project_id
  role    = "roles/iap.tunnelResourceAccessor"
  member  = each.value
}

resource "google_project_iam_member" "admin_os_login" {
  for_each = var.admin_members

  project = var.project_id
  role    = "roles/compute.osAdminLogin"
  member  = each.value
}

resource "google_storage_bucket" "backups" {
  project                     = var.project_id
  name                        = local.backup_bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.backup_retention_days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "vm_backups" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.vm.member
}

resource "google_compute_disk" "data" {
  project = var.project_id
  name    = "${var.name}-data"
  zone    = var.zone
  type    = "pd-balanced"
  size    = var.data_disk_size_gb
  labels  = local.labels

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_compute_instance" "this" {
  project             = var.project_id
  name                = var.name
  zone                = var.zone
  machine_type        = var.machine_type
  deletion_protection = var.deletion_protection
  can_ip_forward      = false
  labels              = local.labels
  tags                = ["${var.name}-iap-ssh"]

  boot_disk {
    auto_delete = true
    initialize_params {
      image  = "debian-cloud/debian-12"
      size   = var.boot_disk_size_gb
      type   = "pd-balanced"
      labels = local.labels
    }
  }

  attached_disk {
    source      = google_compute_disk.data.id
    device_name = "rallyroo-data"
    mode        = "READ_WRITE"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.this.id
    access_config {
      nat_ip       = google_compute_address.this.address
      network_tier = "PREMIUM"
    }
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    block-project-ssh-keys       = "TRUE"
    enable-oslogin               = "TRUE"
    enable-oslogin-2fa           = var.enable_os_login_2fa ? "TRUE" : "FALSE"
    serial-port-enable           = "FALSE"
    rallyroo-k3s-version         = var.k3s_version
    rallyroo-k3s-cluster-cidr    = var.k3s_cluster_cidr
    rallyroo-k3s-service-cidr    = var.k3s_service_cidr
    rallyroo-k3s-cluster-dns     = var.k3s_cluster_dns
    rallyroo-helm-version        = var.helm_version
    rallyroo-flux-version        = var.flux_version
    rallyroo-cloudflared-version = var.cloudflared_version
    rallyroo-cloudflared-sha256  = var.cloudflared_sha256
    rallyroo-install-ops-agent   = tostring(var.install_ops_agent)
    rallyroo-backup-bucket       = google_storage_bucket.backups.name
    startup-script               = file("${path.module}/startup.sh")
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
    provisioning_model  = "STANDARD"
  }

  lifecycle {
    ignore_changes = [boot_disk[0].initialize_params[0].image]
  }

  depends_on = [
    google_project_iam_member.vm_logging,
    google_project_iam_member.vm_metadata,
    google_project_iam_member.vm_metrics,
    google_storage_bucket_iam_member.vm_backups,
  ]
}
