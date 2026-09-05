"""Ephemeral signing; only sanitized status escapes this process.

Security CLI receives sensitive arguments through its interactive stdin, never
process argv. No raw signing/build/upload logs are retained as artifacts.
"""
import base64
import os
from pathlib import Path
import plistlib
import secrets
import shlex
import shutil
import re
import subprocess
import tempfile


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{Path(args[0]).name} failed; raw output withheld")
    return result.stdout


def sanitized_failure_output(output, environment):
    text = output.decode(errors='replace') if isinstance(output, bytes) else output
    for name in ('APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID', 'ASC_API_PRIVATE_KEY',
                 'APPLE_DISTRIBUTION_CERT', 'APPLE_DISTRIBUTION_CERT_PWD',
                 'APPLE_PROVISIONING_PROFILE'):
        value = environment.get(name, '')
        if value:
            text = text.replace(value, '<REDACTED>')
    text = re.sub(r'-----BEGIN [^-]+-----.*?-----END [^-]+-----', '<REDACTED_PEM>', text,
                  flags=re.DOTALL)
    text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '<REDACTED_EMAIL>', text)
    text = re.sub(r'/Users/[^/\s]+', '<HOME>', text)
    text = re.sub(r'(?<![\w])[A-Za-z0-9_+/=-]{40,}(?![\w])', '<REDACTED_TOKEN>', text)
    lines = [re.sub(r'\x1b\[[0-9;]*m', '', line) for line in text.splitlines()]
    return '\n'.join(lines[-80:])


