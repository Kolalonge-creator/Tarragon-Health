#!/usr/bin/env bash
# ============================================================================
# S19: an acknowledgement racing the escalation sweep never leaves a page family half acknowledged, never pages the backup
# twice, and never makes two tasks. Two real, concurrent database sessions per round: the paged primary calls
# public.acknowledge_page() while private.sweep_pages() runs on a page that is already past its first escalation time.
#
# WHY A .sh PROOF. A single psql session cannot race itself, so the BEGIN/ROLLBACK .sql proofs cannot show that the shared
# row lock (the sweep's FOR UPDATE SKIP LOCKED against acknowledge_page's FOR UPDATE) really serialises the two. This script
# commits its fixtures, releases both sessions at the same wall-clock instant, and checks the outcome. Either order is fine;
# what must never happen is a family where the root is acknowledged but a child page is not, a second backup, or a second task.
#
# WHAT IT PROVES
#  1. ROUNDS rounds of (acknowledge, sweep) at the same instant: in every round every page of the family is acknowledged, at most
#     one backup page exists, and at most one red_event_unacknowledged task exists.
#  2. SABOTAGE (control): a deliberately naive sweep (reads the page without a lock, pauses, then pages the backup) run against the
#     same acknowledgement must produce at least one half-acknowledged family. If it never does, the harness is not producing
#     real contention and check 1 would prove nothing, so the script fails as VACUOUS.
#
# SAFETY. It commits fixtures and drops a test-only function, so it refuses to run unless $DATABASE_URL looks local
# (same guard and override phrase as s17_queue_concurrent_claim.sh). Fixtures are removed by an EXIT trap.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${S19_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "s19_page_ack_sweep_race: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "Got: $DB_URL" >&2
  echo "This proof commits fixtures. If this really is a throwaway stack, set S19_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

ROUNDS=12
WORK="$(mktemp -d)"
TAG="s19rc-$$-$(date +%s)"
psql_q() { psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  psql_q <<SQL >/dev/null 2>&1
set session_replication_role = replica;   -- local, disposable database: several of these logs are append only
drop function if exists public.s19_sweep_naive(uuid);
delete from public.notifications where recipient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.clinical_task_transitions where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like '$TAG%'));
delete from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.pages where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.triage_events where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.triage_rule_sets where code = '$TAG';
delete from public.domain_events where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.audit_log where actor_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.on_call_rota where primary_clinician_id in (select id from public.profiles where full_name like '$TAG%');
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

