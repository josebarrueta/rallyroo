#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
source /etc/rallyroo/environment
: "${RALLYROO_BACKUP_BUCKET:?backup bucket is not configured}"

# Only one backup/restore may use the production database at a time.
exec 9>/run/lock/rallyroo-backup.lock
flock -n 9 || { echo 'backup: another backup or restore is running' >&2; exit 1; }

work=$(mktemp -d /var/local/rallyroo/.backup.XXXXXXXX)
uploaded=''
cleanup() {
  local status=$?
  if [[ -n "$uploaded" ]]; then
    gcloud storage rm "$uploaded" >/dev/null 2>&1 || {
      echo 'backup: could not remove unverified upload' >&2
      status=1
    }
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
archive="$work/backup.dump"
bucket_root="gs://${RALLYROO_BACKUP_BUCKET}/"
prefix="${bucket_root}dumps/"
name="rallyroo-$(date -u +%Y%m%dT%H%M%SZ)-$(cat /proc/sys/kernel/random/uuid).dump"
pod=$(kubectl -n rallyroo get pod -l app.kubernetes.io/component=postgres \
  -o jsonpath='{.items[0].metadata.name}' 2>/dev/null) || { echo 'backup: postgres unavailable' >&2; exit 1; }
[[ -n "$pod" ]] || { echo 'backup: postgres unavailable' >&2; exit 1; }

# The password never leaves the container or appears in kubectl arguments.
kubectl -n rallyroo exec "$pod" -c postgres -- sh -ec \
  'PGPASSWORD="$(cat /run/secrets/postgres/password)"; export PGPASSWORD; exec pg_dump -U rallyroo -d rallyroo -Fc -Z 6' \
  >"$archive" 2>/dev/null || { echo 'backup: pg_dump failed' >&2; exit 1; }
[[ -s "$archive" ]] || { echo 'backup: empty archive' >&2; exit 1; }
# Confirm the local custom archive is readable before uploading.
kubectl -n rallyroo exec -i "$pod" -c postgres -- pg_restore --list \
  <"$archive" >/dev/null 2>&1 || { echo 'backup: invalid archive' >&2; exit 1; }

uploaded="${prefix}${name}"
gcloud storage cp "$archive" "$uploaded" >/dev/null 2>&1 || {
  echo 'backup: upload failed (older backups untouched)' >&2; exit 1;
}
gcloud storage cp "${prefix}${name}" "$work/download.dump" >/dev/null 2>&1 || {
  echo 'backup: download failed (older backups untouched)' >&2; exit 1;
}
cmp -s "$archive" "$work/download.dump" || {
  echo 'backup: GCS copy does not match (older backups untouched)' >&2; exit 1;
}

# List all live objects in this dedicated backup bucket, including one-off
# pre-upgrade backups outside dumps/. Noncurrent generations remain in GCS.
gcloud storage ls --long "${bucket_root}**" >"$work/list" 2>/dev/null || {
  echo 'backup: listing failed (older backups untouched)' >&2; exit 1;
}
python3 - "$bucket_root" "${prefix}${name}" "$work/list" >"$work/remove" <<'PY'
import datetime
import pathlib
import sys

prefix, uploaded, path = sys.argv[1:]
objects = []
for line in pathlib.Path(path).read_text().splitlines():
    if not line.strip() or line.strip().startswith('TOTAL:'):
        continue
    fields = line.split()
    if (len(fields) != 3 or not fields[0].isdigit()
            or not fields[2].startswith(prefix)
            or not fields[2].endswith(('.dump', '.sql.gz', '.backup'))):
        sys.exit('backup: unknown object in backup bucket (older backups untouched)')
    try:
        timestamp = datetime.datetime.fromisoformat(fields[1].replace('Z', '+00:00'))
    except ValueError:
        sys.exit('backup: unexpected GCS timestamp (older backups untouched)')
    objects.append((timestamp, fields[2]))
if not any(url == uploaded for _, url in objects):
    sys.exit('backup: uploaded object missing from listing (older backups untouched)')
objects.sort(reverse=True)
if uploaded not in [url for _, url in objects[:3]]:
    sys.exit('backup: uploaded object not among newest three (older backups untouched)')
for _, url in objects[3:]:
    print(url)
PY
# Never delete unless the entire listing was parsed and the new copy verified.
# Pruning may partially succeed; retain the verified newest backup if a later
# deletion fails, then fail the service so an operator can reconcile the count.
uploaded=''
removed=0
while IFS= read -r old; do
  [[ -n "$old" ]] || continue
  gcloud storage rm "$old" >/dev/null 2>&1 || {
    echo 'backup: pruning failed; retry required' >&2; exit 1;
  }
  ((removed += 1))
done <"$work/remove"
echo "backup: verified upload; pruned ${removed} older live backups"
