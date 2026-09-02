-- ===========================================================================
-- Verification: category-scoped caregiver access (part B) and cross-organisation
-- break-glass emergency access (part D), after
-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it. This
-- database currently has only one real organisation, so a second one is
-- created inside the transaction purely to exercise the cross-org path; it
-- never persists.
--
-- Simulated-session pattern per packages/db/tests/scoped_access_roles_rls.sql:
-- each check re-does its own set_config + set local role + reset role around
-- exactly one read — writing to the result temp table while `role
-- authenticated` is set fails (the temp table is owned by the connecting
-- role), so the switch is scoped tightly around the read alone.
-- ===========================================================================

begin;

create temporary table cat_result(check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org_a              uuid;
  v_org_b              uuid := gen_random_uuid();
  v_patient            uuid;
  v_vitals_grantee     uuid := gen_random_uuid();
  v_full_grantee       uuid := gen_random_uuid();
  v_dependent          uuid := gen_random_uuid();
  v_dependent_manager  uuid := gen_random_uuid();
  v_cross_clinician    uuid := gen_random_uuid();
  v_home_director      uuid := gen_random_uuid();
  v_vitals_grant_id    uuid;
  v_emergency_grant_id uuid;
  v_count              bigint;
  v_event_count        bigint;
  v_response           jsonb;
  v_review_status      text;
  v_raised             boolean;
begin
  select organisation_id into v_org_a
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org_a is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  insert into public.organisations (id, name, type) values (v_org_b, 'CAT Test Org B', 'direct_consumer');

  select id into v_patient
  from public.profiles where role = 'patient' and organisation_id = v_org_a limit 1;

  insert into auth.users (id, email) values
    (v_vitals_grantee, 'cattest.vitals.grantee@example.com'),
    (v_full_grantee, 'cattest.full.grantee@example.com'),
    (v_dependent, 'cattest.dependent@example.com'),
    (v_dependent_manager, 'cattest.dependent.manager@example.com'),
    (v_cross_clinician, 'cattest.cross.clinician@example.com'),
    (v_home_director, 'cattest.home.director@example.com');

  insert into public.profiles (id, organisation_id, role, full_name, is_dependent_account)
  values (v_dependent, v_org_a, 'patient', 'CAT Test Dependent', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, is_dependent_account = true;

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_vitals_grantee, v_org_a, 'patient', 'CAT Test Vitals Grantee'),
    (v_full_grantee, v_org_a, 'patient', 'CAT Test Full Grantee'),
    (v_dependent_manager, v_org_a, 'patient', 'CAT Test Dependent Manager'),
    (v_cross_clinician, v_org_b, 'clinician', 'CAT Test Cross Org Clinician'),
    (v_home_director, v_org_a, 'clinician', 'CAT Test Home Director')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, is_clinical_director, license_verified_at)
  values (v_org_b, v_cross_clinician, 'CAT Test Cross Org Clinician', 'tier_1', true, false, now());
  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, is_clinical_director, license_verified_at)
  values (v_org_a, v_home_director, 'CAT Test Home Director', 'tier_4_senior_registrar', true, true, now());

  -- Category grants.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_vitals_grantee, 'view', v_patient)
  returning id into v_vitals_grant_id;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_full_grantee, 'manage', v_patient);

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_dependent, v_dependent_manager, 'manage', v_dependent_manager);

  -- Patient (owner) grants categories via the RPC, as themselves.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(v_vitals_grant_id, array['vitals_readings']::public.care_access_category[]);
  perform public.set_care_access_categories(
    (select id from public.profile_access where profile_id = v_patient and grantee_user_id = v_full_grantee),
    array['appointments_care_plan','vitals_readings','medications','labs_results','vaccinations','messaging','medical_history']::public.care_access_category[]
  );
  reset role;

  insert into public.vitals_readings (organisation_id, patient_id, vital_type)
  values (v_org_a, v_patient, (select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='vital_type' limit 1)::public.vital_type);
  insert into public.medications (organisation_id, patient_id, drug_name)
  values (v_org_a, v_patient, 'CAT Test Drug');
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org_a, v_patient, 'menstruating')
  on conflict (patient_id) do update set life_stage = excluded.life_stage;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type)
  values (v_org_a, v_dependent, (select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='vital_type' limit 1)::public.vital_type);
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage)
  values (v_org_a, v_dependent, 'menstruating')
  on conflict (patient_id) do update set life_stage = excluded.life_stage;

  -- 1. Vitals-only grantee sees vitals_readings but not medications.
  perform set_config('request.jwt.claims', json_build_object('sub', v_vitals_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vitals_readings where patient_id = v_patient;
  reset role;
  insert into cat_result values ('vitals-only grantee reads vitals_readings', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_vitals_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.medications where patient_id = v_patient;
  reset role;
  insert into cat_result values ('vitals-only grantee blocked from medications', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 2. Full grantee (7 non-reproductive categories) reads vitals + medications, blocked from reproductive_health.
  perform set_config('request.jwt.claims', json_build_object('sub', v_full_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.medications where patient_id = v_patient;
  reset role;
  insert into cat_result values ('full grantee reads medications', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_full_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_patient;
  reset role;
  insert into cat_result values ('full grantee blocked from reproductive_health_profiles', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 3. Dependent-account manager: reads vitals via the is_dependent_account bypass
  --    (no explicit category grant), but still blocked from reproductive_health.
  perform set_config('request.jwt.claims', json_build_object('sub', v_dependent_manager::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vitals_readings where patient_id = v_dependent;
  reset role;
  insert into cat_result values ('dependent manager reads vitals with no explicit grant', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_dependent_manager::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_dependent;
  reset role;
  insert into cat_result values ('dependent manager blocked from reproductive_health_profiles', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 4. Lifecycle logging: granting/revoking a category produces exactly one event each.
  select count(*) into v_event_count from public.care_access_events
    where patient_id = v_patient and kind = 'category_access_granted'
      and subject_profile_id = v_vitals_grantee and (metadata->>'category') = 'vitals_readings';
  insert into cat_result values ('category grant logged', v_event_count::text, '>= 1', case when v_event_count >= 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(v_vitals_grant_id, array[]::public.care_access_category[]);
  reset role;

  select count(*) into v_event_count from public.care_access_events
    where patient_id = v_patient and kind = 'category_access_withdrawn'
      and subject_profile_id = v_vitals_grantee and (metadata->>'category') = 'vitals_readings';
  insert into cat_result values ('category revoke logged', v_event_count::text, '>= 1', case when v_event_count >= 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_vitals_grantee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vitals_readings where patient_id = v_patient;
  reset role;
  insert into cat_result values ('vitals-only grantee blocked after revoke', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 4b. Revoking a grant that HAS categories set must not error: deleting the
  --     parent profile_access row cascades into profile_access_categories,
  --     which must not trip the owner-guard trigger on the now-gone parent.
  --     (Regression: private.enforce_category_access_owner originally looked
  --     up the parent's owner via a query that can no longer see it mid-
  --     cascade, wrongly blocking the legitimate owner's own revocation --
  --     this is exactly the path revoke_care_access() uses in production.)
  declare
    v_full_grant_id uuid;
  begin
    select id into v_full_grant_id from public.profile_access
      where profile_id = v_patient and grantee_user_id = v_full_grantee;

    v_raised := false;
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      delete from public.profile_access where id = v_full_grant_id;
    exception when others then
      v_raised := true;
    end;
    reset role;
    insert into cat_result values ('owner can revoke a grant that has categories set (cascade-safe)', v_raised::text, 'false', case when not v_raised then 'PASS' else 'FAIL' end);

    select count(*) into v_count from public.profile_access_categories where profile_access_id = v_full_grant_id;
    insert into cat_result values ('revoked grant''s categories are gone too', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);
  end;

  -- 5. Break-glass: before requesting, the cross-org clinician sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cross_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vitals_readings where patient_id = v_patient;
  reset role;
  insert into cat_result values ('cross-org clinician blocked before requesting', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 6. A same-org request is refused.
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_home_director::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_emergency_record_access(v_patient, 'testing same-org rejection');
  exception when others then
    v_raised := true;
  end;
  reset role;
  insert into cat_result values ('same-org emergency-access request is refused', v_raised::text, 'true', case when v_raised then 'PASS' else 'FAIL' end);

  -- 7. A blank reason is refused.
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cross_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_emergency_record_access(v_patient, '   ');
  exception when others then
    v_raised := true;
  end;
  reset role;
  insert into cat_result values ('blank-reason emergency-access request is refused', v_raised::text, 'true', case when v_raised then 'PASS' else 'FAIL' end);

  -- 8. A real cross-org request succeeds and grants access, except reproductive_health.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cross_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_response := public.request_emergency_record_access(v_patient, 'unconscious patient, treating in ED');
  reset role;
  v_emergency_grant_id := (v_response->>'id')::uuid;
  insert into cat_result values ('emergency-access request returns a grant id', case when v_emergency_grant_id is not null then 'not null' else 'null' end, 'not null', case when v_emergency_grant_id is not null then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_cross_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vitals_readings where patient_id = v_patient;
  reset role;
  insert into cat_result values ('cross-org clinician reads vitals after emergency grant', v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_cross_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.reproductive_health_profiles where patient_id = v_patient;
  reset role;
  insert into cat_result values ('cross-org clinician still blocked from reproductive_health under emergency grant', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  -- 9. Self-review is refused; the home-org clinical director's review succeeds.
  v_raised := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cross_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.review_emergency_record_access(v_emergency_grant_id, 'reviewed_ok', 'self review attempt');
  exception when others then
    v_raised := true;
  end;
  reset role;
  insert into cat_result values ('emergency-access self-review is refused', v_raised::text, 'true', case when v_raised then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_home_director::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.review_emergency_record_access(v_emergency_grant_id, 'reviewed_ok', 'legitimate emergency, confirmed');
  reset role;

  select review_status into v_review_status from public.emergency_record_access_grants where id = v_emergency_grant_id;
  insert into cat_result values ('home-org director review recorded', coalesce(v_review_status, 'null'), 'reviewed_ok', case when v_review_status = 'reviewed_ok' then 'PASS' else 'FAIL' end);

  -- 10. An expired grant no longer grants access, even while still pending review.
  update public.emergency_record_access_grants set expires_at = now() - interval '1 minute', review_status = 'pending_review'
    where id = v_emergency_grant_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cross_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.vitals_readings where patient_id = v_patient;
  reset role;
  insert into cat_result values ('expired emergency grant no longer grants access', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  if exists (select 1 from cat_result where verdict = 'FAIL') then
    raise exception 'one or more checks failed — see cat_result';
  end if;
end $$;

select * from cat_result order by check_name;

rollback;
