#!/usr/bin/env bash
# Device lab harness (S06x-c / S08x-3). One command, one honest report.
#
#   MOBILE_E2E_EMAIL=... MOBILE_E2E_PASSWORD=... scripts/device-lab/run.sh --label "eas build <id>"
#
# Measures what it can on an attached Android phone (adb) or a booted iOS simulator and writes
# docs/device-lab/<date>-<device>.md and .json. Every metric is tagged "measured" or "not measured".
# Budgets come from packages/shared/src/proposed-config (device_lab.budgets) and are REPORT ONLY.
# Options: scripts/device-lab/run.sh --help. Steps for a person: docs/device-lab/RUNBOOK.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TSX="$ROOT/apps/web/node_modules/.bin/tsx"
CLI="$ROOT/packages/shared/src/device-lab/cli.ts"

if [[ ! -x "$TSX" ]]; then
  echo "tsx not found at $TSX. Run 'pnpm install' at the repo root first." >&2
  exit 2
fi

wants_help=false
for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "--dry-run" ]]; then wants_help=true; fi
done

if [[ "$wants_help" == false ]]; then
  if ! command -v adb >/dev/null 2>&1 && ! command -v xcrun >/dev/null 2>&1; then
    echo "Neither adb (Android platform-tools) nor xcrun (Xcode) is installed. See docs/device-lab/RUNBOOK.md." >&2
    exit 2
  fi
  if ! command -v maestro >/dev/null 2>&1; then
    echo "Note: maestro is not installed. Memory after the offline flow and the reconnect flush will be 'not measured' (install: https://maestro.mobile.dev)." >&2
  fi
fi

exec "$TSX" "$CLI" "$@"
