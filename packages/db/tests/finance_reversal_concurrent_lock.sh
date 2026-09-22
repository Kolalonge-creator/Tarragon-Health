#!/usr/bin/env bash
# ============================================================================
# Verification: 20260922181900_finance_reversal_row_locking
#
# WHY THIS IS A .sh PROOF, NOT A .sql ONE (see scripts/run-db-proofs.sh's own
# header). Every other file in this directory runs as one psql session
# wrapped in BEGIN/ROLLBACK -- fine for proving what a single transaction
# sees, but this bug is specifically a race between TWO overlapping
# transactions both reading is_reversed = false before either commits. One
# connection cannot hold a row lock against itself to prove that a second,
# independent session actually blocks on it -- a sequential re-check within
# one session would only re-prove the pre-existing "if is_reversed then
# raise" still works, which was never what was broken. This script launches
# real, concurrent psql connections against $DATABASE_URL (the same URL
# run-db-proofs.sh already uses) so the FOR UPDATE lock is exercised for
# real.
#
# SAFETY. Its sabotage phases (3 and 4 below) temporarily deploy KNOWN-BROKEN,
# pre-fix bodies of the very functions that move money, then restore the
# fixed bodies. That is only acceptable against a throwaway/local stack, so
# this script refuses to run at all unless $DATABASE_URL looks local (see the
# guard right after the constants below) -- checked two ways: a cheap
# substring match on the URL text as a first filter, then an authoritative
# check of inet_server_addr() (where the connection actually landed), since
# a URL can look local while a password, a multi-host conninfo, a
# PGHOSTADDR override, or an SSH tunnel makes it connect somewhere real.
# restore_fixed_functions re-applies the migration file with
# --single-transaction so a failed restore can never leave the constraint
# dropped and the pre-fix bodies still deployed, and is only ever invoked
# when a sabotage phase actually deployed something (SABOTAGE_DEPLOYED),
# not on every exit -- an unconditional ACCESS EXCLUSIVE alter table on
# every early exit would be a needless cost and contention risk against
# this repo's shared local stacks.
#
# A first version of this script's checks 1/2 asserted only ledger state
# (contra-entry count, is_reversed) and outcome counts (approved/rejected).
# A second review found that, after the correction in finding 3, those
# specific values hold identically whether the fix is present or not (the
# pre-existing unique index already guarantees them) -- so the checks
# proved nothing about the lock itself. Every check below that matters for
# discriminating fixed-vs-not now also asserts on which error message
# actually surfaced (checked across BOTH the hold and the plain log, since
# which one wins the race is decided by psql connection timing, not by the
# role this script assigned it) and on the challenger's own wall-clock time
# (>=1s -- proof it was actually blocked, not just that it happened to run
# after the holder had already committed).
#
# WHAT IT PROVES, against the fix in 20260922181900_finance_reversal_row_locking.sql:
#  1. Two concurrent public.finance_reverse_journal calls against the same
#     UNDER-threshold entry (the synchronous path): exactly one reversal
#     posts. The loser gets a clean "entry already reversed" error.
#  2. Two concurrent public.finance_approve_request calls, each approving a
#     separate journal_reversal request that targets the SAME OVER-threshold
#     entry (this is finding 2's exact scenario: two pending requests queued
#     for one entry because nothing stops that, then both get approved):
#     exactly one approves and posts; the other is cleanly auto-rejected
#     (status='rejected'), never left stuck at status='pending'.
#  3. SABOTAGE: temporarily restoring the pre-fix (no FOR UPDATE anywhere)
#     bodies of private.finance_reverse_entry and public.finance_reverse_journal
#     and re-running check 1 against a fresh entry shows the race reopens --
#     but NOT as a second contra posting. A pre-existing unique index on
#     finance_journal_entries(source, source_ref) already makes a genuine
#     double-post impossible here (see the migration's own header for the
#     full correction) -- what actually reopens is a raw, unhandled
#     `duplicate key value violates unique constraint` surfacing to the
#     loser instead of the clean "entry already reversed" the fix produces.
#     That is what this check asserts: the ledger stays safe either way
#     (still exactly one contra entry), but the loser's error message is
#     only clean when the fix is in place.
#  4. SABOTAGE: temporarily restoring ONLY the pre-fix body of
#     public.finance_approve_request (finance_reverse_entry and
#     finance_reverse_journal stay fixed -- this isolates finding 2
#     specifically) and re-running check 2 against a fresh entry shows one
#     of the two approval requests ends up stuck at status='pending' with
#     its approve call having raised an error -- exactly the bug report's
#     failure mode.
# The exact pre-fix bodies used for sabotage are the live definitions this
# review pulled via pg_get_functiondef before writing the fix (2026-09-18).
#
# Every function is restored to its fixed body (re-applying the migration
# file itself -- not a duplicated copy of its bodies, so this proof can never
# silently drift from what the migration actually contains if a later
# migration changes these functions again; migrations in this codebase are
# treated as immutable history and are not renamed once applied, so the path
# below is not expected to move), and every fixture this script creates
# (auth.users/profiles actors, journal entries/lines, approval requests) is
# deleted, via a bash `trap` that fires on any normal exit path -- success,
# an assertion failure, or a script bug (bash runs the EXIT trap regardless
# of how the shell exits, signals included, with the one unavoidable
# exception of SIGKILL, which no trap in any shell can ever catch -- a CI
# job hard-killed mid-sabotage is a residual risk no script can close, which
# is exactly why the local-only guard above exists: the blast radius of that
# residual risk is a throwaway stack, never production). This script cannot
# rely on BEGIN/ROLLBACK the way the .sql proofs do (each concurrent session
# is its own transaction and must see the other's committed writes), so
# cleanup has to be explicit.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SELF_DIR/../../../supabase/migrations/20260922181900_finance_reversal_row_locking.sql"

