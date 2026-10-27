#!/usr/bin/env bash
# S88d: checks that a completed real-device results file exists for the current native runtime.
#
#   scripts/device-lab/check-release-results.sh            report only: prints what is missing, always exits 0
#   scripts/device-lab/check-release-results.sh --require  release gate: exits 1 when the file is absent or incomplete
#
# The file is docs/device-lab/release-results/<runtimeVersion>.md, copied from docs/device-lab/RESULTS-TEMPLATE.md and filled
# in by the person who ran the device lab (docs/device-lab/FOUNDER-CHECKLIST.md). It counts as complete only when it carries
# the line "Status: COMPLETE" and contains no "TBD" cell. This script never measures anything and never invents a number.
set -euo pipefail

require=0
[ "${1:-}" = "--require" ] && require=1

root="$(cd "$(dirname "$0")/../.." && pwd)"
runtime="$(node -p "require('$root/apps/mobile/app.json').expo.runtimeVersion")"
file="$root/docs/device-lab/release-results/${runtime}.md"
problems=()

if [ ! -f "$file" ]; then
  problems+=("no results file for runtimeVersion ${runtime}: expected docs/device-lab/release-results/${runtime}.md")
else
  grep -q '^Status: COMPLETE$' "$file" || problems+=("the file does not carry the line 'Status: COMPLETE'")
  tbd="$(grep -c 'TBD' "$file" || true)"
  [ "$tbd" -eq 0 ] || problems+=("${tbd} line(s) still say TBD")
  grep -q "^Runtime version: ${runtime}$" "$file" || problems+=("the 'Runtime version:' line does not match ${runtime}")
fi

if [ "${#problems[@]}" -eq 0 ]; then
  echo "device-lab results OK for ${runtime}: ${file#"$root"/}"
  exit 0
fi

echo "device-lab results NOT ready for ${runtime}:"
for p in "${problems[@]}"; do echo "  - $p"; done
echo "Run docs/device-lab/FOUNDER-CHECKLIST.md and fill docs/device-lab/RESULTS-TEMPLATE.md."
if [ "$require" -eq 1 ]; then
  echo "REQUIRED for this release: failing."
  exit 1
fi
echo "Report only: not failing the build."
exit 0
