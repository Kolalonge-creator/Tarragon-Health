#!/usr/bin/env bash
# ============================================================================
# S18: concurrent lead assignment never takes a clinician over their cap, never gives one patient two live leads, and
# concurrent rota writes for the same window never both succeed.
#
# WHY A .sh PROOF. The advisory lock in private.assign_lead_internal (and the one in public.set_on_call_rota) is what
# keeps two sessions from reading the same free capacity or the same free hours. A single psql session cannot race itself,
# so the BEGIN/ROLLBACK .sql proof cannot show it. This script commits fixtures, releases the sessions behind a start
# barrier, and checks the outcome.
#
# WHAT IT PROVES
#  1. CALLERS concurrent assign_lead_for_event calls for CALLERS different patients, three clinicians capped at CAP each:
#     exactly 3 x CAP patients get a lead, the rest are unassigned (never an error), no clinician holds more than CAP,
#     no patient holds two live rows.
#  2. ROTA_CALLERS concurrent set_on_call_rota calls for the same window: exactly one succeeds, the rest are refused as
#     overlapping, and exactly one live shift exists.
#  3. SABOTAGE (control): a lock-free assigner (choose, pause, insert) run through the same harness must push at least one
#     clinician over the cap. If it does not, the harness is not producing real contention and check 1 would prove
#     nothing, so the script fails as VACUOUS.
#
# SAFETY. It commits fixtures and drops a test-only function, so it refuses to run unless $DATABASE_URL looks local
# (same guard and override phrase as s17_queue_concurrent_claim.sh). Fixtures are removed by an EXIT trap.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ALLOW_REMOTE_PHRASE="yes-i-know-this-is-disposable"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* && "$DB_URL" != *"host=/"* \
      && "${S18_ALLOW_REMOTE:-}" != "$ALLOW_REMOTE_PHRASE" ]]; then
  echo "s18_lead_capacity_race: refusing to run -- \$DATABASE_URL does not look local." >&2
  echo "Got: $DB_URL" >&2
  echo "This proof commits fixtures. If this really is a throwaway stack, set S18_ALLOW_REMOTE=$ALLOW_REMOTE_PHRASE." >&2
  exit 1
fi