# Refuse to run against anything that doesn't look like a local/throwaway
# Postgres instance -- see the SAFETY note above. A plain substring check on
# $DATABASE_URL is not trustworthy on its own (a Supabase password can
# contain "localhost", a multi-host libpq conninfo can fail over to a remote
# host, PGHOSTADDR can silently redirect where a "local-looking" URL
# actually connects) -- it's kept here only as a cheap, fast first filter.
# The real check, below (once psql is confirmed available), asks the SERVER
# where it actually is via inet_server_addr(), which reflects the real
# connection regardless of how it was constructed. Override with
# FRCL_ALLOW_REMOTE=yes-i-know-this-is-disposable (an exact phrase, not any
# truthy value, so a stray FRCL_ALLOW_REMOTE=0 left in an environment can't
# silently disarm this) only if you are certain $DATABASE_URL is disposable.
ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${FRCL_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "finance_reversal_concurrent_lock: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "This proof's sabotage phases temporarily deploy pre-fix, race-prone finance functions." >&2
  echo "Got: $DB_URL" >&2
  echo "If this really is a throwaway/local stack, re-run with FRCL_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed; cannot run this proof." >&2
  exit 1
fi
if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "finance_reversal_concurrent_lock: expected migration file not found at $MIGRATION_FILE" >&2
  exit 1
fi

# The authoritative check: where did the connection actually land, not what
# the URL text says. NULL means a Unix-domain socket, which cannot be
# remote by definition. 127.0.0.0/8 and ::1 are loopback. Anything else --
# including "couldn't even run this query" -- refuses.
SERVER_LOCALITY="$(psql "$DB_URL" -X -q -t -A -c \
  "select case when inet_server_addr() is null then 'local' \
               when inet_server_addr() <<= '127.0.0.0/8'::inet then 'local' \
               when inet_server_addr() = '::1'::inet then 'local' \
               else 'remote' end;" 2>&1)"
if [[ "$SERVER_LOCALITY" != "local" && "${FRCL_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "finance_reversal_concurrent_lock: refusing to run -- the server itself does not report a local address." >&2
  echo "inet_server_addr() check returned: $SERVER_LOCALITY" >&2
  echo "If this really is a throwaway/local stack, re-run with FRCL_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

PSQL_SETUP=(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1)
PSQL_READ=(psql "$DB_URL" -X -q -t -A)

WORK="$(mktemp -d)"

FAIL_COUNT=0
RESULTS=()
record() { # name observed expected
  local name="$1" observed="$2" expected="$3" verdict="FAIL"
  [[ "$observed" == "$expected" ]] && verdict="PASS"
  [[ "$verdict" == "FAIL" ]] && FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS+=("$name | observed=$observed | expected=$expected | $verdict")
}

# Re-applies the migration file verbatim -- every statement in it is
# idempotent (CREATE OR REPLACE FUNCTION; the constraint swap is now
# `drop ... if exists` + `add constraint`; the closing DO block only
# asserts). -1/--single-transaction wraps the whole file in one implicit
# BEGIN/COMMIT: without it, the constraint DROP and the constraint ADD each
# autocommit separately, so a failure on the ADD (a lock held by another
# concurrent session on a shared local stack, a future migration adding a
# request_type this table has a live row of and can't validate against) would
# leave the constraint dropped AND the pre-fix function bodies not yet
# restored -- strictly worse than before the restore was attempted. Prints
# psql's output and returns nonzero on failure instead of swallowing it -- a
# silent failure here would mean a pre-fix, race-prone function is left
# deployed with nothing to say so.
restore_fixed_functions() {
  local out
  if ! out="$("${PSQL_SETUP[@]}" -1 -f "$MIGRATION_FILE" 2>&1)"; then
    echo "CRITICAL: restore_fixed_functions failed -- the pre-fix (vulnerable) function bodies may still be deployed on \$DATABASE_URL." >&2
    echo "$out" >&2
    return 1
  fi
  return 0
}

ORG_ID=""
ACTORS_CREATED=0
SABOTAGE_DEPLOYED=0

cleanup() {
  local ec=$?
  # Print whatever checks did complete before exiting, even on an early
  # `exit 1` (a fixture-setup failure, say) -- otherwise diagnostics from
  # checks that already passed are silently lost.
  if [[ ${#RESULTS[@]} -gt 0 ]]; then
    printf '%s\n' "${RESULTS[@]}"
    echo
    if [[ $FAIL_COUNT -gt 0 ]]; then
      echo "finance_reversal_concurrent_lock: $FAIL_COUNT check(s) FAILED"
    else
      echo "finance_reversal_concurrent_lock: all checks passed"
    fi
  fi
  # Only restore if a sabotage phase actually deployed a pre-fix body --
  # skips a needless ACCESS EXCLUSIVE alter table (a real cost against this
  # repo's shared local stacks, see the restore_fixed_functions comment)
  # on every ordinary early exit, of which there are several above (an
  # empty organisations table, a failed fixture insert) that never touched
  # the deployed functions at all.
  if [[ $SABOTAGE_DEPLOYED -eq 1 ]]; then
    restore_fixed_functions || ec=1
  fi
  if [[ $ACTORS_CREATED -eq 1 ]]; then
    local out
    if ! out="$("${PSQL_SETUP[@]}" \
      -v officer_x="$OFFICER_X" -v officer_y="$OFFICER_Y" -v requester="$REQUESTER" \
      -v reviewer_b="$REVIEWER_B" -v reviewer_c="$REVIEWER_C" 2>&1 <<'SQL'
delete from public.finance_approval_requests where requested_by in (:'requester'::uuid) or reviewed_by in (:'reviewer_b'::uuid, :'reviewer_c'::uuid);
delete from public.finance_journal_entries where created_by in (:'officer_x'::uuid, :'officer_y'::uuid, :'requester'::uuid, :'reviewer_b'::uuid, :'reviewer_c'::uuid);
delete from auth.users where id in (:'officer_x'::uuid, :'officer_y'::uuid, :'requester'::uuid, :'reviewer_b'::uuid, :'reviewer_c'::uuid);
SQL
    )"; then
      echo "CRITICAL: fixture cleanup failed -- test actors and/or journal entries may remain on \$DATABASE_URL." >&2
      echo "$out" >&2
      ec=1
    fi
  fi
  rm -rf "$WORK"
  exit "$ec"
}
trap cleanup EXIT

# ============================================================================
# 0. FIXTURES -- an organisation-scoped admin actor per role. Minted here
#    (auth.users + public.profiles), not borrowed from seed.sql, which seeds
#    no finance/admin account at all.
# ============================================================================
ORG_ID="$("${PSQL_READ[@]}" -c "select id from public.organisations limit 1;")"
if [[ -z "$ORG_ID" ]]; then
  echo "no organisation available -- cannot run this test" >&2
  exit 1
fi

GENERATED=()
while IFS= read -r line; do
  GENERATED+=("$line")
done < <("${PSQL_READ[@]}" -c "select gen_random_uuid() from generate_series(1,5);")
OFFICER_X="${GENERATED[0]}"; OFFICER_Y="${GENERATED[1]}"; REQUESTER="${GENERATED[2]}"
REVIEWER_B="${GENERATED[3]}"; REVIEWER_C="${GENERATED[4]}"

"${PSQL_SETUP[@]}" \
  -v org="$ORG_ID" -v officer_x="$OFFICER_X" -v officer_y="$OFFICER_Y" -v requester="$REQUESTER" \
  -v reviewer_b="$REVIEWER_B" -v reviewer_c="$REVIEWER_C" <<'SQL'
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  (:'officer_x'::uuid,  'frcl-officer-x@example.invalid',  'x', now(), '{}', '{}'),
  (:'officer_y'::uuid,  'frcl-officer-y@example.invalid',  'x', now(), '{}', '{}'),
  (:'requester'::uuid,  'frcl-requester@example.invalid',  'x', now(), '{}', '{}'),
  (:'reviewer_b'::uuid, 'frcl-reviewer-b@example.invalid', 'x', now(), '{}', '{}'),
  (:'reviewer_c'::uuid, 'frcl-reviewer-c@example.invalid', 'x', now(), '{}', '{}')
on conflict (id) do nothing;

insert into public.profiles (id, organisation_id, role, full_name)
values
  (:'officer_x'::uuid,  :'org'::uuid, 'admin', 'FRCL Officer X'),
  (:'officer_y'::uuid,  :'org'::uuid, 'admin', 'FRCL Officer Y'),
  (:'requester'::uuid,  :'org'::uuid, 'admin', 'FRCL Requester'),
  (:'reviewer_b'::uuid, :'org'::uuid, 'admin', 'FRCL Reviewer B'),
  (:'reviewer_c'::uuid, :'org'::uuid, 'admin', 'FRCL Reviewer C')
on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
SQL
if [[ $? -ne 0 ]]; then echo "fixture actor setup failed" >&2; exit 1; fi
ACTORS_CREATED=1

post_entry() { # actor amount_minor -> prints a plain uuid
  # Calls private.finance_post_journal directly, NOT the public
  # finance_post_manual_journal wrapper. That wrapper (a) returns jsonb, not
  # a bare uuid, and (b) is gated by the SAME approval threshold as the
  # reversal path being tested here, which makes it structurally impossible
  # to fixture an over-threshold entry through it at all -- any entry it can
  # post synchronously is, by construction, under the reversal threshold too.
  # This is pure fixture setup (getting an entry to exist), not the thing
  # under test, so bypassing the public wrapper's own gate is correct here;
  # p_created_by is passed explicitly so no session/auth.uid() simulation is
  # needed for this step at all.
  local actor="$1" amount="$2"
  "${PSQL_READ[@]}" -v actor="$actor" -v amount="$amount" <<'SQL'
select private.finance_post_journal(current_date, 'NGN'::public.currency, 'manual', null, 'FRCL fixture entry',
  jsonb_build_array(
    jsonb_build_object('account_code','6100','debit_minor',:amount,'credit_minor',0),
    jsonb_build_object('account_code','1000','debit_minor',0,'credit_minor',:amount)
  ), :'actor'::uuid)::text;
SQL
}

# ============================================================================
# Templates for the two concurrent sessions. "hold" wins the race and sleeps
# before COMMIT so the "plain" session -- started slightly later -- is
# guaranteed to still find the row locked (with the fix) or find it already
# committed unreversed (without it, in the sabotage runs). lock_timeout is a
# safety net: if the fix has a real deadlock/bug, this fails fast instead of
# hanging the CI job forever.
# ============================================================================
cat > "$WORK/reverse_hold.sql" <<'SQL'
begin;
set local lock_timeout = '15s';
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
select public.finance_reverse_journal(:'entry'::uuid, 'concurrent lock test - holder');
select pg_sleep(2);
commit;
SQL
cat > "$WORK/reverse_plain.sql" <<'SQL'
begin;
set local lock_timeout = '15s';
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
select public.finance_reverse_journal(:'entry'::uuid, 'concurrent lock test - challenger');
commit;
SQL
# Both pass a reviewer note deliberately, so whichever session ends up
# auto-rejected exercises the "reviewer's own note is appended, not
# substituted for the system's explanation" fix -- checked below by reading
# back whichever of the two requests actually landed at status='rejected'.
cat > "$WORK/approve_hold.sql" <<'SQL'
begin;
set local lock_timeout = '15s';
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
select public.finance_approve_request(:'reqid'::uuid, 'reviewer confirmed');
select pg_sleep(2);
commit;
SQL
cat > "$WORK/approve_plain.sql" <<'SQL'
begin;
set local lock_timeout = '15s';
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
select public.finance_approve_request(:'reqid'::uuid, 'reviewer confirmed');
commit;
SQL

# CHALLENGER_ELAPSED (whole seconds, via bash's SECONDS) is how long the
# challenger's own psql process took once launched. Every check that relies
# on genuine blocking asserts this is >=1 -- without the lock, the
# challenger resolves in well under a second; blocked behind the holder's
# 2s post-call pg_sleep, it can't return before most of that has elapsed.
# This is what actually proves two sessions overlapped, rather than the
# holder having simply finished and committed before the challenger (a
# 0.5s stagger alone doesn't guarantee that on a loaded runner) -- a
# same-outcome-either-way check (e.g. "the challenger got a clean error")
# would pass just as well if there had been no real concurrency at all.
race_reverse() { # tag entry actor_holder actor_challenger -> sets RC_HOLD RC_PLAIN CHALLENGER_ELAPSED, writes $WORK/<tag>_{hold,plain}.log
  local tag="$1" entry="$2" a="$3" b="$4"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v actor="$a" -v entry="$entry" \
    -f "$WORK/reverse_hold.sql" > "$WORK/${tag}_hold.log" 2>&1 &
  local pid_hold=$!
  sleep 0.5
  SECONDS=0
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v actor="$b" -v entry="$entry" \
    -f "$WORK/reverse_plain.sql" > "$WORK/${tag}_plain.log" 2>&1 &
  local pid_plain=$!
  wait "$pid_hold"; RC_HOLD=$?
  wait "$pid_plain"; RC_PLAIN=$?
  CHALLENGER_ELAPSED=$SECONDS
}

race_approve() { # tag req_holder req_challenger actor_holder actor_challenger -> sets RC_HOLD RC_PLAIN CHALLENGER_ELAPSED, writes $WORK/<tag>_{hold,plain}.log
  local tag="$1" req_h="$2" req_p="$3" a="$4" b="$5"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v actor="$a" -v reqid="$req_h" \
    -f "$WORK/approve_hold.sql" > "$WORK/${tag}_hold.log" 2>&1 &
  local pid_hold=$!
  sleep 0.5
  SECONDS=0
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v actor="$b" -v reqid="$req_p" \
    -f "$WORK/approve_plain.sql" > "$WORK/${tag}_plain.log" 2>&1 &
  local pid_plain=$!
  wait "$pid_hold"; RC_HOLD=$?
  wait "$pid_plain"; RC_PLAIN=$?
  CHALLENGER_ELAPSED=$SECONDS
}

entry_state() { # entry -> prints "contra_count|is_reversed"
  "${PSQL_READ[@]}" -v entry="$1" -F'|' <<'SQL'
select (select count(*) from public.finance_journal_entries where reversal_of = :'entry'::uuid),
       (select is_reversed from public.finance_journal_entries where id = :'entry'::uuid);
SQL
}

request_status() { # request_id -> prints status
  "${PSQL_READ[@]}" -v reqid="$1" <<'SQL'
select status from public.finance_approval_requests where id = :'reqid'::uuid;
SQL
}

request_review_note() { # request_id -> prints review_note
  "${PSQL_READ[@]}" -v reqid="$1" <<'SQL'
select coalesce(review_note, '') from public.finance_approval_requests where id = :'reqid'::uuid;
SQL
}

# ============================================================================
# 1. FIXED: two concurrent direct reversals of the same UNDER-threshold
#    entry -- exactly one must post.
# ============================================================================
ENTRY1="$(post_entry "$OFFICER_X" 100000)"
if [[ -z "$ENTRY1" ]]; then echo "check 1 fixture: could not post entry1" >&2; exit 1; fi

race_reverse check1 "$ENTRY1" "$OFFICER_X" "$OFFICER_Y"
IFS='|' read -r CONTRA1 REV1 <<<"$(entry_state "$ENTRY1")"
RC_SUM=$((RC_HOLD == 0 ? 1 : 0)); RC_SUM=$((RC_SUM + (RC_PLAIN == 0 ? 1 : 0)))
# Which of {hold, plain} "wins" is decided by psql connection timing, not by
# which role this script assigned it (see race_reverse's own header) -- so
# these two counts are taken across BOTH logs, not just the challenger's.
# This is also the check that actually distinguishes the fix from no fix at
# all: a pre-existing unique index already guarantees CONTRA1==1 and
# REV1=='t' regardless of whether the lock exists (see SABOTAGE 3 below,
# which reproduces exactly those two values with the fix removed) -- the
# clean-error/no-raw-race counts are what the lock specifically buys.
CLEAN_ERR_1=0
grep -q 'entry already reversed' "$WORK/check1_hold.log" && CLEAN_ERR_1=$((CLEAN_ERR_1 + 1))
grep -q 'entry already reversed' "$WORK/check1_plain.log" && CLEAN_ERR_1=$((CLEAN_ERR_1 + 1))
RAW_RACE_1=0
grep -q 'duplicate key value violates unique constraint' "$WORK/check1_hold.log" && RAW_RACE_1=$((RAW_RACE_1 + 1))
grep -q 'duplicate key value violates unique constraint' "$WORK/check1_plain.log" && RAW_RACE_1=$((RAW_RACE_1 + 1))

record "check1: exactly one of the two concurrent reversals succeeds" "$RC_SUM" "1"
record "check1: exactly one contra entry posted" "$CONTRA1" "1"
record "check1: original entry is_reversed exactly once" "$REV1" "t"
record "check1: exactly one session gets the clean 'already reversed' error" "$CLEAN_ERR_1" "1"
record "check1: neither session hits the raw unique-constraint race" "$RAW_RACE_1" "0"
record "check1: challenger was actually blocked by the lock (>=1s wall-clock)" "$([[ $CHALLENGER_ELAPSED -ge 1 ]] && echo yes || echo no)" "yes"
if [[ "$CONTRA1" != "1" || "$REV1" != "t" || "$RC_SUM" != "1" || "$CLEAN_ERR_1" != "1" || "$RAW_RACE_1" != "0" ]]; then
  echo "--- check 1 diagnostics --- (challenger elapsed ${CHALLENGER_ELAPSED}s)"
  echo "holder log:"; cat "$WORK/check1_hold.log"
  echo "challenger log:"; cat "$WORK/check1_plain.log"
fi

# ============================================================================
# 2. FIXED: two pending journal_reversal requests against the same
#    OVER-threshold entry (finding 2's setup), approved concurrently by two
#    different reviewers -- exactly one approves+posts, the other ends up
#    cleanly status='rejected', never stuck at 'pending'.
# ============================================================================
ENTRY2="$(post_entry "$REQUESTER" 55000000)"
if [[ -z "$ENTRY2" ]]; then echo "check 2 fixture: could not post entry2" >&2; exit 1; fi

REQ1="$("${PSQL_READ[@]}" -v actor="$REQUESTER" -v entry="$ENTRY2" <<'SQL'
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true) as ignored \gset
select (public.finance_reverse_journal(:'entry'::uuid, 'dup request 1'))->>'request_id';
commit;
SQL
)"
REQ2="$("${PSQL_READ[@]}" -v actor="$REQUESTER" -v entry="$ENTRY2" <<'SQL'
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true) as ignored \gset
select (public.finance_reverse_journal(:'entry'::uuid, 'dup request 2'))->>'request_id';
commit;
SQL
)"
if [[ -z "$REQ1" || -z "$REQ2" || "$REQ1" == "$REQ2" ]]; then
  echo "check 2 fixture: expected two distinct pending requests, got '$REQ1' and '$REQ2'" >&2
  exit 1
fi

race_approve check2 "$REQ1" "$REQ2" "$REVIEWER_B" "$REVIEWER_C"
STATUS1="$(request_status "$REQ1")"
STATUS2="$(request_status "$REQ2")"
IFS='|' read -r CONTRA2 REV2 <<<"$(entry_state "$ENTRY2")"

APPROVED_COUNT=0; REJECTED_COUNT=0; PENDING_COUNT=0
for s in "$STATUS1" "$STATUS2"; do
  case "$s" in
    approved) APPROVED_COUNT=$((APPROVED_COUNT + 1)) ;;
    rejected) REJECTED_COUNT=$((REJECTED_COUNT + 1)) ;;
    pending)  PENDING_COUNT=$((PENDING_COUNT + 1)) ;;
  esac
