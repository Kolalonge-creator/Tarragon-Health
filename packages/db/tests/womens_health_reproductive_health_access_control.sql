-- ===========================================================================
-- Verification: Women's Health platform (PR #323) tables were built against
-- the PRE-2026-08-30 caregiver-access shape (a bare, category-blind
-- EXISTS(profile_access) check) instead of the category-scoped model
-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql
-- established five days earlier. Live proof for the fix:
--   - 20260902215227_menstrual_cycles_gate_on_can_read_clinical.sql
--     (menstrual_cycles/menstrual_daily_logs, already live -- now requires an
--     explicit 'reproductive_health' profile_access_categories grant)
--   - the corrected RLS baked directly into 20260829121135/121137/121138/
--     121140/121141 before their first application (antenatal_visits,
--     postnatal_profiles, postnatal_checkins, breast_symptom_reports,
--     menopause_symptom_logs, fertility_assessment_requests -- zero
--     caregiver access at all, matching patient_pregnancy/PR #330)
--
-- Sabotage checks included per this repo's own testing discipline (see
-- packages/db/tests/category_scoped_clinical_access_and_emergency_access_rls.sql):
-- section 1 proves a 'manage'-level grant with NO reproductive_health
-- category grant is refused (the exact bug this fixes); section 2 proves an
-- EXPLICIT reproductive_health category grant IS honoured for
-- menstrual_cycles/menstrual_daily_logs (so the SELECT policy isn't
-- vacuously false); section 3 proves the single MOST permissive caregiver
-- relationship possible ('manage' + an explicit reproductive_health category
-- grant) still cannot read any of the six zero-caregiver-access tables.
--
-- Run: npx supabase db query --linked -f packages/db/tests/womens_health_reproductive_health_access_control.sql
-- Wrapped in BEGIN/ROLLBACK -- leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table wh_result(check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org             uuid;
  v_patient         uuid := gen_random_uuid();
  v_caregiver       uuid := gen_random_uuid();
  v_grant_id        uuid;
  v_count           bigint;
begin
  select id into v_org
  from public.organisations limit 1;

  if v_org is null then
    raise exception 'no organisation exists -- cannot run this test';
  end if;

  insert into auth.users (id, email) values
    (v_patient, 'whtest.patient@example.com'),
    (v_caregiver, 'whtest.caregiver@example.com');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient, v_org, 'patient', 'WH Test Patient'),
    (v_caregiver, v_org, 'patient', 'WH Test Caregiver')
  on conflict (id) do update set organisation_id = excluded.organisation_id;

  -- The single most permissive caregiver relationship this platform can
  -- express: full 'manage' permission_level.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_caregiver, 'manage', v_patient)
  returning id into v_grant_id;

  insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date)
  values (v_org, v_patient, current_date - 10);
  insert into public.menstrual_daily_logs (organisation_id, patient_id, log_date, flow)
  values (v_org, v_patient, current_date, 'medium');
  insert into public.antenatal_visits (organisation_id, patient_id, visit_number, status)
  values (v_org, v_patient, 1, 'completed');
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode)
  values (v_org, v_patient, current_date - 30, 'vaginal');
  insert into public.breast_symptom_reports (organisation_id, patient_id, symptom_types)
  values (v_org, v_patient, array['lump']::public.breast_symptom_type[]);
  insert into public.menopause_symptom_logs (organisation_id, patient_id, symptom_types)
  values (v_org, v_patient, array['hot_flashes']::public.menopause_symptom_type[]);
  insert into public.fertility_assessment_requests (organisation_id, patient_id)
  values (v_org, v_patient);

  ----------------------------------------------------------------------------
  -- Section 1 (the bug this migration fixes): a 'manage'-level grantee with
  -- NO reproductive_health category grant must NOT read menstrual_cycles.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.menstrual_cycles where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'manage-level grant with NO reproductive_health category grant cannot read menstrual_cycles',
    v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.menstrual_daily_logs where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'manage-level grant with NO reproductive_health category grant cannot read menstrual_daily_logs',
    v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  ----------------------------------------------------------------------------
  -- Section 2 (proves the policy isn't vacuously false): the patient grants
  -- the reproductive_health category explicitly -- now the caregiver reads.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(v_grant_id, array['reproductive_health']::public.care_access_category[]);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.menstrual_cycles where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'manage-level grant WITH an explicit reproductive_health category grant CAN read menstrual_cycles',
    v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.menstrual_daily_logs where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'manage-level grant WITH an explicit reproductive_health category grant CAN read menstrual_daily_logs',
    v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end
  );

  ----------------------------------------------------------------------------
  -- Section 3: even this single most-permissive relationship possible
  -- ('manage' + explicit reproductive_health category grant) must NOT reach
  -- the six zero-caregiver-access tables.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.antenatal_visits where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'full manage+reproductive_health grant still cannot read antenatal_visits',
    v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.postnatal_profiles where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'full manage+reproductive_health grant still cannot read postnatal_profiles',
    v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.breast_symptom_reports where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'full manage+reproductive_health grant still cannot read breast_symptom_reports',
    v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.menopause_symptom_logs where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'full manage+reproductive_health grant still cannot read menopause_symptom_logs',
    v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  perform set_config('request.jwt.claims', json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.fertility_assessment_requests where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'full manage+reproductive_health grant still cannot read fertility_assessment_requests',
    v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end
  );

  ----------------------------------------------------------------------------
  -- Section 4: the patient herself always reads her own rows regardless.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.menstrual_cycles where patient_id = v_patient;
  reset role;
  insert into wh_result values (
    'the patient herself can always read her own menstrual_cycles',
    v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end
  );
end $$;

select check_name, observed, expected, verdict from wh_result order by check_name;

rollback;
