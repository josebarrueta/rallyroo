#!/usr/bin/env python3
"""Check declared privacy assets in source or compiled bundles; never submits review."""
import argparse
import importlib.util
from pathlib import Path
import plistlib
import sys

spec = importlib.util.spec_from_file_location('uploader', Path(__file__).with_name('upload-testflight.py'))
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--app', type=Path)
    mode.add_argument('--source', action='store_true')
    args = parser.parse_args()
    try:
        if args.app:
            uploader.verify_app_assets(args.app)
        else:
            root = Path(__file__).resolve().parent.parent
            main = root / 'clients/ios/FamilyApp'
            uploader.verify_privacy_manifest(main / 'PrivacyInfo.xcprivacy', main_app=True)
            uploader.verify_privacy_manifest(root / 'clients/ios/FamilyAppShare/PrivacyInfo.xcprivacy', main_app=False)
            info = plistlib.loads((main / 'Info.plist').read_bytes())
            if any(not isinstance(info.get(key), str) or not info[key].strip() for key in uploader.PURPOSE_KEYS):
                raise RuntimeError('Missing permission explanation')
    except (OSError, ValueError, TypeError, RuntimeError):
        print('Submission asset verification failed; check privacy resources and permission explanations.', file=sys.stderr)
        return 1
    print('App/extension privacy assets verified against the declared inventory; legal/ASC review still required.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