done

# Read back whichever of the two requests actually landed 'rejected' --
# don't assume it's the challenger's; role assignment isn't guaranteed by
# the stagger alone (see race_reverse's header). Both approve_hold.sql and
# approve_plain.sql pass the same reviewer note ('reviewer confirmed'), so
# whichever one was auto-rejected must show BOTH the system's own reason
# and that note -- proving the note is appended, not substituted for the
# explanation (the exact bug this migration fixes in that code path).
REJECTED_REQ=""
[[ "$STATUS1" == "rejected" ]] && REJECTED_REQ="$REQ1"
[[ "$STATUS2" == "rejected" ]] && REJECTED_REQ="$REQ2"
REJECTED_NOTE=""
[[ -n "$REJECTED_REQ" ]] && REJECTED_NOTE="$(request_review_note "$REJECTED_REQ")"

record "check2: exactly one request approved" "$APPROVED_COUNT" "1"
record "check2: exactly one request cleanly rejected" "$REJECTED_COUNT" "1"
record "check2: no request left stuck pending" "$PENDING_COUNT" "0"
record "check2: exactly one contra entry posted" "$CONTRA2" "1"
record "check2: original entry is_reversed exactly once" "$REV2" "t"
record "check2: rejected request's review_note names the reason" \
  "$([[ "$REJECTED_NOTE" == *entry_already_reversed* ]] && echo yes || echo no)" "yes"
