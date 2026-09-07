#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
capture="$ROOT/clients/ios/FamilyApp/ScheduleCaptureSheet.swift"

grep -q 'requestAuthorization { @Sendable' "$capture"
grep -q 'requestRecordPermission { @Sendable' "$capture"
grep -q 'installTap.*{ @Sendable' "$capture"
grep -q 'recognitionTask(with: request) { @Sendable' "$capture"
grep -q 'loadDataRepresentation.*{ @Sendable' "$capture"
grep -q 'struct SchedulePhotoPicker: UIViewControllerRepresentable' "$capture"

if grep -q 'PhotosPicker(selection:' "$capture"; then
  echo "SwiftUI PhotosPicker must not own first-use TCC callbacks under Swift 6" >&2
  exit 1
fi

echo "AI capture concurrency contract passed"
