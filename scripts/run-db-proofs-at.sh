#!/usr/bin/env bash
#
# Runs the SQL proofs in packages/db/tests as if the clock said a chosen time.
#
# WHY THIS EXISTS. Several proofs built a report for "last month" or a
# "this month" window from fixtures placed a few days before today, so they
# passed on all but a handful of days: s38c failed on the 1st to the 4th of every
# month (it counted last month's recent readings), and four proofs failed in the
# hour after midnight in Lagos on the last day of a month, when UTC still said
# the old month. CI runs a proof once, on whatever day it happens to be, so a
# proof that is wrong on 4 days in 30 turns the whole pipeline red without
# warning. This runs the proofs on days chosen to be the awkward ones.
#
# HOW. Each proof is copied to a temp file with the clock functions in the
# SCRIPT replaced by the chosen time (now(), current_timestamp, current_date,
# clock_timestamp(), statement_timestamp(), transaction_timestamp(),
# localtimestamp), then run exactly as run-db-proofs.sh runs it, and judged the
# same way: a nonzero exit, or a result row ending in FAIL.
#
# WHAT IT CANNOT DO. It changes the clock the script reads, not the clock the
# database reads. A column default, a trigger or a function body that calls
# now() itself still sees the real time. Measured on a clean replay of 558
# proofs: all pass at "real", but a pretend date only three days away fails
# about half of them, and one weeks away fails about the same half, because the
# script and the database then disagree about what day it is. So use it only
# on a proof you suspect, whose product code does not read the clock itself
# (that is how the s38c first-days-of-the-month fault was found and checked),
# and always compare with a run at "real" first. It cannot test a proof that
# calls a product function which reads now() itself (the s60 / s59d / w01 case);
# for those, make the proof take the month the way the product does, in Lagos,
# which the scan test apps/web/src/lib/db-proofs/lagos-clock.scan.test.ts
# enforces. Proofs that are .sh files (two live connections) are skipped,
# because they race real transactions and a substituted clock means nothing
# to them. A full run takes about four minutes.
#
# Usage:
#   scripts/run-db-proofs-at.sh "2026-11-30 23:30:00+00"            # every proof in ci.manifest
#   scripts/run-db-proofs-at.sh "2027-03-01 12:00:00+01" a.sql b.sql # just these
#   scripts/run-db-proofs-at.sh real                                  # no substitution
#   DATABASE_URL=postgres://... scripts/run-db-proofs-at.sh "..."
#
# Prints one line per proof, "PASS", "FAIL" or "ERROR", then the failing names.
# Exits 1 if any failed. Point it at a disposable local database: every proof
# is wrapped in BEGIN/ROLLBACK, but it still writes and locks while it runs.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS="$ROOT/packages/db/tests"
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 \"<timestamp with zone>\"|real [proof.sql ...]" >&2
  exit 2
fi
AT="$1"
shift

if [[ $# -gt 0 ]]; then
  FILES="$(printf '%s\n' "$@")"
else
  FILES="$(grep -v '^[[:space:]]*#' "$TESTS/ci.manifest" | sed '/^[[:space:]]*$/d' | sed 's/[[:space:]]*$//')"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failed=""
n=0
while IFS= read -r f; do
  [[ -z "$f" || "$f" == *.sh ]] && continue
  n=$((n + 1))
  src="$TESTS/$f"
  if [[ "$AT" != "real" ]]; then
    perl -pe "
      s/\\bnow\\(\\)/'$AT'::timestamptz/g;
      s/\\bclock_timestamp\\(\\)/'$AT'::timestamptz/g;
      s/\\bstatement_timestamp\\(\\)/'$AT'::timestamptz/g;
      s/\\btransaction_timestamp\\(\\)/'$AT'::timestamptz/g;
      s/\\bcurrent_timestamp\\b(?!\\s*\\()/'$AT'::timestamptz/g;
      s/\\blocaltimestamp\\b(?!\\s*\\()/('$AT'::timestamptz)::timestamp/g;
      s/\\bcurrent_date\\b(?!\\s*\\()/('$AT'::timestamptz)::date/g;
    " "$TESTS/$f" >"$WORK/proof.sql"
    src="$WORK/proof.sql"
  fi
  if out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -X -q -f "$src" 2>&1)"; then
    if grep -Eq '\|[[:space:]]*FAIL[[:space:]]*$' <<<"$out"; then verdict=FAIL; else verdict=PASS; fi
  else
    verdict=ERROR
  fi
  echo "$verdict $f"
  [[ "$verdict" != PASS ]] && failed="$failed $f"
done <<<"$FILES"

echo
if [[ -n "$failed" ]]; then
  echo "run-db-proofs-at: failed at '$AT':"
  printf '  %s\n' $failed
  exit 1
fi
echo "run-db-proofs-at: $n proof(s) passed at '$AT'."
