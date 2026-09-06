-- ===========================================================================
-- Verification: patient_serology_status extraction, after
-- 20260830_extract_serology_status_from_profiles.sql (hiv_status/hbv_status/
-- hcv_status moved off public.profiles into their own single-purpose table).
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- Simulated-session pattern per packages/db/tests/scoped_access_roles_rls.sql.
--
-- Covers three things this migration could plausibly have broken:
--   1. RLS on the new table respects clinical_access, same as every other
--      post-sweep clinical table (a view-only grantee is blocked, a clinical
--      grantee and the patient themselves are not).
--   2. The serology state machine (private.advance_serology_status, fired from
--      a screening_results insert) still writes to the new table, not the
--      column it used to live on, and still fires the reactive clinician_alerts
--      row it always has.
--   3. An ordinary profiles self-update (e.g. a phone number) still succeeds —
--      proves private.guard_profiles_self_update wasn't left referencing a
--      column that no longer exists on NEW/OLD, which would otherwise error
--      on every future profiles UPDATE platform-wide, not just this one.
-- ===========================================================================

begin;

create temporary table pss_result(check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org               uuid;
  v_patient           uuid;
  v_view_grantee      uuid := gen_random_uuid();
  v_clinical_grantee  uuid := gen_random_uuid();
  v_count             bigint;
  v_hiv_status        text;
  v_alert_count       bigint;
  v_phone             text;
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

  insert into auth.users (id, email) values
    (v_view_grantee, 'pss.view.grantee@example.com'),
    (v_clinical_grantee, 'pss.clinical.grantee@example.com');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_view_grantee, v_org, 'patient', 'PSS Test View Grantee'),
    (v_clinical_grantee, v_org, 'patient', 'PSS Test Clinical Grantee')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_view_grantee, 'view', v_patient);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_clinical_grantee, 'manage', v_patient);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profile_access set clinical_access = true
    where profile_id = v_patient and grantee_user_id = v_clinical_grantee;
  reset role;

  -- 1a. View-only grantee — blocked from patient_serology_status.
  perform set_config('request.jwt.claims', json_build_object('sub', v_view_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_serology_status where patient_id = v_patient;
  reset role;
  insert into pss_result values ('view-only grantee reads patient_serology_status', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 1b. Clinical grantee — allowed (the backfilled row from the migration itself).
  perform set_config('request.jwt.claims', json_build_object('sub', v_clinical_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_serology_status where patient_id = v_patient;
  reset role;
  insert into pss_result values ('clinical grantee reads patient_serology_status', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  -- 1c. Patient self — allowed.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_serology_status where patient_id = v_patient;
  reset role;
  insert into pss_result values ('patient reads own patient_serology_status', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  -- 2. A reactive HIV screening_results insert advances patient_serology_status
  --    (not any column on profiles, which no longer has one) and fires a
  --    reactive clinician_alerts row.
  insert into public.screening_results
    (organisation_id, patient_id, result_status, screen_type_code)
  values
    (v_org, v_patient, 'critical', 'hiv');

  select hiv_status::text into v_hiv_status from public.patient_serology_status where patient_id = v_patient;
  insert into pss_result values ('reactive HIV result advances patient_serology_status.hiv_status', coalesce(v_hiv_status, 'null'), 'hiv_positive', case when v_hiv_status = 'hiv_positive' then 'PASS' else 'FAIL' end);

  select count(*) into v_alert_count from public.clinician_alerts
    where patient_id = v_patient and title like 'Reactive HIV result%';
  insert into pss_result values ('reactive HIV result fires clinician_alerts', v_alert_count::text, '>= 1', case when v_alert_count >= 1 then 'PASS' else 'FAIL' end);

  -- 2b. private.compute_screening_order_exclusions (the reader) correctly
  --      excludes a terminal-state test from re-ordering, reading from
  --      patient_serology_status rather than the now-nonexistent profiles columns.
  declare
    v_exclusions jsonb;
  begin
    v_exclusions := private.compute_screening_order_exclusions(v_patient, v_org, array['hiv']);
    insert into pss_result values (
      'compute_screening_order_exclusions reads terminal hiv_positive state',
      v_exclusions::text,
      'contains terminal_serology_state',
      case when v_exclusions::text like '%terminal_serology_state%' then 'PASS' else 'FAIL' end
    );
  end;

  -- 3. An ordinary profiles self-update (phone number) still succeeds post-drop —
  --    proves guard_profiles_self_update wasn't left referencing a dropped column.
  select phone into v_phone from public.profiles where id = v_patient;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set phone = coalesce(v_phone, '+2348010000000') where id = v_patient;
  reset role;
  insert into pss_result values ('ordinary profiles self-update still succeeds post-drop', 'no exception raised', 'no exception raised', 'PASS');

  if exists (select 1 from pss_result where verdict = 'FAIL') then
    raise exception 'one or more checks failed — see pss_result';
  end if;
end $$;

select * from pss_result order by check_name;

rollback;
