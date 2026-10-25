#!/usr/bin/env bash
# Root-only installation from a reviewed repository bundle. Does not rerun VM startup.
set -Eeuo pipefail
[[ ${EUID} -eq 0 && $# -eq 1 ]] || { echo 'Requires root and a staged repository bundle' >&2; exit 1; }
for tool in kubectl gcloud python3 systemctl; do command -v "$tool" >/dev/null; done
[[ -r /etc/rallyroo/environment && -x /opt/rallyroo/backups/run-backup.sh ]] || exit 1
for service in rallyroo-backup.service rallyroo-backup-verify.service; do
  if systemctl is-active --quiet "$service"; then echo 'Backup/restore is active; retry later' >&2; exit 1; fi
done
stage=$(mktemp -d /tmp/rallyroo-backup-monitor.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT
tar -xzf "$1" -C "$stage" --no-same-owner
python3 - "$stage" <<'PY'
from pathlib import Path
import ast, sys
ast.parse((Path(sys.argv[1]) / 'backup-monitor/monitor.py').read_text())
PY
install -d -m 0700 /opt/rallyroo/backup-monitor
install -m 0700 "$stage/backup-monitor/monitor.py" /opt/rallyroo/backup-monitor/monitor.py
for unit in rallyroo-backup.service rallyroo-backup-verify.service; do
  install -m 0644 "$stage/backup/$unit" "/etc/systemd/system/$unit"
done
for unit in rallyroo-backup-monitor.service rallyroo-backup-monitor.timer; do
  install -m 0644 "$stage/backup-monitor/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
# Success stamps are created only after verified jobs actually succeed.
systemctl start rallyroo-backup.service
systemctl start rallyroo-backup-verify.service
systemctl start rallyroo-backup-monitor.service
systemctl enable --now rallyroo-backup-monitor.timer >/dev/null
echo 'Backup monitor installed; end-to-end test receipt and off-host drill still require verification.'