record "check2: rejected request's review_note keeps the reviewer's own note too" \
  "$([[ "$REJECTED_NOTE" == *"reviewer confirmed"* ]] && echo yes || echo no)" "yes"
record "check2: challenger was actually blocked by the lock (>=1s wall-clock)" \
  "$([[ $CHALLENGER_ELAPSED -ge 1 ]] && echo yes || echo no)" "yes"
if [[ "$APPROVED_COUNT" != "1" || "$REJECTED_COUNT" != "1" || "$PENDING_COUNT" != "0" ]]; then
  echo "--- check 2 diagnostics --- (req1=$REQ1 status=$STATUS1, req2=$REQ2 status=$STATUS2, review_note=$REJECTED_NOTE)"
  echo "holder log:"; cat "$WORK/check2_hold.log"
  echo "challenger log:"; cat "$WORK/check2_plain.log"
fi

# ============================================================================
# 3. SABOTAGE: revert finance_reverse_entry + finance_reverse_journal to
#    their pre-fix (no FOR UPDATE) bodies. A fresh under-threshold entry
#    should show the race reopen -- NOT as a second contra posting (a
#    pre-existing unique index prevents that regardless -- see the header),
#    but as a raw, unhandled unique-constraint-violation error surfacing to
#    the challenger instead of the clean "entry already reversed" the fix
#    produces. Proves check 1 was discriminating on the lock, not on
#    scheduling luck.
# ============================================================================
"${PSQL_SETUP[@]}" <<'SQL'
-- Exact pre-fix (live before 20260922181900) bodies -- no FOR UPDATE anywhere.
create or replace function private.finance_reverse_entry(
  p_entry uuid, p_reason text, p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $body$
declare
  v_orig public.finance_journal_entries%rowtype;
  v_new uuid;
  v_lines jsonb;
begin
  select * into v_orig from public.finance_journal_entries where id = p_entry;
  if v_orig.id is null then raise exception 'entry not found'; end if;
  if v_orig.is_reversed then raise exception 'entry already reversed'; end if;

  select jsonb_agg(jsonb_build_object(
    'account_code', account_code,
    'debit_minor', credit_minor,
    'credit_minor', debit_minor,
    'organisation_id', organisation_id,
    'counterparty', counterparty,
    'cost_center_code', cost_center_code,
    'memo', 'Reversal: ' || coalesce(memo,'')))
  into v_lines
  from public.finance_journal_lines where entry_id = p_entry;

  v_new := private.finance_post_journal(
    current_date, v_orig.currency, 'adjustment', 'reversal:' || p_entry::text,
    coalesce(p_reason, 'Reversal of #' || v_orig.entry_no), v_lines, p_created_by);

  update public.finance_journal_entries set reversal_of = p_entry where id = v_new;
  update public.finance_journal_entries set is_reversed = true where id = p_entry;
  return v_new;
end; $body$;

create or replace function public.finance_reverse_journal(p_entry uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $body$
declare
  v_id uuid;
  v_req uuid;
  v_max bigint;
  v_threshold bigint;
  v_currency public.currency;
  v_entry_no bigint;
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;

  select currency, entry_no into v_currency, v_entry_no
    from public.finance_journal_entries where id = p_entry;
  if v_currency is null then raise exception 'entry not found'; end if;

  select coalesce(max(greatest(debit_minor, credit_minor)), 0) into v_max
    from public.finance_journal_lines where entry_id = p_entry;
  select threshold_minor into v_threshold from public.finance_approval_settings
    where currency = v_currency;

  if v_threshold is not null and v_max >= v_threshold then
    v_req := private.finance_request_approval('journal_reversal',
      jsonb_build_object('entry_id', p_entry, 'reason', p_reason),
      p_reason);
    perform private.log_audit('finance.journal.reverse_request_approval', 'finance_journal_entries', p_entry,
      jsonb_build_object('amount_minor', v_max, 'currency', v_currency, 'reason', p_reason, 'request_id', v_req));
    return jsonb_build_object('status', 'pending_approval', 'request_id', v_req);
  end if;

  v_id := private.finance_reverse_entry(p_entry, p_reason, (select auth.uid()));
  perform private.log_audit('finance.journal.reverse', 'finance_journal_entries', p_entry,
    jsonb_build_object('reason', p_reason, 'reversal_entry_id', v_id));
  return jsonb_build_object('status', 'reversed', 'entry_id', v_id);
end; $body$;
SQL
if [[ $? -ne 0 ]]; then echo "sabotage 3 setup failed" >&2; exit 1; fi
SABOTAGE_DEPLOYED=1

ENTRY3="$(post_entry "$OFFICER_X" 100000)"
if [[ -z "$ENTRY3" ]]; then
  echo "sabotage 3 fixture: could not post entry3" >&2
  restore_fixed_functions && SABOTAGE_DEPLOYED=0
  exit 1
fi
race_reverse sabotage3 "$ENTRY3" "$OFFICER_X" "$OFFICER_Y"
IFS='|' read -r CONTRA3 REV3 <<<"$(entry_state "$ENTRY3")"
# Checked across BOTH logs, not just the challenger's -- which of {hold,
# plain} actually loses the race is decided by psql connection timing, not
# by the role this script assigned it (see race_reverse's header); grepping
# only the "plain" log risks a false FAIL if timing jitter inverts the
# roles, exactly the kind of flake this rewrite is trying to eliminate.
RAW_RACE_3=0
grep -q 'duplicate key value violates unique constraint' "$WORK/sabotage3_hold.log" && RAW_RACE_3=$((RAW_RACE_3 + 1))
grep -q 'duplicate key value violates unique constraint' "$WORK/sabotage3_plain.log" && RAW_RACE_3=$((RAW_RACE_3 + 1))
CLEAN_ERR_3=0
grep -q 'entry already reversed' "$WORK/sabotage3_hold.log" && CLEAN_ERR_3=$((CLEAN_ERR_3 + 1))
grep -q 'entry already reversed' "$WORK/sabotage3_plain.log" && CLEAN_ERR_3=$((CLEAN_ERR_3 + 1))

# Restore immediately -- checks 4+ must run against the fixed reverse path.
if ! restore_fixed_functions; then
  echo "ABORTING: cannot safely continue past sabotage 3 without confirmed-restored functions." >&2
  exit 1
fi
SABOTAGE_DEPLOYED=0

record "SABOTAGE 3: ledger stays safe regardless (still exactly one contra entry)" "$CONTRA3" "1"
record "SABOTAGE 3: exactly one session hits the raw race (unique-constraint violation)" "$RAW_RACE_3" "1"
record "SABOTAGE 3: neither session gets the fix's clean 'already reversed' message" "$CLEAN_ERR_3" "0"
if [[ "$CONTRA3" != "1" || "$RAW_RACE_3" != "1" || "$CLEAN_ERR_3" != "0" ]]; then
  echo "VACUOUS TEST WARNING: sabotaging finance_reverse_entry/finance_reverse_journal did not reproduce the expected raw race -- check 1 may be passing for an unrelated reason." >&2
  echo "holder log:"; cat "$WORK/sabotage3_hold.log"
  echo "challenger log:"; cat "$WORK/sabotage3_plain.log"
fi

# ============================================================================
# 4. SABOTAGE: revert ONLY finance_approve_request to its pre-fix body
#    (finance_reverse_entry/finance_reverse_journal stay fixed, isolating
#    finding 2). A fresh over-threshold entry's duplicate-request scenario
#    should now leave one request stuck at status='pending' with an error.
# ============================================================================
"${PSQL_SETUP[@]}" <<'SQL'
-- Exact pre-fix (live before 20260922181900) body -- no is_reversed
-- pre-check before calling finance_reverse_entry in the journal_reversal
-- branch. finance_reverse_entry/finance_reverse_journal are untouched here
-- (still fixed), isolating finding 2 from finding 1.
create or replace function public.finance_approve_request(p_id uuid, p_note text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $body$
declare
  r public.finance_approval_requests%rowtype;
  v_entry uuid;
  v_month date;
begin
  if not private.finance_can('finance.approvals.manage') then raise exception 'not authorised'; end if;
  select * into r from public.finance_approval_requests where id = p_id for update;
  if r.id is null then raise exception 'approval request not found'; end if;
  if r.status <> 'pending' then raise exception 'request already reviewed'; end if;
  if r.requested_by = (select auth.uid()) then
    raise exception 'a different finance officer must approve this request' using errcode = 'check_violation';
  end if;

  if r.request_type = 'manual_journal' then
    v_entry := private.finance_post_journal(
      (r.payload->>'entry_date')::date, coalesce(r.payload->>'currency', 'NGN')::public.currency,
      'manual', null, r.payload->>'memo', r.payload->'lines', r.requested_by);
    perform private.log_audit('finance.journal.post', 'finance_journal_entries', v_entry,
      jsonb_build_object('via_approval', p_id, 'memo', r.payload->>'memo'));
  elsif r.request_type = 'journal_reversal' then
    v_entry := private.finance_reverse_entry((r.payload->>'entry_id')::uuid, r.payload->>'reason', r.requested_by);
    perform private.log_audit('finance.journal.reverse', 'finance_journal_entries', (r.payload->>'entry_id')::uuid,
      jsonb_build_object('via_approval', p_id, 'reversal_entry_id', v_entry, 'reason', r.payload->>'reason'));
  elsif r.request_type = 'period_lock' then
    v_month := (r.payload->>'period_month')::date;
    insert into public.finance_periods (period_month, status, closed_at, closed_by, locked_at, locked_by)
    values (v_month, 'locked', now(), (select auth.uid()), now(), (select auth.uid()))
    on conflict (period_month) do update set
      status = 'locked',
      closed_at = coalesce(public.finance_periods.closed_at, now()),
      closed_by = coalesce(public.finance_periods.closed_by, (select auth.uid())),
      locked_at = now(), locked_by = (select auth.uid());
    perform private.log_audit('finance.period.lock', 'finance_periods', null,
      jsonb_build_object('period_month', v_month, 'via_approval', p_id));
  end if;

  update public.finance_approval_requests set
    status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = now(),
    review_note = p_note, result_entry_id = v_entry
  where id = p_id;

  perform private.log_audit('finance.approval.approve', 'finance_approval_requests', p_id,
    jsonb_build_object('request_type', r.request_type, 'note', p_note));
  return jsonb_build_object('status', 'approved', 'entry_id', v_entry);
end; $body$;
SQL
if [[ $? -ne 0 ]]; then echo "sabotage 4 setup failed" >&2; exit 1; fi
SABOTAGE_DEPLOYED=1

ENTRY4="$(post_entry "$REQUESTER" 55000000)"
if [[ -z "$ENTRY4" ]]; then
  echo "sabotage 4 fixture: could not post entry4" >&2
  restore_fixed_functions && SABOTAGE_DEPLOYED=0
  exit 1
fi
REQ3="$("${PSQL_READ[@]}" -v actor="$REQUESTER" -v entry="$ENTRY4" <<'SQL'
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true) as ignored \gset
select (public.finance_reverse_journal(:'entry'::uuid, 'dup request 3'))->>'request_id';
commit;
SQL
)"
REQ4="$("${PSQL_READ[@]}" -v actor="$REQUESTER" -v entry="$ENTRY4" <<'SQL'
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'actor', 'role', 'authenticated')::text, true) as ignored \gset
select (public.finance_reverse_journal(:'entry'::uuid, 'dup request 4'))->>'request_id';
commit;
SQL
)"
if [[ -z "$REQ3" || -z "$REQ4" || "$REQ3" == "$REQ4" ]]; then
  echo "sabotage 4 fixture: expected two distinct pending requests, got '$REQ3' and '$REQ4'" >&2
  restore_fixed_functions && SABOTAGE_DEPLOYED=0
  exit 1
