#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
CHART="$ROOT/deploy/helm/rallyroo"
VALUES="$CHART/values-local.yaml"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
rendered="$tmp/rendered.yaml"
flux_rendered="$tmp/flux-rendered.yaml"

helm lint "$CHART" --values "$VALUES"
helm template rallyroo "$CHART" --values "$VALUES" --is-upgrade \
  --set migrations.postUpgrade.enabled=true \
  --set runtimeConfig.enabled=true \
  --set runtimeConfig.stytch.projectID=project-live-test \
  --set runtimeConfig.stytch.publicToken=public-token-live-test \
  --set runtimeConfig.stytch.environment=live \
  --set runtimeConfig.stytch.customBaseURL=https://login.rallyroo.dev \
  --set 'runtimeConfig.invitationEmail.from=Rallyroo <invites@rallyroo.dev>' \
  --set runtimeConfig.ollama.baseURL=http://host.docker.internal:11435 \
  --set runtimeConfig.ollama.model=qwen3.8:27b-mlx \
  --set runtimeConfig.apns.teamID=5LS29Z8553 \
  --set runtimeConfig.apns.bundleID=dev.rallyroo.app \
  --set runtimeConfig.apns.environment=production \
  --set postgres.credentialsSecret=rallyroo-postgres \
  --set providerSecrets.stytch=rallyroo-stytch \
  --set providerSecrets.calendarEncryption=rallyroo-calendar-encryption \
  --set providerSecrets.familyDataEncryption=rallyroo-family-data-encryption \
  --set providerSecrets.googlePlaces=rallyroo-google-places \
  --set providerSecrets.resendInvitations=rallyroo-resend-invitations \
  --set providerSecrets.apns=rallyroo-apns \
  --set providerSecrets.observability=rallyroo-observability >"$rendered"
helm package "$CHART" --destination "$tmp" --version "0.1.1+deadbeef" >/dev/null
helm template rallyroo "$tmp/rallyroo-0.1.1+deadbeef.tgz" \
  --values "$VALUES" --is-upgrade >"$flux_rendered"

grep -q '"helm.sh/hook": pre-upgrade' "$rendered"
grep -q 'name: rallyroo-migrate' "$rendered"
grep -q 'args: \["pre"\]' "$rendered"
grep -q 'name: APPLICATION_VERSION' "$rendered"
grep -q '"helm.sh/hook": post-upgrade' "$rendered"
grep -q 'name: rallyroo-migrate-post' "$rendered"
grep -q 'name: wait-for-api-rollout' "$rendered"
grep -q 'deployment/rallyroo-api' "$rendered"
grep -q 'serviceAccountName: rallyroo-migration' "$rendered"
grep -q 'args: \["post"\]' "$rendered"
grep -q '"helm.sh/hook": test' "$rendered"
grep -q 'http://rallyroo-api:3000/ready' "$rendered"
grep -q 'repository: rallyroo-api' "$VALUES"
grep -q 'name: rallyroo-runtime-config' "$rendered"
grep -q 'LOG_LEVEL: "info"' "$rendered"
grep -q 'STYTCH_PROJECT_ID: "project-live-test"' "$rendered"
grep -q 'STYTCH_PUBLIC_TOKEN: "public-token-live-test"' "$rendered"
grep -q 'STYTCH_OAUTH_CALLBACK_URL: "rallyroo://oauth-callback"' "$rendered"
grep -q 'STYTCH_ENV: "live"' "$rendered"
grep -q 'STYTCH_CUSTOM_BASE_URL: "https://login.rallyroo.dev"' "$rendered"
grep -q 'INVITATION_EMAIL_FROM: "Rallyroo <invites@rallyroo.dev>"' "$rendered"
grep -q 'OLLAMA_BASE_URL: "http://host.docker.internal:11435"' "$rendered"
grep -q 'OLLAMA_MODEL: "qwen3.8:27b-mlx"' "$rendered"
grep -q 'APNS_TEAM_ID: "5LS29Z8553"' "$rendered"
grep -q 'APNS_BUNDLE_ID: "dev.rallyroo.app"' "$rendered"
grep -q 'APNS_ENV: "production"' "$rendered"
grep -q 'checksum/runtime-config:' "$rendered"
grep -A2 'configMapRef:' "$rendered" | grep -q 'name: rallyroo-runtime-config'
grep -q 'name: POSTGRES_PASSWORD_FILE' "$rendered"
grep -q 'value: /run/secrets/postgres/password' "$rendered"
grep -q 'name: PGHOST' "$rendered"
grep -q 'secretName: rallyroo-postgres' "$rendered"
grep -q 'defaultMode: 288' "$rendered"
grep -q 'name: STYTCH_SECRET_FILE' "$rendered"
grep -q 'value: /run/secrets/stytch/secret' "$rendered"
grep -q 'secretName: rallyroo-stytch' "$rendered"
grep -q 'name: CALENDAR_SOURCE_ENCRYPTION_KEY_FILE' "$rendered"
grep -q 'value: /run/secrets/calendar-encryption/key' "$rendered"
grep -q 'secretName: rallyroo-calendar-encryption' "$rendered"
grep -q 'name: FAMILY_DATA_ENCRYPTION_KEY_FILE' "$rendered"
grep -q 'value: /run/secrets/family-data-encryption/key' "$rendered"
grep -q 'secretName: rallyroo-family-data-encryption' "$rendered"
grep -q 'name: GOOGLE_PLACES_API_KEY_FILE' "$rendered"
grep -q 'value: /run/secrets/google-places/api-key' "$rendered"
grep -q 'secretName: rallyroo-google-places' "$rendered"
grep -q 'name: RESEND_API_KEY_FILE' "$rendered"
grep -q 'value: /run/secrets/resend-invitations/api-key' "$rendered"
grep -q 'secretName: rallyroo-resend-invitations' "$rendered"
grep -q 'name: APNS_KEY_ID_FILE' "$rendered"
grep -q 'value: /run/secrets/apns/key-id' "$rendered"
grep -q 'name: APNS_PRIVATE_KEY_FILE' "$rendered"
grep -q 'value: /run/secrets/apns/private-key' "$rendered"
grep -q 'secretName: rallyroo-apns' "$rendered"
grep -q 'name: METRICS_BEARER_TOKEN_FILE' "$rendered"
grep -q 'value: /run/secrets/observability/metrics-token' "$rendered"
grep -q 'secretName: rallyroo-observability' "$rendered"
if grep -Eq 'name: rallyroo-site|server_name rallyroo\.dev|mountPath: /usr/share/nginx/html|Privacy Policy' "$rendered"; then
  echo "The API chart must not package or serve the public website" >&2
  exit 1
fi
if grep -q 'name: DATABASE_URL' "$rendered"; then
  echo "Production workloads must not receive DATABASE_URL" >&2
  exit 1
fi
if grep -q 'name: rallyroo-runtime$' "$rendered"; then
  echo "Production workloads must not reference the legacy catch-all Secret" >&2
  exit 1
fi
if grep -q 'name: rallyroo-runtime-config' "$flux_rendered"; then
  echo "Local deployments must continue using server/api/.env instead of the production ConfigMap" >&2
  exit 1
fi
if grep -Eq 'helm.sh/chart: [^[:space:]]*\+' "$flux_rendered"; then
  echo "helm.sh/chart labels must sanitize OCI digest build metadata" >&2
  exit 1
fi

echo "Helm rollout contract passed"
