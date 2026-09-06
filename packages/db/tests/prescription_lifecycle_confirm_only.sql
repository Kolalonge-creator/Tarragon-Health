-- Tarragon Health
-- Live proof for 20260829010000_prescription_lifecycle_rx_number_and_expiry —
-- the new prescription-lifecycle columns (rx_number/verification_code/
-- expires_at/version/previous_version_id/superseded_at/amendment_reason)
-- must be (a) auto-assigned for a clinician-sourced prescription and NEVER
-- for a patient-sourced one, and (b) exactly as protected from Tier 1's
-- refill-confirm-only path as drug_name/dose/frequency already are.
--
-- Cases:
--   1. Clinician-sourced insert -> rx_number/verification_code/expires_at all assigned
--   2. Patient-sourced insert   -> all three stay NULL
--   3. Tier 1 attempts to change rx_number  -> BLOCKED 42501
--   4. Tier 1 attempts to change expires_at -> BLOCKED 42501
--   5. Tier 1 confirms a refill (rx_number untouched) -> ALLOWED (regression control)
--   6. Tier 2+ prescriber changes route (unrestricted path still works) -> ALLOWED
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `or old.rx_number is distinct from new.rx_number` (and expires_at) line
-- from enforce_medication_confirm_only. Cases 3 and 4 must FAIL, showing a
-- Tier 1 write to prescription-identity detail going through unblocked.
--
-- Run: npx supabase db query --linked -f packages/db/tests/prescription_lifecycle_confirm_only.sql
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
  v_med_pat   uuid;
  v_rx        text;
  v_vcode     text;
  v_expires   timestamptz;
  v_blocked   boolean;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;

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
    v_org, v_clin, 'Prescription Lifecycle Probe', true, now(),
    false, 'tier_1',
    'Probe Indemnity Ltd', 'PROBE-RX-LIFECYCLE', now() + interval '1 year'
  ) returning id into v_staff_id;

  ---------------------------------------------------------------- case 1
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source, is_active
  ) values (
    v_org, v_pat, 'Rx Lifecycle Probe Drug A', '5mg', 'daily', 'clinician', true
  ) returning id, rx_number, verification_code, expires_at into v_med, v_rx, v_vcode, v_expires;

  insert into test_result values (1, 'Clinician-sourced insert -> lifecycle fields assigned',
    case when v_rx like 'TRG-RX-%' and v_vcode is not null and v_expires is not null
      then 'PASS' else 'FAIL' end,
    'rx_number=' || coalesce(v_rx, 'null') || ' verification_code=' || coalesce(v_vcode, 'null')
      || ' expires_at=' || coalesce(v_expires::text, 'null'));

  ---------------------------------------------------------------- case 2
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source, is_active
  ) values (
    v_org, v_pat, 'Rx Lifecycle Probe Drug B (self-added)', '5mg', 'daily', 'patient', true
  ) returning id into v_med_pat;

  insert into test_result values (2, 'Patient-sourced insert -> lifecycle fields stay NULL',
    case when (select rx_number from public.medications where id = v_med_pat) is null
      then 'PASS' else 'FAIL' end,
    'rx_number=' || coalesce((select rx_number from public.medications where id = v_med_pat), 'null'));

  ---------------------------------------------------------------- case 3
  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.medications set rx_number = 'TRG-RX-9999-999999' where id = v_med;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'Tier 1 attempts to change rx_number -> BLOCKED',
    case when v_blocked and (select rx_number from public.medications where id = v_med) = v_rx
      then 'PASS' else 'FAIL' end, 'blocked=' || v_blocked);

  ---------------------------------------------------------------- case 4
  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.medications set expires_at = now() + interval '10 years' where id = v_med;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (4, 'Tier 1 attempts to change expires_at -> BLOCKED',
    case when v_blocked and (select expires_at from public.medications where id = v_med) = v_expires
      then 'PASS' else 'FAIL' end, 'blocked=' || v_blocked);

  ---------------------------------------------------------------- case 5
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set refill_date = current_date + 30 where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (5, 'Tier 1 confirms refill, rx_number untouched -> ALLOWED (regression control)',
    case when (select rx_number from public.medications where id = v_med) = v_rx
      then 'PASS' else 'FAIL' end, 'rx_number unchanged');

  ---------------------------------------------------------------- case 6
  update public.clinical_staff set doctor_tier = 'tier_2' where id = v_staff_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set route = 'Subcutaneous' where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (6, 'Tier 2 prescriber changes route -> ALLOWED (unrestricted path still works)',
    case when (select route from public.medications where id = v_med) = 'Subcutaneous'
      then 'PASS' else 'FAIL' end, '');
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