fi

race_approve sabotage4 "$REQ3" "$REQ4" "$REVIEWER_B" "$REVIEWER_C"
STATUS3="$(request_status "$REQ3")"
STATUS4="$(request_status "$REQ4")"

# Restore immediately, success or failure of the assertion below.
if ! restore_fixed_functions; then
  echo "ABORTING: cannot safely continue without confirming finance_approve_request is restored." >&2
  exit 1
fi
SABOTAGE_DEPLOYED=0

STUCK_PENDING_4=0
for s in "$STATUS3" "$STATUS4"; do
  [[ "$s" == "pending" ]] && STUCK_PENDING_4=$((STUCK_PENDING_4 + 1))
done
record "SABOTAGE 4: reverting the approve-time is_reversed check leaves a request stuck pending" "$STUCK_PENDING_4" "1"
if [[ "$STUCK_PENDING_4" != "1" ]]; then
  echo "VACUOUS TEST WARNING: sabotaging finance_approve_request did not reproduce a stuck pending request (req3=$REQ3 status=$STATUS3, req4=$REQ4 status=$STATUS4) -- check 2 may be passing for an unrelated reason." >&2
  echo "holder log:"; cat "$WORK/sabotage4_hold.log"
  echo "challenger log:"; cat "$WORK/sabotage4_plain.log"
fi

# ============================================================================
# cleanup() (the EXIT trap) prints the RESULTS table and the pass/fail
# summary, in that order, on every exit path -- including an early one --
# so nothing here needs to duplicate it. Just set the real exit code.
[[ $FAIL_COUNT -gt 0 ]] && exit 1
exit 0
