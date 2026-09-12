output "instance_name" {
  description = "Compute Engine instance name."
  value       = google_compute_instance.this.name
}

output "zone" {
  description = "Compute Engine instance zone."
  value       = google_compute_instance.this.zone
}

output "external_ip" {
  description = "Reserved egress IP. No application ports are open to the internet."
  value       = google_compute_address.this.address
}

output "service_account_email" {
  description = "Dedicated service account used by the VM."
  value       = google_service_account.vm.email
}

output "backup_bucket" {
  description = "Private, versioned bucket available to off-VM backup jobs."
  value       = google_storage_bucket.backups.name
}

output "iap_ssh_command" {
  description = "Command for administrative SSH through Identity-Aware Proxy."
  value       = "gcloud compute ssh ${google_compute_instance.this.name} --project=${var.project_id} --zone=${var.zone} --tunnel-through-iap"
}

output "bootstrap_log_command" {
  description = "Command that follows the first-boot dependency installation log."
  value       = "gcloud compute ssh ${google_compute_instance.this.name} --project=${var.project_id} --zone=${var.zone} --tunnel-through-iap --command='sudo tail -f /var/log/rallyroo-bootstrap.log'"
}
