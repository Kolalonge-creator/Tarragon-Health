-- Tarragon Health
-- Live proof for 20260827200208_prescription_workspace_fields — the new
-- prescription order-entry columns (route/duration_days/quantity/
-- repeats_allowed/indication/instructions) must be exactly as protected from
-- Tier 1's refill-confirm-only path as drug_name/dose/frequency already are.
--
-- Without this guard, a Tier 1 doctor confirming a refill (a write RLS
-- legitimately admits via can_confirm_medication_refill) could silently
-- rewrite prescription detail under cover of "just confirming the refill
-- date" — the trigger only blocks columns it explicitly compares, so a new
-- column is open by default until added to the comparison list.
--
-- Cases (each negative paired with a positive control, same shape as
-- refill_confirmation_attribution.sql):
--   1. Tier 1 attempts to change route         -> BLOCKED 42501
--   2. Tier 1 attempts to change instructions  -> BLOCKED 42501
--   3. Tier 1 confirms a refill (route untouched) -> ALLOWED (regression control)
--   4. Tier 2+ prescriber changes route         -> ALLOWED (unrestricted path still works)
--   5. Client-supplied added_by is overwritten with the real caller (private.stamp_medication_added_by)
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `or old.route is distinct from new.route` (and instructions) line from
-- enforce_medication_confirm_only. Cases 1 and 2 must FAIL, showing a Tier 1
-- write to prescription detail going through unblocked. For case 5, change
-- stamp_medication_added_by to `if new.added_by is null then ... end if;` —
-- it must FAIL, showing the spoofed added_by surviving.
--
-- Run: npx supabase db query --linked -f packages/db/tests/prescription_fields_confirm_only.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org       uuid := '00000000-0000-0000-0000-000000000001';
  v_pat       uuid;
  v_clin      uuid;
  v_staff_id  uuid;
  v_med       uuid;
  v_route     text;
  v_instr     text;
  v_blocked   boolean;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;

  -- role='clinician' with no existing clinical_staff row, same reasoning as
  -- refill_confirmation_attribution.sql: private.is_org_staff excludes
  -- patients and the scoped partner roles, and the probe must not collide
  -- with a real clinical_staff record.
  select p.id into v_clin from public.profiles p
   where p.organisation_id = v_org
     and p.role = 'clinician'
     and p.id <> v_pat
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
   limit 1;

  if v_pat is null or v_clin is null then
    raise exception
      'Need one patient and one clinician-role profile with no clinical_staff row in org %', v_org;
  end if;

  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, active, license_verified_at,
    is_clinical_director, doctor_tier,
    indemnity_insurer, indemnity_policy_number, indemnity_expires_at
  ) values (
    v_org, v_clin, 'Prescription Fields Probe', true, now(),
    false, 'tier_1',
    'Probe Indemnity Ltd', 'PROBE-RX-FIELDS', now() + interval '1 year'
  ) returning id into v_staff_id;

  ---------------------------------------------------------------- case 1
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date, route
  ) values (
    v_org, v_pat, 'Rx Fields Probe Drug A', '5mg', 'daily', 'clinician',
    true, current_date + 7, 'Oral'
  ) returning id into v_med;

  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.medications set route = 'Intravenous' where id = v_med;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select route into v_route from public.medications where id = v_med;
  insert into test_result values (1, 'Tier 1 attempts to change route -> BLOCKED',
    case when v_blocked and v_route = 'Oral' then 'PASS' else 'FAIL' end,
    'blocked=' || v_blocked || ' route=' || coalesce(v_route, 'null'));

  ---------------------------------------------------------------- case 2
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date, instructions
  ) values (
    v_org, v_pat, 'Rx Fields Probe Drug B', '5mg', 'daily', 'clinician',
    true, current_date + 7, 'Take with food'
  ) returning id into v_med;

  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.medications set instructions = 'Take on empty stomach' where id = v_med;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select instructions into v_instr from public.medications where id = v_med;
  insert into test_result values (2, 'Tier 1 attempts to change instructions -> BLOCKED',
    case when v_blocked and v_instr = 'Take with food' then 'PASS' else 'FAIL' end,
    'blocked=' || v_blocked || ' instructions=' || coalesce(v_instr, 'null'));

  ---------------------------------------------------------------- case 3
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date, route
  ) values (
    v_org, v_pat, 'Rx Fields Probe Drug C', '5mg', 'daily', 'clinician',
    true, current_date + 7, 'Oral'
  ) returning id into v_med;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set refill_date = current_date + 30 where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select route into v_route from public.medications where id = v_med;
  insert into test_result values (3, 'Tier 1 confirms refill, route untouched -> ALLOWED (regression control)',
    case when v_route = 'Oral' then 'PASS' else 'FAIL' end,
    'route=' || coalesce(v_route, 'null'));

  ---------------------------------------------------------------- case 4
  update public.clinical_staff
     set doctor_tier = 'tier_2' where id = v_staff_id;

  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date, route
  ) values (
    v_org, v_pat, 'Rx Fields Probe Drug D', '5mg', 'daily', 'clinician',
    true, current_date + 7, 'Oral'
  ) returning id into v_med;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set route = 'Subcutaneous' where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select route into v_route from public.medications where id = v_med;
  insert into test_result values (4, 'Tier 2 prescriber changes route -> ALLOWED (unrestricted path)',
    case when v_route = 'Subcutaneous' then 'PASS' else 'FAIL' end,
    'route=' || coalesce(v_route, 'null'));

  ---------------------------------------------------------------- case 5
  -- private.stamp_medication_added_by must overwrite a client-supplied
  -- added_by, not merely default it when null — the "Signed by" trail this
  -- migration exists to support is a trust claim, and CLINICAL_TRUST_MODEL_
  -- SPEC.md requires false attribution be structurally impossible, not just
  -- discouraged. v_clin (still Tier 2 from case 4) attempts to attribute the
  -- prescription to the patient instead of themselves.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, added_by
  ) values (
    v_org, v_pat, 'Rx Fields Probe Drug E', '5mg', 'daily', 'clinician',
    true, v_pat
  ) returning id into v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (5, 'Client-supplied added_by is overwritten with the real caller',
    case when (select added_by from public.medications where id = v_med) = v_clin then 'PASS' else 'FAIL' end,
    'added_by=' || (select added_by::text from public.medications where id = v_med) || ' expected=' || v_clin::text);
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