CAP=4
CALLERS=20
ROTA_CALLERS=8
WORK="$(mktemp -d)"
TAG="s18rc-$$-$(date +%s)"
psql_q() { psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  psql_q <<SQL >/dev/null 2>&1
set session_replication_role = replica;   -- local, disposable database: several of these logs are append only
drop function if exists public.s18_assign_naive(uuid);
delete from public.notifications where recipient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.lead_assignments where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.care_team_assignment where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.rota_swaps where rota_id in (select id from public.on_call_rota where primary_clinician_id in (select id from public.profiles where full_name like '$TAG%'));
delete from public.on_call_rota where primary_clinician_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.domain_events where patient_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.audit_log where actor_id in (select id from public.profiles where full_name like '$TAG%');
delete from public.ops_incidents where external_reference like 'lead_unassigned:%' or external_reference like 'rota_gap:%';
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

# --- fixtures (committed): an admin, a chief medical officer, three REAL lead-capable clinicians capped at $CAP, patients ----
# Real (not test) clinicians for real patients: test and real never mix, and test assignments never count against capacity.
psql_q <<SQL || fail "could not create fixtures"
do \$\$
declare v_org uuid; v_admin uuid := gen_random_uuid(); v_cmo uuid := gen_random_uuid(); v_u uuid; v_s uuid; i integer; c text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  update public.clinical_staff set active = false where is_test is not true and full_name not like '$TAG%';
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, '$TAG-admin@example.invalid', 'x', now(), '{}', '{}'), (v_cmo, '$TAG-cmo@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
    values (v_admin, v_org, 'admin', '$TAG admin', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
    values (v_cmo, v_org, 'clinician', '$TAG cmo', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', true)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, '$TAG cmo', 'MDCN', '$TAG-cmo', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true);
  foreach c in array array['a', 'b', 'c'] loop
    v_u := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values (v_u, '$TAG-doc-' || c || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
      values (v_u, v_org, 'clinician', '$TAG doc ' || c, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', false)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
        doctor_tier, employment_type, credentialing_level, max_lead_patients, languages, is_test)
      values (v_org, v_u, '$TAG doc ' || c, 'MDCN', '$TAG-' || c, true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, $CAP, '{en}', false)
      returning id into v_s;
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
      select v_org, v_s, k, v_admin, false from unnest(array['lead_clinician', 'hypertension', 'on_call']) k;
  end loop;
  for i in 1..$CALLERS loop
    v_u := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values (v_u, '$TAG-pat-' || i || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
      values (v_u, v_org, 'patient', '$TAG pat ' || lpad(i::text, 2, '0'), '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-01-01', false)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, phone = excluded.phone, is_test = excluded.is_test;
  end loop;
end \$\$;
SQL

mapfile -t PATS < <(psql_q -c "select id from public.profiles where full_name like '$TAG pat %' order by full_name")
[[ ${#PATS[@]} -eq $CALLERS ]] || fail "fixture patient count wrong (${#PATS[@]})"
CMO=$(psql_q -c "select id from public.profiles where full_name = '$TAG cmo'")
[[ -n "$CMO" ]] || fail "fixture cmo missing"

reset_leads() {
  psql_q <<SQL >/dev/null || fail "could not reset leads"
set session_replication_role = replica;
delete from public.lead_assignments where patient_id in (select id from public.profiles where full_name like '$TAG pat %');
delete from public.care_team_assignment where patient_id in (select id from public.profiles where full_name like '$TAG pat %');
SQL
}

# all callers released at the same instant. $1 = SQL expression taking the patient id as %s, writes $WORK/out.<i>
race_assign() {
  local expr=$1 i t0
  rm -f "$WORK"/out.*
  t0=$(python3 -c 'import time; print(time.time() + 4)')
  for ((i = 0; i < CALLERS; i++)); do
    (
      printf "begin;\nselect pg_sleep(greatest(0, %s - extract(epoch from clock_timestamp())));\nselect coalesce((%s)::text, 'none');\ncommit;\n" \
        "$t0" "$(printf "$expr" "${PATS[$i]}")" | psql "$DB_URL" -X -q -t -A 2>&1 | grep -v '^$' | tail -n 1 > "$WORK/out.$i"
    ) &
  done
  wait
}

# prints: max_per_clinician assigned unassigned patients_with_two_live_rows errors
assign_state() {
  local errs
  errs=$(cat "$WORK"/out.* | grep -vcE '^([0-9a-f]{8}-|none$)' || true)
  psql_q -c "select
     coalesce((select max(n) from (select count(*) n from public.lead_assignments where state = 'active' and patient_id in (select id from public.profiles where full_name like '$TAG pat %') group by clinician_id) x), 0),
     (select count(*) from public.lead_assignments where state = 'active' and patient_id in (select id from public.profiles where full_name like '$TAG pat %')),
     (select count(*) from public.lead_assignments where state = 'unassigned' and patient_id in (select id from public.profiles where full_name like '$TAG pat %')),
     (select count(*) from (select patient_id from public.lead_assignments where state in ('active', 'unassigned') and patient_id in (select id from public.profiles where full_name like '$TAG pat %') group by 1 having count(*) > 1) y),
     $errs" | tr '|' ' '
}

# --- 1. 20 patients race for 12 places ---------------------------------------------------------------------------------
race_assign "public.assign_lead_for_event('%s', null)"
read -r maxn assigned unassigned twice errs < <(assign_state)
[[ "$errs" -eq 0 ]] || fail "check 1: $errs callers got an error"
[[ "$maxn" -le $CAP ]] || fail "check 1: a clinician holds $maxn patients, over the cap of $CAP"
[[ "$twice" -eq 0 ]] || fail "check 1: $twice patients hold two live lead rows"
[[ "$assigned" -eq $((3 * CAP)) && "$unassigned" -eq $((CALLERS - 3 * CAP)) ]] || fail "check 1: expected $((3 * CAP)) assigned and $((CALLERS - 3 * CAP)) unassigned, got $assigned and $unassigned"
pass "$CALLERS concurrent assignments, 3 clinicians capped at $CAP: $assigned assigned, $unassigned unassigned, none over the cap, none with two live rows, no errors"

# --- 2. the same rota window from several sessions ----------------------------------------------------------------------
SHIFT_FROM="now() + interval '40 hours'"
SHIFT_TO="now() + interval '52 hours'"
mapfile -t DOCS < <(psql_q -c "select id from public.profiles where full_name like '$TAG doc %' order by full_name")
rm -f "$WORK"/rota.*
t0=$(python3 -c 'import time; print(time.time() + 4)')
for ((i = 0; i < ROTA_CALLERS; i++)); do
  (
    printf "begin;\nselect set_config('request.jwt.claims', '{\"sub\":\"%s\",\"role\":\"authenticated\"}', true);\nset local role authenticated;\nselect pg_sleep(greatest(0, %s - extract(epoch from clock_timestamp())));\nselect public.set_on_call_rota(%s, %s, '%s', '%s', null);\ncommit;\n" \
      "$CMO" "$t0" "$SHIFT_FROM" "$SHIFT_TO" "${DOCS[0]}" "${DOCS[1]}" | psql "$DB_URL" -X -q -t -A > "$WORK/rota.$i" 2>&1
  ) &
done
wait
ok=$(grep -l '"id"' "$WORK"/rota.* 2>/dev/null | wc -l | tr -d ' ')
overlap=$(grep -l 'overlaps an existing rota shift' "$WORK"/rota.* 2>/dev/null | wc -l | tr -d ' ')
live=$(psql_q -c "select count(*) from public.on_call_rota where primary_clinician_id = '${DOCS[0]}' and cancelled_at is null")
[[ "$ok" -eq 1 && "$overlap" -eq $((ROTA_CALLERS - 1)) && "$live" -eq 1 ]] || fail "check 2: expected 1 success and $((ROTA_CALLERS - 1)) overlap refusals and 1 live shift; got $ok / $overlap / $live"
pass "$ROTA_CALLERS concurrent writes of one rota window: exactly one succeeded, $((ROTA_CALLERS - 1)) refused as overlapping, one live shift"

# --- 3. SABOTAGE control: a lock-free assigner must be able to push a clinician over the cap -------------------------------
reset_leads
psql_q <<'SQL' || fail "could not create the naive assigner"
create or replace function public.s18_assign_naive(p_patient uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_new uuid; pr public.profiles%rowtype;
begin
  select * into pr from public.profiles where id = p_patient;
  v_new := private.choose_lead(p_patient, '{}');          -- no advisory lock between choosing and writing
  if v_new is null then return null; end if;
  perform pg_sleep(0.3);
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test)
    values (pr.organisation_id, p_patient, v_new, 'active', 'admin', 1, false);
  perform set_config('tarragon.lead_write', 'off', true);
  return v_new;
end $$;
SQL
race_assign "public.s18_assign_naive('%s')"
read -r maxn assigned unassigned twice errs < <(assign_state)
[[ "$maxn" -gt $CAP ]] || fail "VACUOUS: the lock-free assigner never exceeded the cap, so this harness does not create real contention"
pass "control: a lock-free assigner put $maxn patients on one clinician (cap $CAP), so the race is real"
reset_leads

printf '%s\n' "${PASS_LINES[@]}"
