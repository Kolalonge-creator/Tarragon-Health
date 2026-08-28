#!/usr/bin/env bash
# Runs every packages/db/tests/*.sql file against a local Postgres and gates
# CI on the result. Each file already wraps itself in BEGIN/ROLLBACK and is
# self-contained (see packages/db/tests/*.sql headers), so this script's only
# job is to run them and decide pass/fail.
#
# Two failure signals, because these files were written over many sessions
# with two different self-check conventions and this script doesn't get to
# rewrite 58 files to unify them:
#
#   1. A raised exception (`raise exception ...`) — psql exits non-zero with
#      ON_ERROR_STOP=1. This is the hard, always-reliable signal and covers
#      every file that uses this convention directly (e.g.
#      escalation_slas_config.sql, gate_second_condition_review_to_complete_care.sql).
#   2. A `select count(*) filter (where not passed) as failures, count(*) as
#      total from test_results` summary — these never raise, so a bad case
#      would otherwise print a nonzero "failures" count and exit 0 anyway.
#      Best-effort: parsed from psql's aligned output where present. A file
#      that reports its results some other way (no failures/total summary at
#      all) isn't silently treated as passing — it just isn't
#      auto-gated by this script; its raw output is still printed for a
#      human (or a later CI run reading this log) to check.
#
# This is deliberately NOT presented as a complete guarantee — see the
# migration-testing discussion this script came out of. It is real
# verification for what it covers, not a substitute for reading the output.

set -uo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
TESTS_DIR="$(dirname "$0")/../packages/db/tests"

overall_status=0
hard_failures=()
soft_failures=()
unverified=()

for file in "$TESTS_DIR"/*.sql; do
  name="$(basename "$file")"
  echo "::group::${name}"
  output=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$file" 2>&1)
  exit_code=$?
  echo "$output"
  echo "::endgroup::"

  if [ $exit_code -ne 0 ]; then
    echo "::error::${name} — psql exited ${exit_code} (a raised exception or a real SQL error)"
    overall_status=1
    hard_failures+=("$name")
    continue
  fi

  failures=$(echo "$output" | awk '
    /failures/ && /total/ { getline; getline; print $1; found=1; exit }
    END { if (!found) print "NONE" }
  ')

  if [[ "$failures" == "NONE" ]]; then
    unverified+=("$name")
  elif [[ "$failures" =~ ^[0-9]+$ ]] && [ "$failures" -gt 0 ]; then
    echo "::error::${name} — ${failures} failing case(s) in its test_results summary"
    overall_status=1
    soft_failures+=("$name")
  fi
done

echo ""
echo "=== packages/db/tests summary ==="
echo "Hard failures (psql/SQL error):     ${#hard_failures[@]} ${hard_failures[*]:-}"
echo "Soft failures (failures>0 in table): ${#soft_failures[@]} ${soft_failures[*]:-}"
echo "Not auto-verifiable (no failures/total summary found — check the grouped log by hand): ${#unverified[@]}"

if [ $overall_status -ne 0 ]; then
  echo ""
  echo "One or more packages/db/tests files failed. See the grouped logs above."
  exit 1
fi

echo ""
echo "Every auto-verifiable packages/db/tests file passed."
