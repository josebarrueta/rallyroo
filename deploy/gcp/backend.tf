terraform {
  # Backend arguments are intentionally supplied at init time so this module
  # does not hard-code a project-specific state bucket or prefix.
  backend "gcs" {}
}
