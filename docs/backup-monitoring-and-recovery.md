# Backup monitoring and off-host recovery (#146)

## What is implemented

`deploy/gcp/backup-monitor/monitor.py` checks, every 15 minutes on the production host:

- actual GCS backup upload age (alarm after 36 hours), live-object count (more than three), and invalid/unavailable inventory;
- failed backup/restore service state;
- persistent success stamps written **only after** the real verified backup/restore jobs succeed (36-hour backup, 40-day monthly restore bounds).

The monitor reads the existing root-accessible Kubernetes alert Secret at runtime, signs a bounded reason-code-only request to `https://alerts.rallyroo.dev/backup`, and follows no redirects. No credentials, archive names, Family data, raw journals or provider errors enter alert messages. The Worker authenticates HMAC, restricts reason codes and timestamp age, and reuses the already configured `deployment.failed` Resend Automation with an explicit `BackupMonitor/rallyroo` source and `rallyroo-backups` application. It does not fabricate a HelmRelease failure. No additional API key or recipient is introduced.

Healthy checks send no email. Every successful monitor run posts a signed, empty-status heartbeat to `/backup-heartbeat`. A Cloudflare-hosted `BackupMonitorState` Durable Object records receipt time and schedules an independent alarm. If no heartbeat arrives for over one hour, it sends `monitor_heartbeat_overdue` through the operator channel—even if the VM/timer has disappeared. Alarm checks run every 15 minutes, so detection is about 60–75 minutes after the last heartbeat, subject to platform/provider availability. A new heartbeat rearms detection for a new incident.

Identical failures are reminded at most every six hours; failed delivery does not advance suppression state and is retried. The durable alarm remains scheduled after delivery failure. A failed on-host check/delivery exits nonzero and does not refresh its heartbeat.

**Enrollment / acceptance:** the external alarm starts only after the first authenticated heartbeat has been accepted. A configured binding or successful dry-run is not proof of enrollment. Install and verify the Worker/Durable Object migration, one accepted live monitor heartbeat, operator test-message receipt, and an actual missing-heartbeat/recovery test before closing #146. Neither this monitor nor its external watchdog claims to survive an outage of the alert platform/provider itself.

## Operator installation (not an app release)

Installation requires an authorized IAP/OS Login session with 2FA. Do not disable that policy or export kubeconfig/credentials to hosted runners. Use reviewed source, not an untrusted artifact. The Worker `/backup` and `/backup-heartbeat` handlers and `backup-monitor-v1` Durable Object migration must be deployed and validated before accepting the monitor's end-to-end delivery. From the reviewed Worker directory, an authenticated operator can run `npm run deploy`; existing secrets remain in Cloudflare and are not exported. Wrangler creates the declared SQLite-backed Durable Object binding through the migration; no KV namespace ID or new provider secret is required.

Build a non-secret reviewed bundle from the repo:

```sh
tar -czf /tmp/rallyroo-backup-monitor.tgz -C deploy/gcp backup backup-monitor
```

An authorized operator transfers that bundle through the existing IAP route. On the VM, run:

```sh
sudo bash /path/to/reviewed/backup-monitor/install-on-vm.sh /tmp/rallyroo-backup-monitor.tgz
sudo /usr/bin/python3 /opt/rallyroo/backup-monitor/monitor.py --test-alert
sudo systemctl list-timers --all rallyroo-backup-monitor.timer
```

The installer updates only the two backup units and monitor files, runs one actual backup and same-host isolated restore to initialize success stamps, and enables the monitor. It does not rerun VM startup or apply Terraform. Existing backup scripts retain the at-most-three-live-objects pruning policy. Existing hosts need this explicit installation; these monitor units are not yet bootstrapped automatically on a replacement VM.

An accepted HTTP response proves provider acceptance, **not inbox delivery**. An operator must confirm receipt of the `BackupMonitorTest` message. Fault injection covers missing/stale uploads, failed backup/restore status, excessive count, failed delivery, missed heartbeats and recovery. A live watchdog test should pause **only the monitoring timer**, not backups, after enrollment, with a pre-arranged automatic restart and explicit operator approval; verify an overdue-heartbeat email and subsequent recovery. Do not damage a real backup or production service to reproduce those conditions.

## Independent off-host restore drill

Requirements: an operator machine separate from the production VM, Docker running, Python 3, and existing read-only GCS access. No production database credential or kubeconfig is needed.

```sh
RALLYROO_BACKUP_BUCKET=<dedicated-backup-bucket> \
  python3 deploy/gcp/backup/verify-offhost.py
```

The script validates inventory/freshness, downloads the latest custom archive into a private temporary directory, starts a disposable PostgreSQL 17 container with **no network or published ports**, restores into its own database, and queries application-schema/migration metadata. The database lives in bounded tmpfs. It removes the container and archive before reporting success. Raw data, paths and tool output are suppressed; failures name only the stage. The bounded 1 GiB data/memory settings intentionally fail rather than grow without bound; revisit them with measured production size when needed.

A real off-host run during this batch succeeded with restore/schema queries in **4 seconds**, followed by verification that no drill container remained. This measurement is one small-data drill, **not a guaranteed recovery time**. It proves database readability, not a fully rebuilt application, Family-key decryption, DNS/tunnel restoration or complete VM disaster recovery.

## RPO/RTO and closure evidence

The daily 04:00 UTC backup cadence normally limits database data loss to roughly 24 hours; missed jobs can increase it. The 36-hour freshness alarm is a detection bound plus the timer interval, not a stronger RPO. Monthly local restore checks use a 40-day overdue bound. No hard end-to-end RTO is promised; record a measured full-stack recovery separately.

Before closing #146, record non-sensitive evidence for installed timer/state, actual operator alert receipt, independent outage/missed-heartbeat detection, off-host restore/cleanup, and the known recovery limits. Keep archives, credentials and raw journals out of issues and CI.
