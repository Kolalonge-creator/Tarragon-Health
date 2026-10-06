#!/usr/bin/env bash
# ============================================================================
# S17 safety case 18: two clinicians pressing "Next task" at the same moment never receive the same task.
# 50 real, concurrent database sessions call public.queue_next() as 50 different clinicians.
#
# WHY A .sh PROOF. A single psql session cannot race itself, so the BEGIN/ROLLBACK .sql proofs cannot show that
# FOR UPDATE SKIP LOCKED actually keeps two sessions off the same row. This script commits its fixtures, launches
# the sessions behind a start barrier (each sleeps until the same wall-clock instant), and checks the outcome.
#
# WHAT IT PROVES
#  1. 50 callers, 30 open tasks: exactly 30 claims, no task claimed twice, no caller holds two, 20 callers are told
#     there is nothing eligible, and none gets an error.
#  2. 50 callers, ONE task: exactly one winner, 49 told nothing eligible, none an error.
#  3. SABOTAGE (control): a deliberately naive picker (read the best task, then claim it, no lock) run through the same
#     harness must lose the race: at least one caller errors on the guard. If it does not, the harness is not
#     producing real contention and checks 1 and 2 would prove nothing, so the script fails as VACUOUS.
#
# SAFETY. It commits fixtures and drops a test-only function, so it refuses to run unless $DATABASE_URL looks local
# (same guard and override phrase as finance_reversal_concurrent_lock.sh). Fixtures are removed by an EXIT trap.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${S17_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "s17_queue_concurrent_claim: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "Got: $DB_URL" >&2
  echo "This proof commits fixtures. If this really is a throwaway stack, set S17_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

