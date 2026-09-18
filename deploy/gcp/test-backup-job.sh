#!/usr/bin/env bash
# Verifies that the embedded backup job scripts are syntactically valid
# and that they will run on the GCP VM.
set -Eeuo pipefail

STARTUP="$(cd "$(dirname "$0")" && pwd)/startup.sh"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Extract the run-backup.sh heredoc
awk '/^cat >\/opt\/rallyroo\/backups\/run-backup.sh <<.RUNBACKUP.$/{grab=1; next}/^RUNBACKUP$/{if(grab)exit}grab{print}' \
   "$STARTUP" > "$TMPDIR/run-backup.sh"

# Extract the verify-restore.sh heredoc
awk '/^cat >\/opt\/rallyroo\/backups\/verify-restore.sh <<.VERIFYEOF.$/{grab=1; next}/^VERIFYEOF$/{if(grab)exit}grab{print}' \
   "$STARTUP" > "$TMPDIR/verify-restore.sh"

# Syntax check
if [[ -s "$TMPDIR/run-backup.sh" ]]; then
    bash -n "$TMPDIR/run-backup.sh" && echo "run-backup.sh syntax: OK"
else
    echo "ERROR: failed to extract run-backup.sh from startup.sh" >&2
    exit 1
fi

if [[ -s "$TMPDIR/verify-restore.sh" ]]; then
     bash -n "$TMPDIR/verify-restore.sh" && echo "verify-restore.sh syntax: OK"
else
    echo "ERROR: failed to extract verify-restore.sh from startup.sh" >&2
     exit 1
fi

echo "All backup job scripts pass syntax check."
