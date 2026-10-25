#!/usr/bin/env python3
"""Root-owned, privacy-safe backup monitor; uses the existing signed alert channel."""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

STATE = Path("/var/lib/rallyroo-backup")


def command(args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          text=True, timeout=60).stdout


def inventory(listing, bucket, now):
    dates = []
    for line in listing.splitlines():
        if not line.strip() or line.strip().startswith("TOTAL:"):
            continue
        fields = line.split()
        if (len(fields) != 3 or not fields[0].isdigit() or int(fields[0]) < 1
                or not fields[2].startswith(f"gs://{bucket}/")
                or not fields[2].endswith((".dump", ".backup", ".sql.gz"))):
            raise ValueError("unexpected inventory")
        date = dt.datetime.fromisoformat(fields[1].replace("Z", "+00:00"))
        if date.tzinfo is None or date.timestamp() > now + 300:
            raise ValueError("invalid inventory timestamp")
        dates.append(date.timestamp())
    problems = []
    if not dates or now - max(dates) > 36 * 3600:
        problems.append("upload_overdue")
    if len(dates) > 3:
        problems.append("excess_live_objects")
    return problems


def status_problems(unit_results, stamps, now):
    problems = []
    for name, threshold in (("backup", 36 * 3600), ("verify", 40 * 86400)):
        if unit_results.get(name) != "success":
            problems.append(f"{name}_service_failed")
        stamp = stamps.get(name)
        if stamp is None or stamp > now + 300 or now - stamp > threshold:
            problems.append(f"{name}_verification_overdue")
    return problems


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send_alert(problems, path="/backup"):
    # Secrets exist only in root-owned Kubernetes/1Password boundaries and memory.
    secret = json.loads(command(["kubectl", "-n", "rallyroo", "get", "secret",
                                 "rallyroo-deployment-alert-webhook", "-o", "json"]))["data"]
    address = base64.b64decode(secret["address"], validate=True).decode()
    token = base64.b64decode(secret["token"], validate=True)
    url = urllib.parse.urlparse(address)
    if (url.scheme != "https" or url.hostname != "alerts.rallyroo.dev" or url.port not in (None, 443)
            or url.path != "/flux" or url.query or url.fragment or url.username or url.password or not token):
        raise ValueError("unexpected alert configuration")
    body = json.dumps({"problems": sorted(set(problems)), "timestamp": dt.datetime.now(dt.timezone.utc).isoformat()},
                      separators=(",", ":")).encode()
    request = urllib.request.Request(urllib.parse.urlunparse(url._replace(path=path)), data=body,
        headers={"Content-Type": "application/json", "X-Signature": "sha256=" + hmac.new(token, body, hashlib.sha256).hexdigest()},
        method="POST")
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        if response.status != 202:
            raise ValueError("alert not accepted")


def notify(problems, state_path, now, send=send_alert):
    if not problems:
        state_path.unlink(missing_ok=True)
        return
    fingerprint = hashlib.sha256("\n".join(sorted(set(problems))).encode()).hexdigest()
    try:
        previous = json.loads(state_path.read_text())
    except (OSError, ValueError):
        previous = {}
    if previous.get("fingerprint") == fingerprint and 0 <= now - previous.get("sentAt", 0) < 6 * 3600:
        return
    send(problems)  # Never suppress a retry when delivery failed.
    temporary = state_path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"fingerprint": fingerprint, "sentAt": now}))
    temporary.replace(state_path)


def main():
    os.umask(0o077)
    if sys.argv[1:] == ["--test-alert"]:
        try:
            send_alert(["monitor_test"])
        except Exception:
            print("backup monitor: test delivery failed", file=sys.stderr)
            return 1
        print("backup monitor: test accepted; operator must confirm receipt")
        return 0
    if sys.argv[1:]:
        sys.exit("backup monitor: unsupported arguments")
    bucket = os.environ.get("RALLYROO_BACKUP_BUCKET", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", bucket):
        sys.exit("backup monitor: missing bucket configuration")
    now = time.time()
    problems = []
    try:
        problems += inventory(command(["gcloud", "storage", "ls", "--long", f"gs://{bucket}/**"]), bucket, now)
    except (OSError, ValueError, subprocess.SubprocessError):
        problems.append("inventory_unavailable")
    results, stamps = {}, {}
    for name, unit, stamp in (("backup", "rallyroo-backup.service", "backup-ok"),
                              ("verify", "rallyroo-backup-verify.service", "verify-ok")):
        try:
            results[name] = command(["systemctl", "show", unit, "--property=Result", "--value"]).strip()
        except (OSError, subprocess.SubprocessError):
            results[name] = "unknown"
        try:
            stamps[name] = (STATE / stamp).stat().st_mtime
        except OSError:
            stamps[name] = None
    problems += status_problems(results, stamps, now)
    try:
        STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
        notify(problems, STATE / "last-alert.json", now)
        # Independent Cloudflare alarm detects VM/timer/monitor disappearance.
        send_alert([], path="/backup-heartbeat")
    except Exception:
        # Do not expose raw HTTP/tool errors, credentials, endpoints, or archive names.
        print("backup monitor: alert delivery failed; retry required", file=sys.stderr)
        return 1
    print("backup monitor: attention required" if problems else "backup monitor: healthy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
