#!/usr/bin/env bash
set -euo pipefail

HOSTNAME=${OLLAMA_TUNNEL_HOSTNAME:-ollama.rallyroo.dev}
CLOUDFLARED=${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}
STATE_DIR="$HOME/Library/Application Support/Rallyroo/ollama-tunnel"
TOKEN_FILE="$STATE_DIR/tunnel-token"
LOG_DIR="$HOME/Library/Logs/Rallyroo"
PLIST="$HOME/Library/LaunchAgents/dev.rallyroo.ollama-tunnel.plist"
LABEL=dev.rallyroo.ollama-tunnel

if [[ -z "$CLOUDFLARED" ]]; then
  echo "cloudflared is required (brew install cloudflared)." >&2
  exit 1
fi

listener=$(lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null || true)
if [[ -z "$listener" ]]; then
  echo "Ollama is not listening on port 11434." >&2
  exit 1
fi
if grep -Eq '(\*|0\.0\.0\.0|\[::\]):11434' <<<"$listener"; then
  echo "Refusing to install: Ollama must bind only to loopback, not all interfaces." >&2
  exit 1
fi
if ! grep -Eq '(127\.0\.0\.1|\[::1\]):11434' <<<"$listener"; then
  echo "Refusing to install: no loopback-only Ollama listener was found." >&2
  exit 1
fi
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:11434/api/version >/dev/null

printf 'Paste the token for the dedicated Rallyroo Ollama tunnel: '
IFS= read -rs tunnel_token
printf '\n'
if [[ -z "$tunnel_token" ]]; then
  echo "Tunnel token is required." >&2
  exit 1
fi

mkdir -p "$STATE_DIR" "$LOG_DIR" "$(dirname "$PLIST")"
chmod 700 "$STATE_DIR"
umask 077
printf '%s' "$tunnel_token" >"$TOKEN_FILE"
unset tunnel_token
chmod 600 "$TOKEN_FILE"

python3 - "$PLIST" "$LABEL" "$CLOUDFLARED" "$TOKEN_FILE" "$LOG_DIR" <<'PY'
import plistlib
import sys

path, label, cloudflared, token_file, log_dir = sys.argv[1:]
plist = {
    "Label": label,
    "ProgramArguments": [
        cloudflared,
        "tunnel",
        "--no-autoupdate",
        "--loglevel",
        "info",
        "run",
        "--token-file",
        token_file,
    ],
    "RunAtLoad": True,
    "KeepAlive": {"SuccessfulExit": False},
    "ThrottleInterval": 10,
    "StandardOutPath": f"{log_dir}/ollama-tunnel.out.log",
    "StandardErrorPath": f"{log_dir}/ollama-tunnel.err.log",
}
with open(path, "wb") as output:
    plistlib.dump(plist, output)
PY
chmod 600 "$PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

for _ in {1..20}; do
  if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q 'state = running'; then
    break
  fi
  sleep 1
done
if ! launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q 'state = running'; then
  echo "Tunnel did not start; inspect $LOG_DIR/ollama-tunnel.err.log" >&2
  exit 1
fi

status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "https://$HOSTNAME/api/chat" || true)
case "$status" in
  401|403)
    ;;
  000)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    echo "The endpoint could not be resolved or reached (HTTP 000); the tunnel was stopped." >&2
    echo "Confirm the published route created public DNS, then retry after local DNS caches expire." >&2
    exit 1
    ;;
  *)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    echo "The endpoint returned HTTP $status, not 401/403; the tunnel was stopped." >&2
    echo "Correct the Cloudflare Access policy before trying again." >&2
    exit 1
    ;;
esac

for path in / /api/tags /api/pull; do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "https://$HOSTNAME$path" || true)
  if [[ "$status" != 404 ]]; then
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    echo "The excluded path $path returned HTTP ${status:-000}, not 404; the tunnel was stopped." >&2
    echo "Scope the Access application to /api/chat and retain the tunnel's final http_status:404 rule." >&2
    exit 1
  fi
done

echo "Secure Ollama tunnel is running. Anonymous /api/chat is denied (HTTP 401/403), and excluded paths return 404."
