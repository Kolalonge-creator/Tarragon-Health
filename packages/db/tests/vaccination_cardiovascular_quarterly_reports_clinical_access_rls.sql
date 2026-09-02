-- ===========================================================================
-- Verification: vaccination_records, vaccination_schedules,
-- patient_cardiovascular_profile, and patient_quarterly_reports SELECT respect
-- clinical_access, after
-- 20260830101935_vaccination_cardiovascular_quarterly_reports_gate_on_can_read_clinical.sql.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data; it
-- always leaves the database exactly as it found it.
--
-- Same fixture shape as packages/db/tests/reproductive_health_profiles_clinical_access_rls.sql
-- -- read that file's header for the full rationale (the enforce_clinical_access_
-- consent_owner trigger forces clinical_access=false on INSERT, so this script
-- flips it on via an owner-session UPDATE, not directly on insert). Each check
-- re-does its own set_config + set local role + reset role around exactly one
-- SELECT — writing to the result temp table while `role authenticated` is set
-- fails with a permission error (the temp table is owned by the connecting
-- role), so the switch must be scoped tightly around the read alone.
-- ===========================================================================

begin;

create temporary table vcqr_result(check_name text, observed bigint, expected text, verdict text) on commit drop;

do $$
declare
  v_org               uuid;
  v_patient           uuid;
  v_view_grantee      uuid := gen_random_uuid();
  v_clinical_grantee  uuid := gen_random_uuid();
  v_vaccine           uuid;
  v_count             bigint;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient
  from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  select id into v_vaccine from public.vaccination_catalog limit 1;
  if v_vaccine is null then
    raise exception 'no vaccination_catalog row exists — cannot run this test';
  end if;

  insert into auth.users (id, email) values
    (v_view_grantee, 'vcqrtest.view.grantee@example.com'),
    (v_clinical_grantee, 'vcqrtest.clinical.grantee@example.com');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_view_grantee, v_org, 'patient', 'VCQR Test View Grantee'),
    (v_clinical_grantee, v_org, 'patient', 'VCQR Test Clinical Grantee')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_view_grantee, 'view', v_patient);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_clinical_grantee, 'manage', v_patient);

  -- Owner-session flip, same reason as the reproductive_health_profiles test:
  -- INSERT always forces clinical_access=false regardless of what's requested.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profile_access set clinical_access = true
    where profile_id = v_patient and grantee_user_id = v_clinical_grantee;
  reset role;

  insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, date_administered)
  values (v_org, v_patient, v_vaccine, current_date);
  insert into public.vaccination_schedules (organisation_id, patient_id, vaccination_catalog_id, due_date)
  values (v_org, v_patient, v_vaccine, current_date + 30);
  insert into public.patient_cardiovascular_profile (organisation_id, patient_id)
  values (v_org, v_patient)
  on conflict do nothing;
  insert into public.patient_quarterly_reports (patient_id, organisation_id, period_start, period_end, snapshot)
  values (v_patient, v_org, current_date - 90, current_date, '{}'::jsonb);

  -- 1. View-only grantee, clinical_access=false — must be BLOCKED on all 4 tables.
  perform set_config('request.jwt.claims', json_build_object('sub', v_view_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vaccination_records where profile_id = v_patient;
  reset role;
  insert into vcqr_result values ('view-only grantee: vaccination_records', v_count, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_view_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vaccination_schedules where patient_id = v_patient;
  reset role;
  insert into vcqr_result values ('view-only grantee: vaccination_schedules', v_count, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_view_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_cardiovascular_profile where patient_id = v_patient;
  reset role;
  insert into vcqr_result values ('view-only grantee: patient_cardiovascular_profile', v_count, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_view_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_quarterly_reports where patient_id = v_patient;
  reset role;
  insert into vcqr_result values ('view-only grantee: patient_quarterly_reports', v_count, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 2. Manage grantee, clinical_access=true — must see all 4.
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vaccination_records where profile_id = v_patient;
  reset role;
  insert into vcqr_result values ('clinical grantee: vaccination_records', v_count, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vaccination_schedules where patient_id = v_patient;
  reset role;
  insert into vcqr_result values ('clinical grantee: vaccination_schedules', v_count, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_cardiovascular_profile where patient_id = v_patient;
  reset role;
  insert into vcqr_result values ('clinical grantee: patient_cardiovascular_profile', v_count, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_quarterly_reports where patient_id = v_patient;
  reset role;
  insert into vcqr_result values ('clinical grantee: patient_quarterly_reports', v_count, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  -- 3. Patient reads their own rows on all 4 — must still work.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vaccination_records where profile_id = v_patient;
  reset role;
  insert into vcqr_result values ('patient self: vaccination_records', v_count, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_quarterly_reports where patient_id = v_patient;
  reset role;
  insert into vcqr_result values ('patient self: patient_quarterly_reports', v_count, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  if exists (select 1 from vcqr_result where verdict = 'FAIL') then
    raise exception 'one or more checks failed — see vcqr_result';
  end if;
end $$;

select * from vcqr_result order by check_name;

rollback;
