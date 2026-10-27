import copy
import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('submission_upload', Path(__file__).with_name('upload-testflight.py'))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)
ROOT = Path(__file__).resolve().parent.parent / 'clients/ios'


class SubmissionAssetTests(unittest.TestCase):
    def test_both_source_manifests_match_the_declared_inventory(self):
        upload.verify_privacy_manifest(ROOT / 'FamilyApp/PrivacyInfo.xcprivacy', main_app=True)
        upload.verify_privacy_manifest(ROOT / 'FamilyAppShare/PrivacyInfo.xcprivacy', main_app=False)

    def test_parseable_empty_tracking_or_incomplete_manifests_are_not_accepted(self):
        good = plistlib.loads((ROOT / 'FamilyApp/PrivacyInfo.xcprivacy').read_bytes())
        bad = [{}, {**good, 'NSPrivacyTracking': True}, {**good, 'NSPrivacyTrackingDomains': ['tracking.example']},
               {**good, 'NSPrivacyCollectedDataTypes': []}, {**good, 'NSPrivacyAccessedAPITypes': []}]
        for key, value in [('NSPrivacyCollectedDataTypeTracking', True),
                           ('NSPrivacyCollectedDataTypeLinked', False),
                           ('NSPrivacyCollectedDataTypePurposes', [])]:
            item = copy.deepcopy(good)
            item['NSPrivacyCollectedDataTypes'][0][key] = value
            bad.append(item)
        duplicate = copy.deepcopy(good)
        duplicate['NSPrivacyCollectedDataTypes'].append(duplicate['NSPrivacyCollectedDataTypes'][0])
        bad.append(duplicate)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'PrivacyInfo.xcprivacy'
            for manifest in bad:
                path.write_bytes(plistlib.dumps(manifest))
                with self.assertRaises(RuntimeError):
                    upload.verify_privacy_manifest(path, main_app=True)

    def test_extension_cannot_silently_claim_main_app_collection(self):
        with self.assertRaises(RuntimeError):
            upload.verify_privacy_manifest(ROOT / 'FamilyApp/PrivacyInfo.xcprivacy', main_app=False)

    def test_compiled_resources_require_extension_manifest_and_permission_strings(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory)
            extension = app / 'PlugIns/FamilyAppShare.appex'
            extension.mkdir(parents=True)
            (app / 'PrivacyInfo.xcprivacy').write_bytes((ROOT / 'FamilyApp/PrivacyInfo.xcprivacy').read_bytes())
            info = {key: 'Rallyroo asks only when you use this feature.' for key in upload.PURPOSE_KEYS}
            (app / 'Info.plist').write_bytes(plistlib.dumps(info))
            with self.assertRaises(FileNotFoundError):
                upload.verify_app_assets(app)
            (extension / 'PrivacyInfo.xcprivacy').write_bytes((ROOT / 'FamilyAppShare/PrivacyInfo.xcprivacy').read_bytes())
            upload.verify_app_assets(app)
            for key in upload.PURPOSE_KEYS:
                (app / 'Info.plist').write_bytes(plistlib.dumps({**info, key: '  '}))
                with self.assertRaises(RuntimeError):
                    upload.verify_app_assets(app)


if __name__ == '__main__':
    unittest.main()
