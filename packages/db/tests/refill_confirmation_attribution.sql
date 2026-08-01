-- Tarragon Health
-- Live proof for attribute_refill_confirmation_for_any_clinical_tier.
--
-- Before this change, private.enforce_medication_confirm_only stamped
-- last_confirmed_at / last_confirmed_by only in the Tier 1 branch, AFTER an
-- unconditional `if has_prescribing_authority then return new; end if;`. So a
-- Tier 2+ doctor confirming a refill wrote refill_date but was never
-- attributed, and the patient-facing "Confirmed by your care team - date" line
-- stayed blank. Combined with the UI gate (which excluded prescribers
-- outright), a senior doctor covering a shift with no Tier 1 on duty could
-- neither see the control nor be credited for using it.
--
-- The fix must NOT over-correct: a prescriber changing a dose or stopping a
-- medication must never surface to the patient as a care-team confirmation.
-- Case 3 is the one that would catch that, and it is the reason stamping is
-- conditional for prescribers rather than unconditional for everyone.
--
-- Cases (each negative paired with a positive control):
--   1. Tier 1 confirms a refill            -> stamped (unchanged behaviour)
--   2. Tier 4 prescriber confirms a refill -> stamped (THE FIX)
--   3. Tier 4 prescriber changes the dose  -> NOT stamped (no false credit)
--   4. Patient edits their own medication  -> NOT stamped (not their own care team)
--   5. Tier 1 attempts a dose change       -> still BLOCKED 42501 (regression control)
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: make stamping
-- unconditional for prescribers (drop the v_is_confirmation guard). Case 3
-- must FAIL, showing a dose change credited as a confirmation.
--
-- Run: npx supabase db query --linked -f packages/db/tests/refill_confirmation_attribution.sql
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
  v_by        uuid;
  v_at        timestamptz;
  v_dose      text;
  v_blocked   boolean;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;

  -- Must be role='clinician': medications_update's USING clause is
  -- `is_org_staff(org) and (prescribing or confirm)`, and private.is_org_staff
  -- excludes patients AND the scoped partner roles (pharmacist, lab_partner,
  -- lab_liaison, finance, analyst). A probe with any of those roles is denied
  -- by RLS with ZERO ROWS UPDATED and NO EXCEPTION, which reads as a failing
  -- assertion rather than a blocked write -- exactly the false signal this
  -- test first produced. Also requires no existing clinical_staff row so the
  -- probe cannot collide with the founder's real Clinical Director record.
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

  -- Indemnity is set because the DB refuses to activate a Tier 4 record
  -- without current cover.
  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, active, license_verified_at,
    is_clinical_director, doctor_tier,
    indemnity_insurer, indemnity_policy_number, indemnity_expires_at
  ) values (
    v_org, v_clin, 'Refill Attribution Probe', true, now(),
    false, 'tier_1',
    'Probe Indemnity Ltd', 'PROBE-ATTRIBUTION', now() + interval '1 year'
  ) returning id into v_staff_id;

  ---------------------------------------------------------------- case 1
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date
  ) values (
    v_org, v_pat, 'Attribution Probe Drug A', '5mg', 'daily', 'clinician',
    true, current_date + 7
  ) returning id into v_med;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set refill_date = current_date + 30 where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select last_confirmed_by into v_by from public.medications where id = v_med;
  insert into test_result values (1, 'Tier 1 confirms refill -> stamped',
    case when v_by = v_staff_id then 'PASS' else 'FAIL' end,
    'last_confirmed_by=' || coalesce(v_by::text, 'null'));

  ---------------------------------------------------------------- case 2
  update public.clinical_staff
     set doctor_tier = 'tier_4_senior_registrar' where id = v_staff_id;

  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date
  ) values (
    v_org, v_pat, 'Attribution Probe Drug B', '10mg', 'daily', 'clinician',
    true, current_date + 7
  ) returning id into v_med;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set refill_date = current_date + 30 where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select last_confirmed_by into v_by from public.medications where id = v_med;
  insert into test_result values (2, 'Tier 4 prescriber confirms refill -> stamped (THE FIX)',
    case when v_by = v_staff_id then 'PASS' else 'FAIL' end,
    'last_confirmed_by=' || coalesce(v_by::text, 'null'));

  ---------------------------------------------------------------- case 3
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date
  ) values (
    v_org, v_pat, 'Attribution Probe Drug C', '10mg', 'daily', 'clinician',
    true, current_date + 7
  ) returning id into v_med;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set dose = '20mg' where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select last_confirmed_by, last_confirmed_at, dose
    into v_by, v_at, v_dose from public.medications where id = v_med;
  insert into test_result values (3, 'Tier 4 prescriber changes dose -> NOT stamped',
    case when v_by is null and v_at is null then 'PASS' else 'FAIL' end,
    'dose=' || v_dose || ' last_confirmed_by=' || coalesce(v_by::text, 'null'));

  ---------------------------------------------------------------- case 4
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date
  ) values (
    v_org, v_pat, 'Attribution Probe Drug D', '10mg', 'daily', 'patient',
    true, current_date + 7
  ) returning id into v_med;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medications set refill_date = current_date + 21 where id = v_med;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select last_confirmed_by, last_confirmed_at
    into v_by, v_at from public.medications where id = v_med;
  insert into test_result values (4, 'Patient edits own medication -> NOT stamped',
    case when v_by is null and v_at is null then 'PASS' else 'FAIL' end,
    'last_confirmed_by=' || coalesce(v_by::text, 'null'));

  ---------------------------------------------------------------- case 5
  update public.clinical_staff set doctor_tier = 'tier_1' where id = v_staff_id;

  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source,
    is_active, refill_date
  ) values (
    v_org, v_pat, 'Attribution Probe Drug E', '10mg', 'daily', 'clinician',
    true, current_date + 7
  ) returning id into v_med;

  v_blocked := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.medications set dose = '40mg' where id = v_med;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (5, 'Tier 1 attempts dose change -> still BLOCKED (regression control)',
    case when v_blocked then 'PASS' else 'FAIL' end,
    case when v_blocked then '42501 raised' else 'dose change allowed - BUG' end);
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
