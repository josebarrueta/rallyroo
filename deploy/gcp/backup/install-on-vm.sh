#!/usr/bin/env bash
# Invoked by install-backups.sh on the VM as root; never reruns startup.sh.
set -Eeuo pipefail
[[ ${EUID} -eq 0 && $# -eq 1 ]] || { echo 'Install requires sudo and a staged bundle' >&2; exit 1; }
for tool in kubectl gcloud python3 flock systemctl; do
  command -v "$tool" >/dev/null || { echo "Missing host tool: $tool" >&2; exit 1; }
done
[[ -r /etc/rallyroo/environment ]] || { echo 'Backup environment missing' >&2; exit 1; }
mountpoint -q /var/local/rallyroo || { echo 'Data disk not mounted' >&2; exit 1; }
[[ -n "$(kubectl -n rallyroo get pod -l app.kubernetes.io/component=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)" ]] || {
  echo 'PostgreSQL pod not found' >&2; exit 1;
}
for service in rallyroo-backup.service rallyroo-backup-verify.service; do
  if systemctl is-active --quiet "$service"; then
    echo 'A backup or restore is in progress; retry later' >&2; exit 1
  fi
done
stage=$(mktemp -d /tmp/rallyroo-backups.XXXXXXXX)
trap 'rm -rf "$stage" "$1"' EXIT
tar -xzf "$1" -C "$stage" --no-same-owner
for script in run-backup.sh verify-restore.sh; do
  bash -n "$stage/backup/$script"
done
install -d -m 0700 /opt/rallyroo/backups
for script in run-backup.sh verify-restore.sh; do
  install -m 0700 "$stage/backup/$script" "/opt/rallyroo/backups/$script"
done
for unit in rallyroo-backup.service rallyroo-backup.timer \
            rallyroo-backup-verify.service rallyroo-backup-verify.timer; do
  install -m 0644 "$stage/backup/$unit" "/etc/systemd/system/$unit"
done
systemctl stop rallyroo-backup.timer rallyroo-backup-verify.timer 2>/dev/null || true
systemctl daemon-reload
# Start explicitly so we know an upload and a real isolated restore both work
# before enabling recurring timers or discarding any verified older backup.
systemctl start rallyroo-backup.service
systemctl start rallyroo-backup-verify.service
systemctl enable --now rallyroo-backup.timer rallyroo-backup-verify.timer >/dev/null
echo 'Backup and isolated restore succeeded; daily and monthly timers enabled.'
