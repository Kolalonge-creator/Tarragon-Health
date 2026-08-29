-- ---------------------------------------------------------------------------
-- 20260829083614: clinical_access_level is a real tri-state now, and
-- lab_analyte_readings / patient_blood_profile require 'full' specifically —
-- a 'summary' grantee sees vitals/care_plans but not lab results.
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--
--   patient   the person whose record it is
--   summary   profile_access 'view' + clinical_access_level 'summary'
--             -> sees vitals/care_plans (control), NOT lab results
--   full      profile_access 'view' + clinical_access_level 'full'
--             -> sees vitals/care_plans AND lab results (control)
--   none      profile_access 'view' + clinical_access_level 'none'
--             -> sees neither (control)
--
-- Usage:
--   npx supabase db query --linked -f packages/db/tests/graded_clinical_access_levels.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org      uuid := '00000000-0000-0000-0000-000000000001';
  v_patient  uuid := 'a1e40000-0000-4000-8000-000000000001';
  v_summary  uuid := 'a1e40000-0000-4000-8000-000000000002';
  v_full     uuid := 'a1e40000-0000-4000-8000-000000000003';
  v_none     uuid := 'a1e40000-0000-4000-8000-000000000004';
  v_lab      uuid;
  v_n        int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'clevel-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_summary, 'clevel-test-summary@example.invalid', 'x', now(), '{}', '{}'),
    (v_full,    'clevel-test-full@example.invalid',    'x', now(), '{}', '{}'),
    (v_none,    'clevel-test-none@example.invalid',    'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Level Test Patient' where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Level Test Summary' where id = v_summary;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Level Test Full'    where id = v_full;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Level Test None'    where id = v_none;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_summary, 'view', v_patient),
         (v_patient, v_full,    'view', v_patient),
         (v_patient, v_none,    'view', v_patient);

  -- clinical_access_level starts 'none' regardless of what INSERT asked for
  -- (private.enforce_clinical_access_consent_owner) — flip it as the owner,
  -- exactly like the app's consent switch does.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  update public.profile_access set clinical_access_level = 'summary'
   where profile_id = v_patient and grantee_user_id = v_summary;
  update public.profile_access set clinical_access_level = 'full'
   where profile_id = v_patient and grantee_user_id = v_full;
  reset role;

  -- clinical_access (generated) must track the level for every row.
  if exists (select 1 from public.profile_access where grantee_user_id = v_summary and clinical_access <> true) then
    raise exception 'FAIL: clinical_access generated column wrong for summary-level grant';
  end if;
  if exists (select 1 from public.profile_access where grantee_user_id = v_none and clinical_access <> false) then
    raise exception 'FAIL: clinical_access generated column wrong for none-level grant';
  end if;
  raise notice 'PASS  generated clinical_access column tracks clinical_access_level';

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source)
  values (v_org, v_patient, 'blood_pressure', 120, 80, 'manual');

  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit)
  values (v_org, v_patient, 'HBA1C', 5.4, '%') returning id into v_lab;

  -- ---- 1. summary sees vitals (unchanged gate, control) -----------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_summary, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where patient_id = v_patient;
  if v_n <> 1 then raise exception 'FAIL: summary-level grantee cannot see vitals (expected unchanged)'; end if;
  raise notice 'PASS  summary-level grantee sees vitals (control, unchanged gate)';

  -- ---- 2. ...but NOT lab results ----------------------------------------------
  select count(*) into v_n from public.lab_analyte_readings where patient_id = v_patient;
  if v_n <> 0 then raise exception 'FAIL: summary-level grantee sees % lab result(s), expected 0', v_n; end if;
  raise notice 'PASS  summary-level grantee cannot see lab results';
  reset role;

  -- ---- 3. full sees both -------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_full, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where patient_id = v_patient;
  if v_n <> 1 then raise exception 'FAIL: full-level grantee cannot see vitals'; end if;
  select count(*) into v_n from public.lab_analyte_readings where patient_id = v_patient;
  if v_n <> 1 then raise exception 'FAIL: full-level grantee cannot see lab results'; end if;
  raise notice 'PASS  full-level grantee sees vitals AND lab results';
  reset role;

  -- ---- 4. none sees neither (control) ------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where patient_id = v_patient;
  if v_n <> 0 then raise exception 'FAIL: none-level grantee sees vitals'; end if;
  select count(*) into v_n from public.lab_analyte_readings where patient_id = v_patient;
  if v_n <> 0 then raise exception 'FAIL: none-level grantee sees lab results'; end if;
  raise notice 'PASS  none-level grantee sees neither (control)';
  reset role;

  raise notice '--- all checks passed ---';
end $$;

rollback;
