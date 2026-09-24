#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
for file in startup.sh backup/*.sh; do bash -n "$file"; done
# Terraform metadata and first-boot installation must use the same tested files.
for file in run-backup.sh verify-restore.sh; do
  grep -Fq "backup/$file" main.tf
  grep -Fq "metadata rallyroo-backup-${file%.sh}-script" startup.sh ||
    [[ "$file" == verify-restore.sh ]] && grep -Fq 'metadata rallyroo-backup-verify-script' startup.sh
 done
for unit in backup/*.service backup/*.timer; do
  grep -Fq "backup/$(basename "$unit")" main.tf
done
grep -Fq 'OnCalendar=*-*-* 04:00:00 UTC' backup/rallyroo-backup.timer
grep -Fq 'OnCalendar=*-*-01 06:00:00 UTC' backup/rallyroo-backup-verify.timer

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin" "$scratch/mount" "$scratch/storage/dumps" "$scratch/storage/preupgrade"
printf 'RALLYROO_BACKUP_BUCKET=test-bucket\n' >"$scratch/environment"
# Swap only root-owned production paths for isolated test fixtures.
python3 - "$scratch" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
for name in ('run-backup.sh', 'verify-restore.sh'):
    text = (Path('backup') / name).read_text()
    for before, after in (
        ('/etc/rallyroo/environment', str(root / 'environment')),
        ('/run/lock/rallyroo-backup.lock', str(root / 'lock')),
        ('/var/local/rallyroo/', str(root / 'mount') + '/'),
    ):
        text = text.replace(before, after)
    text = text.replace('cat /proc/sys/kernel/random/uuid',
                        "python3 -c 'import uuid; print(uuid.uuid4())'")
    (root / name).write_text(text)
PY
printf '#!/usr/bin/env bash\nexit 0\n' >"$scratch/bin/flock"
cat >"$scratch/bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' get pod '*) printf 'postgres-test';;
  *' pg_dump '*) [[ "${FAIL_DUMP:-}" != 1 ]] || exit 1; printf 'PGDMPtest-archive';;
  *' pg_restore --list '*) grep -aq '^PGDMP' || exit 1;;
  *' createdb '*) printf 'createdb\n' >>"$MOCK_CALLS";;
  *' pg_restore --exit-on-error '*) [[ "${FAIL_RESTORE:-}" != 1 ]] || exit 1; grep -aq '^PGDMP' || exit 1; printf 'restored\n' >>"$MOCK_CALLS";;
  *' psql '*) printf '2\n';;
  *' dropdb '*) printf 'dropdb\n' >>"$MOCK_CALLS";;
  *) exit 1;;
esac
MOCK
cat >"$scratch/bin/gcloud" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1 $2" == 'storage cp' || "$1 $2" == 'storage ls' || "$1 $2" == 'storage rm' ]] || exit 1
case "$2" in
  cp)
    src="$3" dst="$4"
    if [[ "$src" == gs://* ]]; then
      [[ "${FAIL_DOWNLOAD:-}" != 1 ]] || exit 1
      src="$MOCK_STORAGE/${src#gs://test-bucket/}"
    fi
    if [[ "$dst" == gs://* ]]; then
      [[ "${FAIL_UPLOAD:-}" != 1 ]] || exit 1
      dst="$MOCK_STORAGE/${dst#gs://test-bucket/}"
      mkdir -p "$(dirname "$dst")"
    fi
    cp "$src" "$dst";;
  ls)
    [[ "${FAIL_LIST:-}" != 1 ]] || exit 1
    python3 - "$MOCK_STORAGE" <<'PY'
from datetime import datetime, timezone
from pathlib import Path
import sys
root = Path(sys.argv[1])
for path in sorted(root.rglob('*')):
    if path.is_file():
        when = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace('+00:00', 'Z')
        print(f'{path.stat().st_size}  {when}  gs://test-bucket/{path.relative_to(root)}')
PY
    ;;
  rm)
    path="$MOCK_STORAGE/${3#gs://test-bucket/}"
    rm -f "$path";;
esac
MOCK
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH" MOCK_STORAGE="$scratch/storage" MOCK_CALLS="$scratch/calls"
# An older one-off backup outside dumps/ is counted in the same live-object cap.
printf 'PGDMPone' >"$scratch/storage/dumps/oldest.dump"
printf 'PGDMPtwo' >"$scratch/storage/preupgrade/one-off.dump"
printf 'PGDMPthree' >"$scratch/storage/dumps/newer.dump"
python3 - "$scratch/storage" <<'PY'
from pathlib import Path
import os, sys
root = Path(sys.argv[1])
for name, timestamp in [('dumps/oldest.dump', 1000000000), ('preupgrade/one-off.dump', 1100000000), ('dumps/newer.dump', 1200000000)]:
    os.utime(root / name, (timestamp, timestamp))
PY
bash "$scratch/run-backup.sh" >/dev/null
[[ $(find "$scratch/storage" -type f | wc -l | tr -d ' ') == 3 ]]
[[ ! -f "$scratch/storage/dumps/oldest.dump" ]]
[[ -f "$scratch/storage/preupgrade/one-off.dump" ]]
bash "$scratch/verify-restore.sh" >/dev/null
[[ "$(grep -c '^createdb$' "$scratch/calls")" == 1 ]]
[[ "$(grep -c '^restored$' "$scratch/calls")" == 1 ]]
[[ "$(grep -c '^dropdb$' "$scratch/calls")" == 1 ]]
bash "$scratch/run-backup.sh" >/dev/null
[[ $(find "$scratch/storage" -type f | wc -l | tr -d ' ') == 3 ]]
[[ ! -f "$scratch/storage/preupgrade/one-off.dump" ]]
for failure in FAIL_DUMP FAIL_UPLOAD FAIL_DOWNLOAD FAIL_LIST; do
  count_before=$(find "$scratch/storage" -type f | wc -l | tr -d ' ')
  if env "$failure=1" bash "$scratch/run-backup.sh" >/dev/null 2>&1; then
    echo "Expected backup failure: $failure" >&2; exit 1
  fi
  [[ $(find "$scratch/storage" -type f | wc -l | tr -d ' ') == "$count_before" ]]
done
printf 'unrelated' >"$scratch/storage/unexpected.txt"
if bash "$scratch/run-backup.sh" >/dev/null 2>&1; then
  echo 'Expected unknown-object failure before pruning' >&2; exit 1
fi
[[ $(find "$scratch/storage" -type f | wc -l | tr -d ' ') == 4 ]]
rm "$scratch/storage/unexpected.txt"
if env FAIL_RESTORE=1 bash "$scratch/verify-restore.sh" >/dev/null 2>&1; then
  echo 'Expected restore failure' >&2; exit 1
fi
[[ "$(grep -c '^dropdb$' "$scratch/calls")" == 2 ]]
echo 'Backup job: daily timer, retention, failed-upload safety and isolated restore checks passed.'
