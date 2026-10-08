#!/usr/bin/env bash
# ============================================================================
# S41 acceptance test (spec Module 1): a cohort code whose max_uses is reached is rejected, even when the claims arrive at
# the same moment. 30 real, concurrent database sessions each call public.join_cohort() as a different patient against a
# code with max_uses = 5.
#
# WHY A .sh PROOF. A single psql session cannot race itself, so a BEGIN/ROLLBACK .sql proof cannot show that the row lock in
# join_cohort (select ... for update) actually keeps two sessions from taking the last place. This script commits its
# fixtures, launches the sessions behind a start barrier (each sleeps until the same wall-clock instant) and checks the result.
#
# WHAT IT PROVES
#  1. 30 callers, max_uses 5: exactly 5 joined, 25 refused with the same plain {ok:false}, none got an error,
#     sponsor_cohorts.uses = 5 and exactly 5 profile_cohorts rows exist (never 6).
#  2. A returning member re-enters a full programme (their place is theirs), a newcomer still cannot.
#  3. SABOTAGE (control): a deliberately lock-free version of the join, run through the same harness, must break the limit
#     (over-subscribed, a lost update on uses, or an error on the guard). If it does not, the harness is not producing real
#     contention and check 1 would prove nothing, so the script fails as VACUOUS.
#
# DEPENDENCY. join_cohort comes from S38e (PR #988). Until that migration is on the branch under test this script prints
# SKIPPED (not PASS) and exits 0, so main-dev CI stays green; the first CI run after #988 merges runs it for real.
#
# SAFETY. It commits fixtures and creates a test-only function, so it refuses to run unless $DATABASE_URL looks local (same
# guard and override phrase as s17_queue_concurrent_claim.sh). Fixtures are removed by an EXIT trap.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${S41_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "s41_cohort_max_uses_concurrent: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "Got: $DB_URL" >&2
  echo "This proof commits fixtures. If this really is a throwaway stack, set S41_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

