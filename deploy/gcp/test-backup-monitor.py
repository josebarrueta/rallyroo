#!/usr/bin/env python3
import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from contextlib import redirect_stderr, nullcontext
import io
import subprocess
import json
import base64

ROOT = Path(__file__).parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


monitor = module('monitor', 'backup-monitor/monitor.py')
offhost = module('offhost', 'backup/verify-offhost.py')


class BackupMonitorTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime.now(dt.timezone.utc).timestamp()
        self.timestamp = dt.datetime.fromtimestamp(self.now, dt.timezone.utc).isoformat()

    def listing(self, count=3, age=0):
        timestamp = dt.datetime.fromtimestamp(self.now - age, dt.timezone.utc).isoformat()
        return '\n'.join(f'123 {timestamp} gs://test-bucket/dumps/{i}.dump' for i in range(count))

    def test_routine_success_has_no_alert(self):
        self.assertEqual(monitor.inventory(self.listing(), 'test-bucket', self.now), [])
        self.assertEqual(monitor.status_problems({'backup': 'success', 'verify': 'success'},
                         {'backup': self.now, 'verify': self.now}, self.now), [])

    def test_overdue_upload_retention_and_failed_jobs_are_detected(self):
        self.assertIn('upload_overdue', monitor.inventory(self.listing(age=37 * 3600), 'test-bucket', self.now))
        self.assertIn('excess_live_objects', monitor.inventory(self.listing(count=4), 'test-bucket', self.now))
        self.assertIn('upload_overdue', monitor.inventory('', 'test-bucket', self.now))
        problems = monitor.status_problems({'backup': 'exit-code', 'verify': 'exit-code'}, {}, self.now)
        self.assertEqual(set(problems), {'backup_service_failed', 'verify_service_failed',
                                        'backup_verification_overdue', 'verify_verification_overdue'})
        with self.assertRaises(ValueError):
            monitor.inventory('123 invalid gs://other-bucket/private.dump', 'test-bucket', self.now)

    def test_failed_delivery_is_retried_and_success_is_rate_limited(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'alert.json'
            def fail(_):
                raise RuntimeError('provider unavailable')
            with self.assertRaises(RuntimeError):
                monitor.notify(['upload_overdue'], state, self.now, send=fail)
            self.assertFalse(state.exists())
            calls = []
            monitor.notify(['upload_overdue'], state, self.now, send=calls.append)
            monitor.notify(['upload_overdue'], state, self.now + 1, send=calls.append)
            self.assertEqual(len(calls), 1)
            monitor.notify(['upload_overdue'], state, self.now + 7 * 3600, send=calls.append)
            self.assertEqual(len(calls), 2)
            monitor.notify([], state, self.now + 8 * 3600, send=calls.append)
            self.assertFalse(state.exists())

    def test_offhost_rejects_stale_unknown_empty_and_wrong_bucket_archives(self):
        self.assertTrue(offhost.latest_archive(self.listing(), 'test-bucket').startswith('gs://test-bucket/'))
        for listing in ['', self.listing(age=37 * 3600), '1 bad gs://other/x.dump',
                        f'1 {self.timestamp} gs://test-bucket/private.txt']:
            with self.assertRaises(ValueError):
                offhost.latest_archive(listing, 'test-bucket')

    def test_heartbeat_transport_contains_no_secret_and_rejects_other_destinations(self):
        def secret(address):
            return json.dumps({'data': {
                'address': base64.b64encode(address.encode()).decode(),
                'token': base64.b64encode(b'fixture-token').decode(),
            }})
        for address in ['http://alerts.rallyroo.dev/flux', 'https://other.example/flux',
                        'https://alerts.rallyroo.dev/flux?token=private']:
            with patch.object(monitor, 'command', return_value=secret(address)):
                with self.assertRaises(ValueError):
                    monitor.send_alert([], path='/backup-heartbeat')
        requests = []
        def send(request, **_):
            requests.append(request)
            return nullcontext(SimpleNamespace(status=202))
        with patch.object(monitor, 'command', return_value=secret('https://alerts.rallyroo.dev/flux')):
            with patch.object(monitor.urllib.request, 'build_opener', return_value=SimpleNamespace(open=send)):
                monitor.send_alert([], path='/backup-heartbeat')
        request = requests[0]
        self.assertEqual(request.full_url, 'https://alerts.rallyroo.dev/backup-heartbeat')
        self.assertEqual(json.loads(request.data)['problems'], [])
        self.assertNotIn(b'fixture-token', request.data)
        self.assertTrue(request.get_header('X-signature').startswith('sha256='))

    def test_offhost_uses_isolated_container_and_cleans_up_on_restore_failure(self):
        calls = []
        def run(args, **_):
            calls.append(args)
            if args[:3] == ['gcloud', 'storage', 'ls']:
                return SimpleNamespace(stdout=self.listing())
            if args[:3] == ['gcloud', 'storage', 'cp']:
                Path(args[-1]).write_bytes(b'PGDMPfixture')
            if 'pg_restore' in args:
                raise subprocess.CalledProcessError(1, args)
            return SimpleNamespace(stdout='1')
        errors = io.StringIO()
        with patch.dict('os.environ', {'RALLYROO_BACKUP_BUCKET': 'test-bucket'}), patch.object(offhost, 'run', run):
            with redirect_stderr(errors):
                self.assertEqual(offhost.main(), 1)
        docker_run = next(args for args in calls if args[:2] == ['docker', 'run'])
        self.assertEqual(docker_run[docker_run.index('--network') + 1], 'none')
        self.assertIn('--tmpfs', docker_run)
        self.assertNotIn('--publish', docker_run)
        self.assertTrue(any(args[:3] == ['docker', 'rm', '--force'] for args in calls))
        self.assertNotIn('gs://', errors.getvalue())
        self.assertNotIn('restore.dump', errors.getvalue())

    def test_success_stamps_follow_successful_jobs_only(self):
        for unit, stamp in [('rallyroo-backup.service', 'backup-ok'), ('rallyroo-backup-verify.service', 'verify-ok')]:
            text = (ROOT / 'backup' / unit).read_text()
            self.assertIn(f'ExecStartPost=/usr/bin/touch /var/lib/rallyroo-backup/{stamp}', text)
            self.assertIn('StateDirectoryMode=0700', text)


if __name__ == '__main__':
    unittest.main()
