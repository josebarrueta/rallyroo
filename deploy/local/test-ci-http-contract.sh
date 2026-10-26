#!/usr/bin/env bash
# Render the real edge configuration against a synthetic API. No Kubernetes,
# production credentials, external identity provider or live Family data.
set -Eeuo pipefail
umask 077
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
for tool in docker helm ruby curl; do command -v "$tool" >/dev/null; done
scratch=$(mktemp -d)
prefix="rallyroo-http-ci-$(date +%s)-$$"
api="$prefix-api"
nginx="$prefix-nginx"
image="$prefix:test"
cleanup() {
  docker rm --force "$nginx" "$api" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

# Explicit allow-list: no .env, host npm config, credentials or node_modules
# can enter the build context, even on an operator's workstation.
mkdir -p "$scratch/context/test/support"
cp "$ROOT/server/api/package.json" "$ROOT/server/api/package-lock.json" "$scratch/context/"
cp -R "$ROOT/server/api/src" "$scratch/context/"
cp "$ROOT/server/api/test/support/contract-server.ts" "$scratch/context/test/support/"
helm template rallyroo-http-ci "$ROOT/deploy/helm/rallyroo" \
  --show-only templates/nginx.yaml >"$scratch/edge.yaml"
ruby -ryaml - "$scratch/edge.yaml" "$scratch/default.conf" "$scratch/nginx-image" <<'RUBY'
documents = YAML.load_stream(File.read(ARGV[0]))
config = documents.find { |d| d['kind'] == 'ConfigMap' }.fetch('data').fetch('default.conf')
upstream = 'http://rallyroo-http-ci-api:3000'
abort 'Unexpected edge upstream' unless config.scan(upstream).length == 1
# Only Kubernetes service discovery changes. Routing, headers and error handling
# remain the actual chart configuration.
File.write(ARGV[1], config.sub(upstream, 'http://127.0.0.1:3100'))
container = documents.find { |d| d['kind'] == 'Deployment' }.fetch('spec')
  .fetch('template').fetch('spec').fetch('containers').find { |c| c['name'] == 'nginx' }
File.write(ARGV[2], container.fetch('image'))
RUBY
nginx_image=$(<"$scratch/nginx-image")
docker build --quiet --file "$ROOT/deploy/local/Dockerfile.contract" --tag "$image" "$scratch/context" >/dev/null
# The API remains loopback-only inside its namespace. Publish only NGINX on a
# random loopback port; the second container shares that isolated namespace.
docker run --detach --name "$api" --publish 127.0.0.1::8080 "$image" >/dev/null
docker run --detach --name "$nginx" --network "container:$api" \
  --mount "type=bind,source=$scratch/default.conf,target=/etc/nginx/conf.d/default.conf,readonly" \
  "$nginx_image" >/dev/null
base_url="http://$(docker port "$api" 8080/tcp)"
ready=false
for _ in {1..45}; do
  if curl --fail --silent --max-time 2 "$base_url/ready" >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Synthetic HTTP stack did not become ready' >&2; exit 1; }
"$ROOT/deploy/local/test-http-contract.sh" "$base_url"
echo 'Synthetic NGINX/API smoke passed; this is not a live Kubernetes deployment acceptance.'