N_CALLERS=30
MAX_USES=5
WORK="$(mktemp -d)"
TAG="s41cc-$$-$(date +%s)"
psql_q() { psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

if [[ "$(psql_q -c "select to_regprocedure('public.join_cohort(text)') is not null")" != "t" ]]; then
  echo "SKIPPED | join_cohort(text) does not exist on this database (S38e, PR #988, is not applied). Not a pass."
  rm -rf "$WORK"
  exit 0
fi

cleanup() {
  psql_q <<SQL >/dev/null 2>&1
set session_replication_role = replica;   -- local, disposable database: delete without append-only triggers
drop function if exists public.s41_join_naive(text);
delete from public.profile_cohorts where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.cohort_join_attempts where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.sponsor_cohorts where name like '$TAG%';
delete from public.audit_log where actor_id in (select id from public.profiles where full_name like '$TAG%');
delete from auth.users where id in (select id from public.profiles where full_name like '$TAG%');
delete from public.profiles where full_name like '$TAG%';
delete from public.organisations where name like '$TAG%';
SQL
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "FAIL | $1" >&2; exit 1; }
PASS_LINES=()
pass() { PASS_LINES+=("PASS | $1"); }

# --- fixtures (committed) -----------------------------------------------------------------------------------------
psql_q <<SQL || fail "could not create fixtures"
do \$\$
declare v_org uuid; v_sp uuid := gen_random_uuid(); v_u uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.organisations (id, name, type) values (v_sp, '$TAG sponsor', 'corporate');
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses, is_test)
    values (v_org, v_sp, '$TAG cohort', 'CCCCCCC2', current_date - 1, current_date + 30, $MAX_USES, true);
  for i in 1..$((N_CALLERS + 1)) loop
    v_u := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_u, '$TAG-pat-' || i || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
      values (v_u, v_org, 'patient', '$TAG pat ' || lpad(i::text, 2, '0'), '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
      phone = excluded.phone, is_test = true, is_active = true;
  end loop;
end \$\$;
SQL

PATS=(); while IFS= read -r line; do [[ -n "$line" ]] && PATS+=("$line"); done < <(psql_q -c "select id from public.profiles where full_name like '$TAG pat %' order by full_name")
[[ ${#PATS[@]} -eq $((N_CALLERS + 1)) ]] || fail "fixture count wrong (${#PATS[@]} patients)"

race() { # $1 = function to call; callers are PATS[0..N_CALLERS-1]; writes $WORK/out.<i>
  local fn=$1 i t0
  rm -f "$WORK"/out.*
  t0=$(python3 -c 'import time; print(time.time() + 4)')
  for ((i = 0; i < N_CALLERS; i++)); do
    (
      printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\nselect pg_sleep(greatest(0, %s - extract(epoch from clock_timestamp())));\nselect coalesce(%s(%s) ->> 'status', 'refused');\ncommit;\n" \
        "${PATS[$i]}" "$t0" "$fn" "'CCCCCCC2'" | psql "$DB_URL" -X -q -t -A 2>&1 | grep -v '^$' | tail -n 1 > "$WORK/out.$i"
    ) &
  done
  wait
}

summarise() { # prints: joined refused errors
  cat "$WORK"/out.* | awk '/^joined$/ { j++; next } /^refused$/ { r++; next } { e++ } END { printf "%d %d %d\n", j, r, e }'
}

counts() { # prints: uses members
  psql_q -c "select c.uses || ' ' || (select count(*) from public.profile_cohorts m where m.cohort_id = c.id) from public.sponsor_cohorts c where c.name = '$TAG cohort'"
}

# --- 1. 30 callers, 5 places ---------------------------------------------------------------------------------------
race "public.join_cohort"
read -r joined refused errs < <(summarise)
[[ "$errs" -eq 0 ]] || fail "round 1: $errs callers got an error"
[[ "$joined" -eq $MAX_USES ]] || fail "round 1: expected $MAX_USES to join, $joined did"
[[ "$refused" -eq $((N_CALLERS - MAX_USES)) ]] || fail "round 1: expected $((N_CALLERS - MAX_USES)) refused, got $refused"
read -r uses members < <(counts)
[[ "$uses" -eq $MAX_USES && "$members" -eq $MAX_USES ]] || fail "round 1: database shows uses=$uses members=$members, expected $MAX_USES for both"
pass "30 callers, max_uses 5: 5 joined, 25 refused, 0 errors, uses=5 and 5 members (never 6)"

# --- 2. a returning member re-enters, a newcomer does not ----------------------------------------------------------
member=$(psql_q -c "select patient_id from public.profile_cohorts m join public.sponsor_cohorts c on c.id = m.cohort_id where c.name = '$TAG cohort' order by joined_at limit 1")
r_again=$(printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\nselect public.join_cohort('CCCCCCC2') ->> 'status';\ncommit;\n" "$member" | psql "$DB_URL" -X -q -t -A | grep -v '^$' | tail -n 1)
[[ "$r_again" == "already" ]] || fail "round 2: a member joining again should be told 'already', got '$r_again'"
newcomer="${PATS[$N_CALLERS]}"
r_new=$(printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\nselect coalesce(public.join_cohort('CCCCCCC2') ->> 'status', 'refused');\ncommit;\n" "$newcomer" | psql "$DB_URL" -X -q -t -A | grep -v '^$' | tail -n 1)
[[ "$r_new" == "refused" ]] || fail "round 2: a newcomer to a full programme should be refused, got '$r_new'"
read -r uses members < <(counts)
[[ "$uses" -eq $MAX_USES && "$members" -eq $MAX_USES ]] || fail "round 2: counts moved (uses=$uses members=$members)"
pass "a member is told 'already' on a full programme, a newcomer is refused, counts unchanged"

# --- 3. SABOTAGE control: a lock-free join must break the limit ----------------------------------------------------
psql_q <<'SQL' || fail "could not create the naive join"
create or replace function public.s41_join_naive(p_code text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v uuid := (select auth.uid()); c public.sponsor_cohorts%rowtype; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = v;
  select * into c from public.sponsor_cohorts where code = upper(p_code);          -- no FOR UPDATE: the bug under test
  if c.uses >= c.max_uses then return jsonb_build_object('ok', false); end if;
  perform pg_sleep(0.05);
  insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, is_test) values (p.organisation_id, v, c.id, true);
  update public.sponsor_cohorts set uses = c.uses + 1 where id = c.id;             -- stale read: lost updates
  return jsonb_build_object('ok', true, 'status', 'joined');
end $$;
grant execute on function public.s41_join_naive(text) to authenticated;
SQL
# reset the cohort to empty so the control starts from the same place
psql_q -c "delete from public.profile_cohorts where cohort_id in (select id from public.sponsor_cohorts where name = '$TAG cohort'); update public.sponsor_cohorts set uses = 0 where name = '$TAG cohort'" >/dev/null || fail "could not reset the cohort"
race "public.s41_join_naive"
read -r joined refused errs < <(summarise)
read -r uses members < <(counts)
if [[ "$errs" -eq 0 && "$members" -le $MAX_USES && "$uses" -eq "$members" ]]; then
  fail "VACUOUS: the lock-free join raced with no error, no over-subscription and no lost update, so this harness does not create real contention"
fi
pass "control: a lock-free join broke the limit (errors=$errs, members=$members, uses=$uses, max=$MAX_USES), so the race is real"

printf '%s\n' "${PASS_LINES[@]}"
