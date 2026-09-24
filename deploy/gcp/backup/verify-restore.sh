#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
source /etc/rallyroo/environment
: "${RALLYROO_BACKUP_BUCKET:?backup bucket is not configured}"
exec 9>/run/lock/rallyroo-backup.lock
flock -n 9 || { echo 'verify: another backup or restore is running' >&2; exit 1; }

work=$(mktemp -d /var/local/rallyroo/.backup-verify.XXXXXXXX)
pod=''
database="rallyroo_backup_verify_$$"
created=0
cleanup() {
  local status=$?
  if (( created )); then
    kubectl -n rallyroo exec "$pod" -c postgres -- sh -ec \
      'PGPASSWORD="$(cat /run/secrets/postgres/password)"; export PGPASSWORD; exec dropdb -U rallyroo --if-exists "$1"' \
      sh "$database" >/dev/null 2>&1 || { echo 'verify: could not drop isolated database' >&2; status=1; }
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
prefix="gs://${RALLYROO_BACKUP_BUCKET}/"
gcloud storage ls --long "${prefix}**" >"$work/list" 2>/dev/null || {
  echo 'verify: listing failed' >&2; exit 1;
}
latest=$(python3 - "$prefix" "$work/list" <<'PY'
import datetime
import pathlib
import sys

prefix, path = sys.argv[1:]
objects = []
for line in pathlib.Path(path).read_text().splitlines():
    if not line.strip() or line.strip().startswith('TOTAL:'):
        continue
    fields = line.split()
    if (len(fields) != 3 or not fields[0].isdigit()
            or not fields[2].startswith(prefix)
            or not fields[2].endswith(('.dump', '.sql.gz', '.backup'))):
        sys.exit('verify: unknown object in backup bucket')
    try:
        timestamp = datetime.datetime.fromisoformat(fields[1].replace('Z', '+00:00'))
    except ValueError:
        sys.exit('verify: unexpected GCS timestamp')
    objects.append((timestamp, fields[2]))
if not objects:
    sys.exit('verify: no backup found')
print(max(objects)[1])
PY
)
gcloud storage cp "$latest" "$work/restore.dump" >/dev/null 2>&1 || {
  echo 'verify: download failed' >&2; exit 1;
}
[[ -s "$work/restore.dump" ]] || { echo 'verify: empty archive' >&2; exit 1; }
pod=$(kubectl -n rallyroo get pod -l app.kubernetes.io/component=postgres \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null) || { echo 'verify: postgres unavailable' >&2; exit 1; }
[[ -n "$pod" ]] || { echo 'verify: postgres unavailable' >&2; exit 1; }
# Create and restore into an isolated database on the same PostgreSQL server.
kubectl -n rallyroo exec "$pod" -c postgres -- sh -ec \
  'PGPASSWORD="$(cat /run/secrets/postgres/password)"; export PGPASSWORD; exec createdb -U rallyroo -T template0 "$1"' \
  sh "$database" >/dev/null 2>&1 || { echo 'verify: could not create isolated database' >&2; exit 1; }
created=1
kubectl -n rallyroo exec -i "$pod" -c postgres -- sh -ec \
  'PGPASSWORD="$(cat /run/secrets/postgres/password)"; export PGPASSWORD; exec pg_restore --exit-on-error --no-owner --no-privileges -U rallyroo -d "$1"' \
  sh "$database" <"$work/restore.dump" >/dev/null 2>&1 || {
  echo 'verify: restore failed' >&2; exit 1;
}
# The production database always has application tables; an empty restore is not useful.
count=$(kubectl -n rallyroo exec "$pod" -c postgres -- sh -ec \
  'PGPASSWORD="$(cat /run/secrets/postgres/password)"; export PGPASSWORD; exec psql -U rallyroo -d "$1" -Atqc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = '\''public'\''"' \
  sh "$database" 2>/dev/null) || { echo 'verify: restored database query failed' >&2; exit 1; }
[[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )) || { echo 'verify: restored database has no tables' >&2; exit 1; }
echo 'verify: isolated database restore succeeded'
