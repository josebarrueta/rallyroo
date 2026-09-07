#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
FLUX_DIR="$ROOT/deploy/flux/rallyroo"
ENABLE_SCRIPT="$ROOT/deploy/local/enable-flux.sh"

grep -q 'notification-controller' "$ENABLE_SCRIPT"
grep -q 'wait "onepassworditem/$item"' "$ENABLE_SCRIPT"
grep -q 'semver: ">=0.8.0 <0.9.0"' "$FLUX_DIR/source.yaml"
if grep -q 'create secret generic rallyroo-deployment-alert-webhook' "$ENABLE_SCRIPT"; then
  echo "Flux bootstrap must not overwrite the Operator-managed alert Secret" >&2
  exit 1
fi
grep -q 'notification.yaml' "$FLUX_DIR/kustomization.yaml"
grep -q 'onepassword-items.yaml' "$FLUX_DIR/kustomization.yaml"
grep -q '^kind: OnePasswordItem$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-deployment-alert-webhook$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-deployment-alert-webhook$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-postgres$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-postgres$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-stytch$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-stytch$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-calendar-encryption$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-calendar-encryption$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-google-places$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-google-places$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-resend-invitations$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-resend-invitations$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-apns$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-apns$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  name: rallyroo-observability$' "$FLUX_DIR/onepassword-items.yaml"
grep -q '^  itemPath: vaults/rallyroo-prod/items/rallyroo-observability$' "$FLUX_DIR/onepassword-items.yaml"
if grep -Eq '(token|address):[[:space:]]+[^[:space:]]' "$FLUX_DIR/onepassword-items.yaml"; then
  echo "OnePasswordItem manifests must contain references, never secret values" >&2
  exit 1
fi
grep -q '^kind: Provider$' "$FLUX_DIR/notification.yaml"
grep -q '^  type: generic-hmac$' "$FLUX_DIR/notification.yaml"
grep -q '^kind: Alert$' "$FLUX_DIR/notification.yaml"
grep -q '^  eventSeverity: error$' "$FLUX_DIR/notification.yaml"
grep -q '^    - kind: HelmRelease$' "$FLUX_DIR/notification.yaml"
grep -q '^      name: rallyroo$' "$FLUX_DIR/notification.yaml"

echo "Flux failure-alert contract passed"
