-- ===========================================================================
-- Verification: Healthy Ageing & Elderly Care Module 50
--   (20260829121740_ageing_assessments.sql,
--    20260829121803_falls_risk_pathway.sql,
--    20260829121834_social_determinants_and_home_care.sql)
--
-- Covers: patient/caregiver can self-report; a caregiver's entry is
-- attributed via logged_by_profile_id and a patient's own entry is not; a
-- patient cannot start the falls-risk pathway anywhere but the beginning and
-- cannot progress it themselves; falls risk_level defaults correctly from the
-- contributing-factor count; social-determinant follow_up_status is
-- server-computed, never client-set; a patient cannot self-approve a
-- home-care request.
--
-- Run via `supabase db query --linked -f this_file.sql`, `psql $DATABASE_URL
-- -f this_file.sql`, or the Supabase SQL editor. Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table ham50_fixture(k text primary key, v uuid) on commit drop;
create temporary table ham50_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org        uuid;
  v_patient    uuid;
  v_caregiver  uuid := gen_random_uuid();
  v_clinician  uuid := gen_random_uuid();
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

  insert into ham50_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('caregiver', v_caregiver), ('clinician', v_clinician);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_caregiver, 'ham50-test-caregiver@example.invalid', 'x', now(), '{}', '{}'),
    (v_clinician, 'ham50-test-clinician@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_caregiver, v_org, 'patient', 'HAM50 Test Caregiver'),
    (v_clinician, v_org, 'clinician', 'HAM50 Test Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- The caregiver holds a 'manage' grant over the patient — the eldercare
  -- acting-for scenario this whole module builds on top of.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_caregiver, 'manage', v_patient)
  on conflict (profile_id, grantee_user_id) do update set permission_level = 'manage';
end $$;

-- ==========================================================================
-- 1. The patient can start their own comprehensive ageing assessment, and
--    logged_by_profile_id stays NULL (nobody acted on their behalf).
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from ham50_fixture where k = 'org');
  v_patient uuid := (select v from ham50_fixture where k = 'patient');
  v_assessment uuid;
  v_logged_by uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.ageing_assessments (organisation_id, patient_id)
  values (v_org, v_patient)
  returning id into v_assessment;

  insert into public.ageing_assessment_domain_results (assessment_id, domain, outcome, responses)
  values (v_assessment, 'mobility', 'no_concern', '{"walks_unaided": true}'::jsonb);
  reset role;

  insert into ham50_fixture(k, v) values ('assessment', v_assessment);

  select logged_by_profile_id into v_logged_by from public.ageing_assessments where id = v_assessment;

  insert into ham50_result values
    ('patient self-report leaves logged_by_profile_id null', 'patient',
     coalesce(v_logged_by::text, 'null'), 'null',
     case when v_logged_by is null then 'PASS' else 'FAIL' end);
  if v_logged_by is not null then
    raise exception 'BROKEN: a patient''s own ageing_assessments row was attributed to somebody else';
  end if;
end $$;

-- ==========================================================================
-- 2. A caregiver acting for the patient can complete a domain on their
--    behalf, and it IS attributed to the caregiver.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from ham50_fixture where k = 'patient');
  v_caregiver uuid := (select v from ham50_fixture where k = 'caregiver');
  v_org uuid := (select v from ham50_fixture where k = 'org');
  v_assessment uuid;
  v_logged_by uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_caregiver::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.ageing_assessments (organisation_id, patient_id)
  values (v_org, v_patient)
  returning id into v_assessment;
  reset role;

  select logged_by_profile_id into v_logged_by from public.ageing_assessments where id = v_assessment;

  insert into ham50_result values
    ('caregiver-entered assessment is attributed to caregiver', 'caregiver',
     coalesce(v_logged_by::text, 'null'), v_caregiver::text,
     case when v_logged_by = v_caregiver then 'PASS' else 'FAIL' end);
  if v_logged_by is distinct from v_caregiver then
    raise exception 'BROKEN: caregiver-entered ageing_assessments row was not attributed to the caregiver (got %)', v_logged_by;
  end if;