# --- fixtures (committed): an admin, a chief medical officer, a primary and a backup on call, one patient ------------------
psql_q <<SQL || fail "could not create fixtures"
do \$\$
declare v_org uuid; v_admin uuid := gen_random_uuid(); v_cmo uuid := gen_random_uuid(); v_p uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
        v_pt uuid := gen_random_uuid(); v_staff uuid; r record;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  update public.clinical_staff set active = false where is_test is not true;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    select x, '$TAG-' || x || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_admin, v_cmo, v_p, v_b, v_pt]) x;
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test) values
    (v_admin, v_org, 'admin', '$TAG admin', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true),
    (v_pt, v_org, 'patient', '$TAG patient', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
  for r in select * from (values (v_cmo, 'cmo', 'chief_medical_officer'), (v_p, 'primary', 'senior_medical_officer'), (v_b, 'backup', 'senior_medical_officer')) t(id, label, tier) loop
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
      values (r.id, v_org, 'clinician', '$TAG ' || r.label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at,
        verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
      values (v_org, r.id, '$TAG ' || r.label, 'MDCN', '$TAG-' || r.label, true, 'active', now(), v_admin, r.tier::public.doctor_tier,
              case when r.tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
              r.tier = 'chief_medical_officer', case when r.tier = 'chief_medical_officer' then v_admin end, true)
      returning id into v_staff;
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (v_org, v_staff, 'on_call', v_admin, true);
  end loop;
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('$TAG', 1, 'approved', '{}'::jsonb, v_cmo, now(), 'S19 race proof fixture');
  -- the rota row is written the way the application writes it: through the function, as the chief medical officer
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '6 hours', v_p, v_b, null);
  reset role;
end \$\$;
SQL

PRIMARY=$(psql_q -c "select id from public.profiles where full_name = '$TAG primary'")
PATIENT=$(psql_q -c "select id from public.profiles where full_name = '$TAG patient'")
[[ -n "$PRIMARY" && -n "$PATIENT" ]] || fail "fixture ids missing"

# a fresh red page, already six minutes old (past the first escalation time). Prints its id.
new_page() {
  psql_q <<SQL
do \$\$
declare v_ev uuid; v_root uuid; v_rs public.triage_rule_sets%rowtype;
begin
  select * into v_rs from public.triage_rule_sets where code = '$TAG';
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    select organisation_id, id, 'observation', gen_random_uuid(), 'red', 'R1', v_rs.id, v_rs.code, v_rs.version, v_rs.status, '[{"kind":"page_on_call"}]'::jsonb, false, true, gen_random_uuid()::text
      from public.profiles where id = '$PATIENT' returning id into v_ev;
  v_root := public.create_red_page(v_ev);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - interval '6 minutes' where id = v_root;
  perform set_config('tarragon.paging_write', 'off', true);
  raise notice 'ROOT %', v_root;
end \$\$;
SQL
}
root_of_last() { psql_q -c "select id from public.pages where patient_id = '$PATIENT' and parent_page_id is null order by created_at desc limit 1"; }

# one race: the primary acknowledges and a sweep runs, both released at the same wall-clock instant. $1 = root id, $2 = sweep call
race() {
  local root=$1 sweep=$2 t0
  t0=$(python3 -c 'import time; print(time.time() + 3)')
  (
    printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\nselect pg_sleep(greatest(0, %s - extract(epoch from clock_timestamp())));\nselect public.acknowledge_page('%s');\ncommit;\n" "$PRIMARY" "$t0" "$root" | psql "$DB_URL" -X -q -t -A >/dev/null 2>&1
  ) &
  (
    printf "begin;\nselect pg_sleep(greatest(0, %s - extract(epoch from clock_timestamp())));\nselect %s;\ncommit;\n" "$t0" "$sweep" | psql "$DB_URL" -X -q -t -A >/dev/null 2>&1
  ) &
  wait
}

# prints: half_acknowledged backup_children tasks
family_state() {
  psql_q -c "select
      (select count(*) from public.pages x where coalesce(x.parent_page_id, x.id) = '$1' and x.acknowledged_at is null),
      (select count(*) from public.pages x where x.parent_page_id = '$1' and x.role = 'backup'),
      (select count(*) from public.clinical_tasks t where t.patient_id = '$PATIENT' and t.dedup_key = 'page:' || '$1')" | tr '|' ' '
}

# --- 1. real sweep against a real acknowledgement ---------------------------------------------------------------------
bad=0
for ((i = 1; i <= ROUNDS; i++)); do
  new_page >/dev/null 2>&1 || fail "round $i: could not create a page"
  ROOT=$(root_of_last)
  race "$ROOT" "private.sweep_pages()"
  read -r unacked backups tasks < <(family_state "$ROOT")
  [[ "$unacked" -eq 0 ]] || { echo "round $i: $unacked page(s) of the family not acknowledged" >&2; bad=$((bad + 1)); }
  [[ "$backups" -le 1 ]] || { echo "round $i: $backups backup pages" >&2; bad=$((bad + 1)); }
  [[ "$tasks" -le 1 ]] || { echo "round $i: $tasks tasks" >&2; bad=$((bad + 1)); }
done
[[ "$bad" -eq 0 ]] || fail "check 1: $bad violation(s) across $ROUNDS rounds"
pass "$ROUNDS rounds of acknowledge-versus-sweep: every family fully acknowledged, at most one backup page, at most one task"

# --- 2. SABOTAGE control: a lock-free sweep must be able to produce a half-acknowledged family -------------------------------
psql_q <<'SQL' || fail "could not create the naive sweep"
create or replace function public.s19_sweep_naive(p_root uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r public.pages%rowtype; v_backup uuid;
begin
  select * into r from public.pages where id = p_root and acknowledged_at is null and closed_at is null;   -- no FOR UPDATE
  if not found then return; end if;
  perform pg_sleep(1.0);                                                                                   -- the window in which an acknowledgement lands
  select backup_id into v_backup from private.on_call_now(r.organisation_id, r.is_test);
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, parent_page_id, role, to_clinician_id, escalation_level, config_version, is_test)
    values (r.organisation_id, r.patient_id, r.triage_event_id, r.id, 'backup', v_backup, 1, r.config_version, r.is_test);
  perform set_config('tarragon.paging_write', 'off', true);
end $$;
SQL
violations=0
for ((i = 1; i <= 3; i++)); do
  new_page >/dev/null 2>&1 || fail "control round $i: could not create a page"
  ROOT=$(root_of_last)
  race "$ROOT" "public.s19_sweep_naive('$ROOT')"
  read -r unacked backups tasks < <(family_state "$ROOT")
  [[ "$unacked" -gt 0 ]] && violations=$((violations + 1))
done
[[ "$violations" -gt 0 ]] || fail "VACUOUS: the lock-free sweep never left a half-acknowledged family, so this harness does not create real contention"
pass "control: a lock-free sweep left a half-acknowledged family in $violations of 3 rounds, so the race is real"

printf '%s\n' "${PASS_LINES[@]}"
