import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("upload", Path(__file__).with_name("upload-testflight.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


class ArchiveValidationTests(unittest.TestCase):
    def test_fastlane_diagnostics_redact_credentials_personal_data_and_tokens(self):
        environment = {
            'APPLE_API_KEY_ID': 'FIXTUREKEY',
            'APPLE_API_ISSUER_ID': 'fixture-issuer',
            'ASC_API_PRIVATE_KEY': 'fixture-private-key',
        }
        output = '''Failure for FIXTUREKEY and fixture-issuer
fixture-private-key
-----BEGIN PRIVATE KEY-----
secretmaterial
-----END PRIVATE KEY-----
Contact person@example.com at /Users/person/project
Bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN123456
Actionable: Unauthorized (401)
'''
        sanitized = upload.sanitized_failure_output(output, environment)
        for forbidden in ('FIXTUREKEY', 'fixture-issuer', 'fixture-private-key',
                          'secretmaterial', 'person@example.com', '/Users/person',
                          'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN123456'):
            self.assertNotIn(forbidden, sanitized)
        self.assertIn('Unauthorized (401)', sanitized)
        self.assertIn('<REDACTED_EMAIL>', sanitized)

    def test_fastlane_diagnostics_are_bounded_to_last_eighty_lines(self):
        output = '\n'.join(f'line {number}' for number in range(100))
        sanitized = upload.sanitized_failure_output(output, {})
        self.assertEqual(len(sanitized.splitlines()), 80)
        self.assertNotIn('line 19\n', sanitized + '\n')
        self.assertIn('line 99', sanitized)

    def test_archive_rejects_each_invalid_release_field(self):
        good = {"CFBundleIdentifier": "dev.rallyroo.app", "CFBundleVersion": "101.1.0",
                "CFBundleShortVersionString": "1.0", "RALLYROO_DATA_MODE": "remote",
                "RALLYROO_REMOTE_BASE_URL": "https://api.rallyroo.dev",
                "ITSAppUsesNonExemptEncryption": False, "UIDeviceFamily": [1],
                "DTSDKName": "iphoneos26.3"}
        entitlements = {"application-identifier": "5LS29Z8553.dev.rallyroo.app",
                        "com.apple.developer.team-identifier": "5LS29Z8553",
                        "aps-environment": "production", "com.apple.developer.applesignin": ["Default"],
                        "com.apple.security.application-groups": ["group.dev.rallyroo.app"]}
        extension_entitlements = {
            "application-identifier": "5LS29Z8553.dev.rallyroo.app.share",
            "com.apple.developer.team-identifier": "5LS29Z8553",
            "com.apple.security.application-groups": ["group.dev.rallyroo.app"],
        }
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory)
            extension = app / "PlugIns/FamilyAppShare.appex"
            extension.mkdir(parents=True)
            (extension / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": "dev.rallyroo.app.share",
                "CFBundleVersion": "101.1.0",
            }))
            (app / "PrivacyInfo.xcprivacy").write_bytes(plistlib.dumps({}))
            def signing_output(args):
                selected = extension_entitlements if str(extension) in args else entitlements
                return plistlib.dumps(selected)
            with patch.object(upload, "run", side_effect=signing_output):
                (app / "Info.plist").write_bytes(plistlib.dumps(good))
                self.assertEqual(upload.verify(app, "101.1.0"), "1.0")
                for key in good.keys() - {"CFBundleShortVersionString"}:
                    with self.subTest(key=key):
                        bad = {**good, key: "wrong"}
                        (app / "Info.plist").write_bytes(plistlib.dumps(bad))
                        with self.assertRaises(RuntimeError):
                            upload.verify(app, "101.1.0")
                (app / "Info.plist").write_bytes(plistlib.dumps(good))
                (app / "PrivacyInfo.xcprivacy").unlink()
                with self.assertRaises(FileNotFoundError):
                    upload.verify(app, "101.1.0")

    def test_signing_keychain_is_added_before_xcode_discovery(self):
        with patch.object(upload, 'run') as call:
            upload.activate_keychain('/tmp/signing.keychain-db', ['/Users/runner/login.keychain-db'])
            call.assert_called_once_with([
                'security', 'list-keychains', '-d', 'user', '-s',
                '/tmp/signing.keychain-db', '/Users/runner/login.keychain-db'
            ])

    def test_security_password_uses_stdin_not_argv(self):
        with patch.object(upload, "run") as call:
            upload.security(["unlock-keychain", "-p", "fixture-password", "fixture.keychain"])
            self.assertEqual(call.call_args.args[0], ["security", "-i"])
            self.assertIn(b"fixture-password", call.call_args.kwargs["input"])
            self.assertNotIn(b"quit", call.call_args.kwargs["input"])

    @unittest.skipUnless(__import__('sys').platform == 'darwin', 'Requires macOS Security CLI')
    def test_security_interactive_keychain_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            keychain = str(Path(directory) / 'fixture.keychain-db')
            try:
                upload.security(['create-keychain', '-p', 'fixture password', keychain])
                self.assertTrue(Path(keychain).exists())
                upload.security(['unlock-keychain', '-p', 'fixture password', keychain])
            finally:
                __import__('subprocess').run(['security', 'delete-keychain', keychain], capture_output=True)