end $$;

-- ==========================================================================
-- 3. A stranger (no grant, not the patient, not org staff) cannot insert.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from ham50_fixture where k = 'patient');
  v_org uuid := (select v from ham50_fixture where k = 'org');
  v_stranger uuid := gen_random_uuid();
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.ageing_assessments (organisation_id, patient_id) values (v_org, v_patient);
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into ham50_result values
    ('stranger cannot insert an ageing_assessments row for the patient', 'stranger',
     case when v_caught then 'blocked' else 'not blocked' end, 'blocked',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: an unrelated session inserted an ageing_assessments row for somebody else''s patient';
  end if;
end $$;

-- ==========================================================================
-- 4. Falls risk: risk_level defaults correctly from the contributing-factor
--    count (3 factors -> high), and the patient cannot start the pathway
--    anywhere but 'risk_identified'.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from ham50_fixture where k = 'org');
  v_patient uuid := (select v from ham50_fixture where k = 'patient');
  v_falls uuid;
  v_level public.falls_risk_level;
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.falls_risk_assessments
    (organisation_id, patient_id, previous_falls_12mo, mobility_impairment, balance_concern)
  values (v_org, v_patient, true, true, true)
  returning id into v_falls;

  begin
    insert into public.falls_risk_assessments (organisation_id, patient_id, pathway_stage)
    values (v_org, v_patient, 'resolved');
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into ham50_fixture(k, v) values ('falls', v_falls);

  select risk_level into v_level from public.falls_risk_assessments where id = v_falls;
  insert into ham50_result values
    ('falls risk_level auto-computed from 3 factors', 'patient', coalesce(v_level::text, 'null'), 'high',
     case when v_level = 'high' then 'PASS' else 'FAIL' end);
  if v_level is distinct from 'high' then
    raise exception 'BROKEN: expected risk_level=high for 3 contributing factors, got %', v_level;
  end if;

  insert into ham50_result values
    ('patient cannot start the falls pathway past risk_identified', 'patient',
     case when v_caught then 'blocked' else 'not blocked' end, 'blocked',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: a patient session inserted a falls_risk_assessments row at a non-initial pathway_stage';
  end if;
end $$;

-- ==========================================================================
-- 5. The patient cannot progress their own falls-risk pathway; a clinician
--    (org staff) can.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from ham50_fixture where k = 'patient');
  v_clinician uuid := (select v from ham50_fixture where k = 'clinician');
  v_falls uuid := (select v from ham50_fixture where k = 'falls');
  v_caught boolean := false;
  v_stage public.falls_risk_pathway_stage;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.falls_risk_assessments set pathway_stage = 'clinical_assessment' where id = v_falls;
  exception when others then
    v_caught := true;
  end;
  reset role;

  select pathway_stage into v_stage from public.falls_risk_assessments where id = v_falls;
  insert into ham50_result values
    ('patient cannot self-progress the falls pathway', 'patient',
     case when v_caught or v_stage = 'risk_identified' then 'blocked' else 'not blocked' end, 'blocked',
     case when v_caught or v_stage = 'risk_identified' then 'PASS' else 'FAIL' end);
  if v_stage <> 'risk_identified' then
    raise exception 'LEAK: a patient session progressed their own falls_risk_assessments pathway_stage';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.falls_risk_assessments
    set pathway_stage = 'clinical_assessment', assessed_by = v_clinician, assessed_at = now()
    where id = v_falls;
  reset role;

  select pathway_stage into v_stage from public.falls_risk_assessments where id = v_falls;
  insert into ham50_result values
    ('clinician can progress the falls pathway', 'clinician', v_stage::text, 'clinical_assessment',
     case when v_stage = 'clinical_assessment' then 'PASS' else 'FAIL' end);
  if v_stage <> 'clinical_assessment' then
    raise exception 'BROKEN: clinician update did not progress falls_risk_assessments.pathway_stage';
  end if;