N_CALLERS=50
N_TASKS=30
WORK="$(mktemp -d)"
TAG="s17cc-$$-$(date +%s)"
psql_q() { psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  psql_q <<SQL >/dev/null 2>&1
set session_replication_role = replica;   -- local, disposable database: the logs are append only, so delete without their triggers
drop function if exists public.s17_queue_next_naive();
delete from public.clinician_reliability_events where clinician_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.task_handbacks where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like '$TAG%'));
delete from public.task_claims where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like '$TAG%'));
delete from public.clinical_task_transitions where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like '$TAG%'));
delete from public.domain_events where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.audit_log where actor_id in (select id from public.profiles where full_name like '$TAG%') or entity_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like '$TAG%'));
delete from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.availability_blocks where clinician_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.clinician_competencies where clinical_staff_id in (select id from public.clinical_staff where full_name like '$TAG%');
delete from public.clinical_staff where full_name like '$TAG%';
delete from auth.users where id in (select id from public.profiles where full_name like '$TAG%');
delete from public.profiles where full_name like '$TAG%';
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
declare v_org uuid; v_admin uuid := gen_random_uuid(); v_u uuid; v_s uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_admin, '$TAG-admin@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
    values (v_admin, v_org, 'admin', '$TAG admin', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
  for i in 1..$N_CALLERS loop
    v_u := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_u, '$TAG-doc-' || i || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
      values (v_u, v_org, 'clinician', '$TAG doc ' || i, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at,
        verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
      values (v_org, v_u, '$TAG doc ' || i, 'MDCN', '$TAG-' || i, true, 'active', now(), v_admin, 'senior_medical_officer', 'contracted', 2, true, v_admin, true)
      returning id into v_s;
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (v_org, v_s, 'hypertension', v_admin, true);
    insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
      values (v_org, v_u, now() - interval '1 minute', now() + interval '3 hours', 'queue', true);
  end loop;
  for i in 1..$N_TASKS loop
    v_u := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_u, '$TAG-pat-' || i || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
      values (v_u, v_org, 'patient', '$TAG pat ' || i, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
  end loop;
end \$\$;
SQL

mapfile -t DOCS < <(psql_q -c "select id from public.profiles where full_name like '$TAG doc %' order by full_name")
mapfile -t PATS < <(psql_q -c "select id from public.profiles where full_name like '$TAG pat %' order by full_name")
[[ ${#DOCS[@]} -eq $N_CALLERS && ${#PATS[@]} -eq $N_TASKS ]] || fail "fixture counts wrong (${#DOCS[@]} clinicians, ${#PATS[@]} patients)"

make_tasks() { # $1 = how many
  local n=$1 i
  for ((i = 0; i < n; i++)); do
    psql_q -c "select private.create_clinical_task('${PATS[$i]}', 'amber_bp_review', $((300 + i)))" >/dev/null || fail "could not create task $i"
  done
}
clear_tasks() {
  psql_q <<SQL >/dev/null || fail "could not clear tasks"
do \$\$ declare r record; begin
  for r in select t.id from public.clinical_tasks t join public.profiles p on p.id = t.patient_id where p.full_name like '$TAG pat %' and t.state not in ('completed', 'cancelled') loop
    update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = r.id and ended_at is null;
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'concurrency proof cleanup');
  end loop;
end \$\$;
SQL
}

# one round: all callers released at the same instant. $1 = function to call, writes $WORK/out.<i>
race() {
  local fn=$1 i t0
  rm -f "$WORK"/out.*
  t0=$(python3 -c 'import time; print(time.time() + 4)')
  for ((i = 0; i < N_CALLERS; i++)); do
    (
      printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\nselect pg_sleep(greatest(0, %s - extract(epoch from clock_timestamp())));\nselect coalesce(%s -> 'task' ->> 'id', 'none');\ncommit;\n" \
        "${DOCS[$i]}" "$t0" "$fn" | psql "$DB_URL" -X -q -t -A 2>&1 | grep -v '^$' | tail -n 1 > "$WORK/out.$i"
    ) &
  done
  wait
}

summarise() { # prints: claimed distinct duplicated none errors
  cat "$WORK"/out.* | awk '
    /^[0-9a-f]{8}-/ { c++; seen[$0]++; if (seen[$0] > 1) d++; next }
    /^none$/ { n++; next }
    { e++ }
    END { printf "%d %d %d %d %d\n", c, length(seen), d, n, e }'
}

# --- 1. 50 callers, 30 tasks --------------------------------------------------------------------------------------
make_tasks $N_TASKS
race "public.queue_next()"
read -r claimed distinct dup none errs < <(summarise)
[[ "$claimed" -eq $N_TASKS ]] || fail "round 1: expected $N_TASKS claims, got $claimed"
[[ "$dup" -eq 0 && "$distinct" -eq "$claimed" ]] || fail "round 1: a task was handed out twice ($dup duplicates)"
[[ "$errs" -eq 0 ]] || fail "round 1: $errs callers got an error"
[[ "$none" -eq $((N_CALLERS - N_TASKS)) ]] || fail "round 1: expected $((N_CALLERS - N_TASKS)) callers told none, got $none"
live=$(psql_q -c "select count(*) from public.task_claims c join public.clinical_tasks t on t.id = c.task_id join public.profiles p on p.id = t.patient_id where p.full_name like '$TAG pat %' and c.ended_at is null")
dbl=$(psql_q -c "select count(*) from (select clinician_id from public.task_claims where clinician_id in (select id from public.profiles where full_name like '$TAG doc %') and ended_at is null group by 1 having count(*) > 1) x")
[[ "$live" -eq $N_TASKS && "$dbl" -eq 0 ]] || fail "round 1: database shows $live live claims and $dbl callers holding two"
pass "50 callers, 30 tasks: 30 claims, 0 duplicates, 20 told none, 0 errors"
clear_tasks

# --- 2. 50 callers, one task --------------------------------------------------------------------------------------
make_tasks 1
race "public.queue_next()"
read -r claimed distinct dup none errs < <(summarise)
[[ "$claimed" -eq 1 && "$errs" -eq 0 && "$none" -eq $((N_CALLERS - 1)) ]] || fail "round 2: expected 1 winner, $((N_CALLERS - 1)) none, 0 errors; got $claimed / $none / $errs"
pass "50 callers, 1 task: exactly one winner, 49 told none, 0 errors"
clear_tasks

# --- 3. SABOTAGE control: a naive picker with no lock must lose the race ------------------------------------------
psql_q <<'SQL' || fail "could not create the naive picker"
create or replace function public.s17_queue_next_naive() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); t public.clinical_tasks%rowtype; v_exp timestamptz := now() + interval '30 minutes';
begin
  select ct.* into t from public.clinical_tasks ct join private.queue_candidates(v_uid, false) c on c.id = ct.id
   where ct.state in ('open', 'offered_to_lead') order by c.priority_class, c.due_at, c.created_at limit 1;   -- no FOR UPDATE SKIP LOCKED
  if t.id is null then return jsonb_build_object('task', null); end if;
  perform pg_sleep(0.05);
  perform private.apply_task_transition(t.id, 'claimed', 'clinician', v_uid, 'claimed', v_uid, v_exp);
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test) values (t.organisation_id, t.id, v_uid, v_exp, t.is_test);
  return jsonb_build_object('task', jsonb_build_object('id', t.id));
end $$;
grant execute on function public.s17_queue_next_naive() to authenticated;
SQL
make_tasks 1
race "public.s17_queue_next_naive()"
read -r claimed distinct dup none errs < <(summarise)
if [[ "$errs" -eq 0 ]]; then
  fail "VACUOUS: the naive picker raced with no errors, so this harness does not create real contention"
fi
pass "control: a lock-free picker made $errs of $N_CALLERS callers fail on the guard, so the race is real"
clear_tasks

printf '%s\n' "${PASS_LINES[@]}"
