#!/usr/bin/env bash
# Compile the actual scheduler into an unbundled simulator executable. Its
# constructor must not ask UserNotifications for an application bundle yet.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 SIMULATOR_ID IOS_DERIVED_DATA" >&2
  exit 2
fi
root=$(cd "$(dirname "$0")/.." && pwd)
device=$1
products="$2/Build/Products/Debug-iphonesimulator"
test -f "$products/FamilyCore.o"
test -d "$products/FamilyCore.swiftmodule"
work=$(mktemp -d "${TMPDIR:-/tmp}/rallyroo-scheduler-startup.XXXXXX")
trap 'rm -rf "$work"' EXIT

# xcodebuild may shut the simulator down when its UI test session finishes.
state=$(xcrun simctl list devices -j | python3 -c '
import json, sys
wanted = sys.argv[1]
print(next(d["state"] for devices in json.load(sys.stdin)["devices"].values()
           for d in devices if d["udid"] == wanted))' "$device")
if [[ "$state" == "Shutdown" ]]; then xcrun simctl boot "$device"; fi
xcrun simctl bootstatus "$device" -b
arch=$(xcrun lipo -archs "$products/FamilyCore.o")
case "$arch" in arm64|x86_64) ;; *) echo "Unsupported simulator architecture" >&2; exit 1 ;; esac

cat > "$work/StartupProbe.swift" <<'SWIFT'
import Foundation

@main
struct StartupProbe {
    static func main() {
        precondition(Bundle.main.bundleIdentifier == nil, "Probe must remain unbundled")
        _ = LocalReminderAlertScheduler()
        print("Scheduler constructor defers application-dependent notification APIs")
    }
}
SWIFT
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
SDKROOT="$sdk" xcrun --sdk iphonesimulator swiftc -swift-version 6 -parse-as-library \
  -target "$arch-apple-ios16.0-simulator" -sdk "$sdk" \
  -I "$products" "$root/clients/ios/FamilyApp/LocalReminderAlertScheduler.swift" \
  "$work/StartupProbe.swift" "$products/FamilyCore.o" -o "$work/startup-probe"
xcrun simctl spawn "$device" "$work/startup-probe"
