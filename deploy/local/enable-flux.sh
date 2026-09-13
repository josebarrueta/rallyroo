#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME=${RALLYROO_CLUSTER_NAME:-rallyroo}
CONTEXT="kind-$CLUSTER_NAME"
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOCAL_KUBECONFIG=${RALLYROO_KUBECONFIG:-$HOME/.rallyroo/kubeconfig}

for command in flux kubectl jq; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
[[ -f "$LOCAL_KUBECONFIG" ]] || { echo "Missing $LOCAL_KUBECONFIG" >&2; exit 1; }

export KUBECONFIG="$LOCAL_KUBECONFIG"
kubectl --context "$CONTEXT" cluster-info >/dev/null
flux check --pre --context "$CONTEXT"

# Artifact discovery, Helm reconciliation, and outbound failure notifications
# are needed. The default ingress-denying policies remain; no webhook is exposed.
flux install \
  --context "$CONTEXT" \
  --namespace flux-system \
  --components source-controller,helm-controller,notification-controller \
  --network-policy=true

kubectl --context "$CONTEXT" apply -f "$ROOT/deploy/flux/rallyroo/namespace.yaml"

# Provider Secrets are owned exclusively by the 1Password Operator. Apply and
# validate them before creating the HelmRelease so workloads cannot race secret
# synchronization or fall back to a manually managed catch-all Secret.
kubectl --context "$CONTEXT" get crd onepassworditems.onepassword.com >/dev/null 2>&1 || {
  echo "Install the 1Password Operator before enabling Flux" >&2
  exit 1
}
kubectl --context "$CONTEXT" apply -f "$ROOT/deploy/flux/rallyroo/onepassword-items.yaml"
onepassword_items=$(kubectl --context "$CONTEXT" -n rallyroo get onepassworditems \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
for item in $onepassword_items; do
  kubectl --context "$CONTEXT" -n rallyroo wait "onepassworditem/$item" \
    --for=condition=Ready --timeout=2m
  case "$item" in
    rallyroo-deployment-alert-webhook) expected_keys='address,token' ;;
    rallyroo-postgres) expected_keys='POSTGRES_PASSWORD' ;;
    rallyroo-stytch) expected_keys='STYTCH_SECRET' ;;
    rallyroo-calendar-encryption) expected_keys='CALENDAR_SOURCE_ENCRYPTION_KEY' ;;
    rallyroo-family-data-encryption) expected_keys='FAMILY_DATA_ENCRYPTION_KEY' ;;
    rallyroo-google-places) expected_keys='GOOGLE_PLACES_API_KEY' ;;
    rallyroo-google-routes) expected_keys='GOOGLE_ROUTES_API_KEY' ;;
    rallyroo-resend-invitations) expected_keys='RESEND_API_KEY' ;;
    rallyroo-apns) expected_keys='APNS_KEY_ID,APNS_PRIVATE_KEY' ;;
    rallyroo-sf511) expected_keys='SF511_API_KEY' ;;
    rallyroo-observability) expected_keys='METRICS_BEARER_TOKEN' ;;
    *) echo "No expected Secret key contract for $item" >&2; exit 1 ;;
  esac
  keys=$(kubectl --context "$CONTEXT" -n rallyroo get secret "$item" -o json | \
    jq -r '.data | keys | sort | join(",")')
  [[ "$keys" == "$expected_keys" ]] || {
    echo "Unexpected Secret keys for $item: $keys" >&2
    exit 1
  }
done

kubectl --context "$CONTEXT" apply -k "$ROOT/deploy/flux/rallyroo"
kubectl --context "$CONTEXT" -n rallyroo wait ocirepository/rallyroo-chart \
  --for=condition=ready --timeout=2m
kubectl --context "$CONTEXT" -n rallyroo wait helmrelease/rallyroo \
  --for=condition=ready --timeout=7m

kubectl --context "$CONTEXT" -n rallyroo get ocirepository,helmrelease
"$ROOT/deploy/local/test-http-contract.sh"
echo "Flux now tracks Rallyroo patch releases in the 0.5 series."