def run_fastlane(args, cwd, environment):
    result = subprocess.run(args, cwd=cwd, env=environment,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        print('--- sanitized Fastlane diagnostic ---', flush=True)
        print(sanitized_failure_output(result.stdout, environment), flush=True)
        print('--- end diagnostic ---', flush=True)
        raise RuntimeError('Fastlane/App Store Connect stage failed')


def security(args):
    result = run(["security", "-i"], input=(shlex.join(args) + "\n").encode())
    return result


def activate_keychain(keychain, original_keychains):
    # Xcode discovers signing identities through the user search list. Passing
    # --keychain to codesign alone happens after Xcode's identity selection.
    run(["security", "list-keychains", "-d", "user", "-s",
         str(keychain), *original_keychains])


def verify(app, build):
    with (app / "Info.plist").open("rb") as f:
        info = plistlib.load(f)
    expected = {"CFBundleIdentifier": "dev.rallyroo.app", "CFBundleVersion": build,
                "RALLYROO_DATA_MODE": "remote",
                "RALLYROO_REMOTE_BASE_URL": "https://api.rallyroo.dev",
                "ITSAppUsesNonExemptEncryption": False, "UIDeviceFamily": [1]}
    for key, value in expected.items():
        if info.get(key) != value:
            raise RuntimeError(f"Archive validation failed: {key}")
    sdk_name = info.get('DTSDKName', '')
    sdk_match = re.fullmatch(r'iphoneos(\d+)(?:\.\d+)*', sdk_name) if isinstance(sdk_name, str) else None
    if not sdk_match or int(sdk_match.group(1)) < 26:
        raise RuntimeError('Archive validation failed: iOS 26 SDK or later required')
    with (app / "PrivacyInfo.xcprivacy").open("rb") as f:
        plistlib.load(f)
    run(["codesign", "--verify", "--deep", "--strict", str(app)])
    entitlements = plistlib.loads(run(["codesign", "-d", "--entitlements", ":-", str(app)]))
    for key, value in {"application-identifier": "5LS29Z8553.dev.rallyroo.app",
                       "com.apple.developer.team-identifier": "5LS29Z8553",
                       "aps-environment": "production",
                       "com.apple.developer.applesignin": ["Default"]}.items():
        if entitlements.get(key) != value:
            raise RuntimeError(f"Signing validation failed: {key}")
    if entitlements.get("get-task-allow", False):
        raise RuntimeError("Debug entitlement in distribution archive")
    return info["CFBundleShortVersionString"]


def main():
    required = ["APPLE_API_KEY_ID", "APPLE_API_ISSUER_ID", "ASC_API_PRIVATE_KEY",
                "APPLE_DISTRIBUTION_CERT", "APPLE_PROVISIONING_PROFILE"]
    for name in required:
        if not os.environ.get(name):
            raise RuntimeError(f"Missing GitHub secret: {name}")
    # Allocated durably before signing by the serialized deployment queue.
    build = os.environ['TESTFLIGHT_BUILD_NUMBER']
    if not build.isdigit() or not 101 <= int(build) <= 9999:
        raise RuntimeError('Invalid allocated build number')
    os.umask(0o077)
    original_keychains = shlex.split(run(["security", "list-keychains", "-d", "user"]).decode())
    with tempfile.TemporaryDirectory(prefix="rallyroo-signing-", dir=os.environ["RUNNER_TEMP"]) as temp:
        root = Path(temp)
        keychain = root / "signing.keychain-db"
        password = secrets.token_hex(32)
        profile_path = None
        try:
            cert = root / "distribution.p12"
            cert.write_bytes(base64.b64decode(os.environ["APPLE_DISTRIBUTION_CERT"]))
            profile = root / "profile.mobileprovision"
            profile.write_bytes(base64.b64decode(os.environ["APPLE_PROVISIONING_PROFILE"]))
            decoded = plistlib.loads(run(["security", "cms", "-D", "-i", str(profile)]))
            if decoded.get("ProvisionedDevices") or decoded.get("ProvisionsAllDevices"):
                raise RuntimeError("App Store distribution profile required")
            if decoded.get("TeamIdentifier") != ["5LS29Z8553"]:
                raise RuntimeError("Wrong provisioning team")
            profile_dir = Path.home() / "Library/MobileDevice/Provisioning Profiles"
            profile_dir.mkdir(parents=True, exist_ok=True)
            candidate = profile_dir / (decoded["UUID"] + ".mobileprovision")
            if candidate.exists():
                raise RuntimeError("Refusing to overwrite existing provisioning profile")
            profile_path = candidate
            shutil.copyfile(profile, profile_path)
            security(["create-keychain", "-p", password, str(keychain)])
            security(["unlock-keychain", "-p", password, str(keychain)])
            security(["set-keychain-settings", "-lut", "3600", str(keychain)])
            security(["import", str(cert), "-k", str(keychain), "-P",
                      os.environ.get("APPLE_DISTRIBUTION_CERT_PWD", ""),
                      "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"])
            security(["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:",
                      "-s", "-k", password, str(keychain)])
            activate_keychain(keychain, original_keychains)
            identities = run(["security", "find-identity", "-v", "-p", "codesigning", str(keychain)])
            if b'"Apple Distribution:' not in identities:
                raise RuntimeError("Distribution signing identity not available")
            archive = root / "Rallyroo.xcarchive"
            print(f"Archiving build {build}", flush=True)
            run(["xcodebuild", "-project", "clients/ios/FamilyApp.xcodeproj", "-scheme", "FamilyApp",
                 "-configuration", "Release", "-destination", "generic/platform=iOS",
                 "-archivePath", str(archive), "CODE_SIGN_STYLE=Manual",
                 "CODE_SIGN_IDENTITY=Apple Distribution", "DEVELOPMENT_TEAM=5LS29Z8553",
                 f"PROVISIONING_PROFILE_SPECIFIER={decoded['UUID']}",
                 f"OTHER_CODE_SIGN_FLAGS=--keychain {keychain}",
                 f"CURRENT_PROJECT_VERSION={build}", "archive"])
            app = archive / "Products/Applications/FamilyApp.app"
            version = verify(app, build)
            options = root / "ExportOptions.plist"
            options.write_bytes(plistlib.dumps({"method": "app-store-connect", "teamID": "5LS29Z8553",
                "signingStyle": "manual", "signingCertificate": "Apple Distribution",
                "provisioningProfiles": {"dev.rallyroo.app": decoded["UUID"]},
                "manageAppVersionAndBuildNumber": False, "uploadSymbols": True}))
            run(["xcodebuild", "-exportArchive", "-archivePath", str(archive),
                 "-exportPath", str(root / "export"), "-exportOptionsPlist", str(options)])
            ipa, = (root / "export").glob("*.ipa")
            fastlane_dir = root / "fastlane"
            fastlane_dir.mkdir()
            (fastlane_dir / "Fastfile").write_text('''lane :upload do
  key = app_store_connect_api_key(key_id: ENV.fetch("APPLE_API_KEY_ID"),
    issuer_id: ENV.fetch("APPLE_API_ISSUER_ID"), key_content: ENV.fetch("ASC_API_PRIVATE_KEY"))
  latest = latest_testflight_build_number(api_key: key, app_identifier: "dev.rallyroo.app",
    version: ENV.fetch("UPLOAD_VERSION"), initial_build_number: 0)
  UI.user_error!("Build number is not newer than App Store Connect") unless
    Gem::Version.new(ENV.fetch("UPLOAD_BUILD")) > Gem::Version.new(latest.to_s)
  upload_to_testflight(api_key: key, ipa: ENV.fetch("UPLOAD_IPA"),
    app_identifier: "dev.rallyroo.app", skip_submission: true,
    skip_waiting_for_build_processing: false)
end
''')
            gem_dir = run(["ruby", "-e", "print Gem.user_dir"]).decode()
            print("Verified archive; uploading to internal TestFlight (no App Review submission)", flush=True)
            fastlane_environment = {
                **os.environ, "UPLOAD_IPA": str(ipa),
                "UPLOAD_VERSION": version, "UPLOAD_BUILD": build,
            }
            run_fastlane([str(Path(gem_dir) / "bin/fastlane"), "upload"], root,
                         fastlane_environment)
            print(f"Uploaded and processed {version} ({build}); App Store Connect controls internal availability", flush=True)
        finally:
            subprocess.run(["security", "list-keychains", "-d", "user", "-s", *original_keychains],
                           capture_output=True)
            subprocess.run(["security", "delete-keychain", str(keychain)], capture_output=True)
            if profile_path and profile_path.exists():
                profile_path.unlink()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never render provider responses or subprocess exceptions containing credentials.
        print(str(error) if isinstance(error, RuntimeError) else "Upload failed; inspect the last sanitized stage")
        raise SystemExit(1)
