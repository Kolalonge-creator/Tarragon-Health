#!/usr/bin/env bash
#
# Runs the SQL proof scripts in packages/db/tests against a database.
#
# WHY THIS EXISTS. packages/db/tests/ holds ~170 hand-written verification
# scripts, several thousand lines, each one wrapped in BEGIN/ROLLBACK and each
# ending in a PASS/FAIL table plus `raise exception` sabotage checks. Until
# this script they were referenced by no workflow and no package script: they
# looked exactly like an automated gate and were in fact run by hand, once,
# by whoever wrote them. A proof nobody re-runs is a comment.
#
# WHAT IT DOES. Every file listed in packages/db/tests/ci.manifest is run with
# ON_ERROR_STOP=1, so a `raise exception` (which is how these scripts report a
# HOLE OPEN or a VACUOUS TEST) fails the run. The output is then scanned for a
# FAIL verdict, because a script that only records FAIL in its result table
# would otherwise exit 0 and look green.
#
# Every .sql file in packages/db/tests must appear in EXACTLY ONE of
# ci.manifest or ci.excluded. A new proof file that is in neither fails this
# script rather than silently never running, which is the failure mode the
# whole directory was already in.
#
# Usage:
#   ./scripts/run-db-proofs.sh                 # against the local Supabase stack
#   DATABASE_URL=postgres://... ./scripts/run-db-proofs.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS="$ROOT/packages/db/tests"
MANIFEST="$TESTS/ci.manifest"
EXCLUDED="$TESTS/ci.excluded"

# The Supabase CLI's local stack, which is what `supabase start` in CI serves.
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# Read a list file into a variable, one filename per line, comments stripped.
read_list() {
  grep -v '^[[:space:]]*#' "$1" | sed '/^[[:space:]]*$/d' | sed 's/[[:space:]]*$//'
}

MANIFEST_FILES="$(read_list "$MANIFEST")"
EXCLUDED_FILES="$(read_list "$EXCLUDED")"
PRESENT_FILES="$(cd "$TESTS" && ls -1 *.sql | sort)"

# --- every file is accounted for, exactly once -----------------------------
# Deliberately before the psql check, so this half is useful (and enforced)
# even on a machine with no database to run against.
status=0
listed="$(printf '%s\n%s\n' "$MANIFEST_FILES" "$EXCLUDED_FILES" | sed '/^$/d')"
dupes="$(printf '%s\n' "$listed" | sort | uniq -d)"
if [[ -n "$dupes" ]]; then
  echo "run-db-proofs: listed more than once (manifest and/or excluded):" >&2
  printf '  %s\n' $dupes >&2
  status=1
fi
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ ! -f "$TESTS/$f" ]]; then
    echo "run-db-proofs: $f is listed but does not exist in packages/db/tests." >&2
    status=1
  fi
done <<<"$listed"
unlisted="$(comm -23 <(printf '%s\n' "$PRESENT_FILES") <(printf '%s\n' "$listed" | sort))"
if [[ -n "$unlisted" ]]; then
  echo "run-db-proofs: in neither ci.manifest nor ci.excluded:" >&2
  printf '  %s\n' $unlisted >&2
  echo "               Add it to ci.manifest so it actually runs, or to" >&2
  echo "               ci.excluded with a reason. A proof in neither list" >&2
  echo "               never runs, which is what this check exists to stop." >&2
  status=1
fi
if [[ $status -ne 0 ]]; then
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "run-db-proofs: psql is not installed; cannot run the database proofs." >&2
  exit 1
fi

# --- run them --------------------------------------------------------------
failed=""
failed_count=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  echo "=== $f"
  out=""
  if ! out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -X -q -f "$TESTS/$f" 2>&1)"; then
    echo "$out"
    echo "--- $f ERRORED (a raised assertion, or a broken script)"
    failed="$failed $f"
    failed_count=$((failed_count + 1))
    continue
  fi
  echo "$out"
  # A result table row whose verdict column is FAIL. The verdict is the last
  # column, so anchor on a trailing FAIL rather than the word anywhere.
  if grep -Eq '\|[[:space:]]*FAIL[[:space:]]*$' <<<"$out"; then
    echo "--- $f reported a FAIL verdict"
    failed="$failed $f"
    failed_count=$((failed_count + 1))
  fi
done <<<"$MANIFEST_FILES"

if [[ $failed_count -gt 0 ]]; then
  echo
  echo "run-db-proofs: $failed_count proof script(s) failed:"
  printf '  %s\n' $failed
  exit 1
fi

echo
echo "run-db-proofs: $(printf '%s\n' "$MANIFEST_FILES" | sed '/^$/d' | wc -l | tr -d ' ') proof script(s) passed."
