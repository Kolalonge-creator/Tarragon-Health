#!/usr/bin/env bash
# Called by .github/workflows/mobile-maestro-android.yml inside the emulator. Not run anywhere yet.
set -euo pipefail

APK="${1:?path to the apk}"
FLOW="${FLOW:-throttled-2g-sync.yaml}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

adb install -r "$APK"

# A slow, lossy link, as the throttled flow requires. The flow refuses to run unless THROTTLE_CONFIRMED=yes.
adb emu network speed gsm
adb emu network delay gprs

run_flow() {
  maestro test --format junit --output "$HOME/.maestro/tests/$(basename "$1" .yaml).xml" \
    -e THROTTLE_CONFIRMED=yes \
    -e MOBILE_E2E_EMAIL="${MOBILE_E2E_EMAIL:?set the MOBILE_E2E_EMAIL secret}" \
    -e MOBILE_E2E_PASSWORD="${MOBILE_E2E_PASSWORD:?set the MOBILE_E2E_PASSWORD secret}" \
    "$1"
}

mkdir -p "$HOME/.maestro/tests"
if [ "$FLOW" = "all" ]; then
  for f in "$DIR"/flows/*.yaml; do run_flow "$f"; done
else
  case "$FLOW" in */*|*..*) echo "flow must be a file name under flows/"; exit 1;; esac
  run_flow "$DIR/flows/$FLOW"
fi