end $$;

-- ==========================================================================
-- 6. Social determinants: follow_up_status is server-computed from the
--    flags, never whatever the client sent, and a clean screen needs none.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from ham50_fixture where k = 'org');
  v_patient uuid := (select v from ham50_fixture where k = 'patient');
  v_flagged uuid;
  v_clean uuid;
  v_status public.social_navigation_follow_up_status;
  v_needs boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Client tries to claim 'none_needed' despite flagging living_alone — the
  -- trigger must overrule it.
  insert into public.social_determinant_screenings
    (organisation_id, patient_id, living_alone, follow_up_status)
  values (v_org, v_patient, true, 'none_needed')
  returning id into v_flagged;

  insert into public.social_determinant_screenings (organisation_id, patient_id)
  values (v_org, v_patient)
  returning id into v_clean;
  reset role;

  select follow_up_status, needs_navigation_support into v_status, v_needs
    from public.social_determinant_screenings where id = v_flagged;
  insert into ham50_result values
    ('flagged social screen forces follow_up_status=pending server-side', 'patient',
     v_status::text, 'pending', case when v_status = 'pending' and v_needs then 'PASS' else 'FAIL' end);
  if v_status <> 'pending' or not v_needs then
    raise exception 'BROKEN: a living_alone=true screening was not forced to follow_up_status=pending (got % / needs=%)', v_status, v_needs;
  end if;

  select follow_up_status into v_status from public.social_determinant_screenings where id = v_clean;
  insert into ham50_result values
    ('clean social screen needs no follow-up', 'patient', v_status::text, 'none_needed',
     case when v_status = 'none_needed' then 'PASS' else 'FAIL' end);
  if v_status <> 'none_needed' then
    raise exception 'BROKEN: a screening with no flags set was not follow_up_status=none_needed (got %)', v_status;
  end if;
end $$;

-- ==========================================================================
-- 7. Home care requests: patient can raise one at eligibility_pending only;
--    only org staff can approve/schedule it.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from ham50_fixture where k = 'org');
  v_patient uuid := (select v from ham50_fixture where k = 'patient');
  v_clinician uuid := (select v from ham50_fixture where k = 'clinician');
  v_request uuid;
  v_caught boolean := false;
  v_status public.home_care_request_status;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.home_care_requests (organisation_id, patient_id, reason)
  values (v_org, v_patient, 'Mobility has declined, would like a home safety check')
  returning id into v_request;

  begin
    insert into public.home_care_requests (organisation_id, patient_id, status)
    values (v_org, v_patient, 'eligible');
  exception when others then
    v_caught := true;
  end;

  begin
    update public.home_care_requests set status = 'eligible' where id = v_request;
  exception when others then
    v_caught := v_caught and true;
  end;
  reset role;

  select status into v_status from public.home_care_requests where id = v_request;
  insert into ham50_result values
    ('patient cannot self-approve a home-care request', 'patient',
     v_status::text, 'eligibility_pending',
     case when v_status = 'eligibility_pending' then 'PASS' else 'FAIL' end);
  if v_status <> 'eligibility_pending' then
    raise exception 'LEAK: a patient session moved their own home_care_requests row out of eligibility_pending';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.home_care_requests
    set status = 'eligible', eligibility_checked_by = v_clinician, eligibility_checked_at = now()
    where id = v_request;
  reset role;

  select status into v_status from public.home_care_requests where id = v_request;
  insert into ham50_result values
    ('org staff can approve a home-care request', 'clinician', v_status::text, 'eligible',
     case when v_status = 'eligible' then 'PASS' else 'FAIL' end);
  if v_status <> 'eligible' then
    raise exception 'BROKEN: clinician update did not move home_care_requests.status to eligible';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from ham50_result
order by verdict desc, check_name, role;

rollback;
