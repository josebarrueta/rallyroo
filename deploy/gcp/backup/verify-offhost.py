#!/usr/bin/env python3
"""Operator-only off-host restore drill. No production DB connection or kubeconfig.

Uses the operator's existing read-only GCS access and a disposable network-isolated
PostgreSQL 17 container. Never logs archive names, data, credentials or tool output.
"""
import datetime as dt
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid


def run(args, *, capture=False, timeout=300):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, text=capture, timeout=timeout)


def latest_archive(listing, bucket):
    objects = []
    for line in listing.splitlines():
        if not line.strip() or line.strip().startswith("TOTAL:"):
            continue
        fields = line.split()
        if len(fields) != 3 or not fields[0].isdigit() or not fields[2].startswith(f"gs://{bucket}/"):
            raise ValueError("unexpected backup inventory")
        if not fields[2].endswith((".dump", ".backup", ".sql.gz")):
            raise ValueError("unexpected backup inventory")
        when = dt.datetime.fromisoformat(fields[1].replace("Z", "+00:00"))
        if when.tzinfo is None or int(fields[0]) <= 0:
            raise ValueError("invalid backup metadata")
        objects.append((when, fields[2]))
    if not objects:
        raise ValueError("no backups")
    when, url = max(objects)
    age = (dt.datetime.now(dt.timezone.utc) - when).total_seconds()
    if age < -300 or age > 36 * 3600 or not url.endswith((".dump", ".backup")):
        raise ValueError("latest backup is stale or not a custom archive")
    return url


def main():
    bucket = os.environ.get("RALLYROO_BACKUP_BUCKET", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]", bucket):
        sys.exit("off-host verify: configure the dedicated backup bucket")
    container = "rallyroo-offhost-verify-" + uuid.uuid4().hex
    started = time.monotonic()
    stage = "container runtime preflight"
    old_umask = os.umask(0o077)
    try:
        run(["docker", "info"], timeout=30)
        stage = "inventory"
        listing = run(["gcloud", "storage", "ls", "--long", f"gs://{bucket}/**"], capture=True).stdout
        archive = latest_archive(listing, bucket)
        with tempfile.TemporaryDirectory(prefix="rallyroo-offhost-") as directory:
            path = Path(directory) / "restore.dump"
            stage = "download"
            run(["gcloud", "storage", "cp", archive, str(path)])
            if not path.stat().st_size:
                raise ValueError("empty archive")
            stage = "isolated container startup"
            run(["docker", "run", "--detach", "--rm", "--name", container, "--network", "none",
                 "--memory", "1g", "--cpus", "2", "--pids-limit", "128",
                 "--tmpfs", "/var/lib/postgresql/data:rw,size=1g",
                 "--mount", f"type=bind,source={directory},target=/backup,readonly",
                 "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"], timeout=180)
            for attempt in range(60):
                try:
                    run(["docker", "exec", container, "pg_isready", "-U", "postgres"], timeout=10)
                    break
                except subprocess.CalledProcessError:
                    time.sleep(1)
            else:
                raise RuntimeError("isolated PostgreSQL not ready")
            stage = "restore"
            run(["docker", "exec", container, "createdb", "-U", "postgres", "-T", "template0", "rallyroo_drill"])
            run(["docker", "exec", container, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
                 "-U", "postgres", "-d", "rallyroo_drill", "/backup/restore.dump"])
            stage = "query verification"
            # Query only table existence/counts, never Family rows or encrypted keys.
            count = run(["docker", "exec", container, "psql", "-U", "postgres", "-d", "rallyroo_drill", "-Atqc",
                         "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'"], capture=True).stdout.strip()
            if not count.isdigit() or int(count) < 1:
                raise ValueError("restored schema missing")
            run(["docker", "exec", container, "psql", "-U", "postgres", "-d", "rallyroo_drill", "-Atqc",
                 "SELECT count(*) FROM schema_migrations"], capture=True)
            stage = "cleanup"
            run(["docker", "rm", "--force", container], timeout=30)
        print(f"off-host verify: restore and schema queries succeeded; elapsed_seconds={int(time.monotonic() - started)}")
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        # Suppress raw subprocess exceptions: their arguments can contain archive paths.
        print(f"off-host verify: failed during {stage}; no production data was modified", file=sys.stderr)
        return 1
    finally:
        try:
            run(["docker", "rm", "--force", container], timeout=30)
        except (OSError, subprocess.SubprocessError):
            pass
        os.umask(old_umask)


if __name__ == "__main__":
    sys.exit(main())
