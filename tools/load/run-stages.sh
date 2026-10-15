#!/usr/bin/env bash
# Run one or more stages in order against the local stack: tools/load/run-stages.sh A B
# Each stage regenerates its population (deterministic seed) and writes docs/design/load-results/stage-<x>.md.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
for s in "$@"; do
  node run.mjs --stage "$s" --pool 20 --db-note "Container limited to 2 CPUs and 2 GB (docker update), max_connections 60, shared_buffers 224MB." || echo "stage $s failed"
done
