-- ===========================================================================
-- Verification: Imaging & Diagnostic Procedure Platform (spec §59) --
-- ordering authority, cross-patient RLS isolation, and the abnormal-imaging
-- pathway plugging into the SAME clinician_alerts inbox as every other
-- diagnostic safety event (spec §59.15 acceptance criterion).
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor. NOT YET EXECUTED against a live
-- database as of writing (no local Postgres/Docker session available) — run
-- this before treating the imaging platform's RLS/pathway as proven, not
-- just written to the same pattern as packages/db/tests/ecg_report_rls.sql.
--
-- Wrapped in BEGIN/ROLLBACK — always leaves the database exactly as found.
--
-- WHY EVERY NEGATIVE IS PAIRED WITH A POSITIVE, same reasoning as
-- ecg_report_rls.sql: a care_coordinator being refused an imaging order, or
-- patient B reading 0 rows, proves nothing alone unless a real doctor-tier
-- clinician / patient A, in the SAME transaction against the SAME fixture
-- row, succeeds — otherwise an always-empty table or an over-broad "nobody
-- can do anything" policy would score identically.
-- ===========================================================================

begin;

create temporary table imaging_rls_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org            uuid := '00000000-0000-0000-0000-000000000001';
  v_pat_a          uuid;
  v_pat_b          uuid;
  v_clin           uuid;
  v_clin_staff     uuid;
  v_cc_profile     uuid := gen_random_uuid();
  v_cc_staff       uuid;
  v_provider       uuid;
  v_location       uuid;
  v_study          uuid;
  v_order_a        uuid;
  v_order_cc_blocked boolean := false;
  n_orders_a       int;
  n_orders_b       int;
  v_report_id      uuid;
  v_alert_level    text;
  v_alert_type     text;
  v_alert_esc      smallint;
  v_order_status   text;
  v_finding_id     uuid;
  v_finding_alert_level text;
  v_questionnaire_alert_id uuid;
  v_ai_draft_id    uuid;
  n_ai_drafts_patient int;
  n_ai_drafts_clin int;
  v_ai_insert_blocked boolean := false;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures (as the connecting superuser, RLS bypassed)
  -- ------------------------------------------------------------------------
  select id into v_pat_a from public.profiles
    where role = 'patient' and organisation_id = v_org order by id limit 1;
  select id into v_pat_b from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_pat_a order by id limit 1;
  select id into v_clin from public.profiles
    where role = 'clinician' and organisation_id = v_org order by id limit 1;

  if v_pat_a is null or v_pat_b is null or v_clin is null then
    raise exception 'fixtures unavailable: need 2 patients and 1 clinician in org 0001';
  end if;

  select id into v_clin_staff from public.clinical_staff where profile_id = v_clin;
  if v_clin_staff is null then
    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at, verified_by)
    values (v_org, v_clin, 'VERIFY Imaging Ordering Clinician', 'tier_2', true, now(), v_pat_a)
    returning id into v_clin_staff;
  else
    update public.clinical_staff set active = true, organisation_id = v_org, doctor_tier = 'tier_2'
    where id = v_clin_staff;
  end if;

  -- A fresh Care Coordinator profile+clinical_staff row -- must NEVER be
  -- able to order imaging (logistics-only, per the Clinical Tier Ladder).
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_cc_profile, 'verify-imaging-cc@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'care_coordinator', full_name = 'VERIFY Care Coordinator'
    where id = v_cc_profile;
  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, doctor_tier, active, license_verified_at, verified_by)
  values (v_org, v_cc_profile, 'VERIFY Care Coordinator', 'care_coordinator', true, now(), v_pat_a)
  returning id into v_cc_staff;

  insert into public.imaging_providers (name) values ('VERIFY Imaging Centre ' || v_org::text)
  returning id into v_provider;
  insert into public.imaging_provider_locations (imaging_provider_id, name, state, address)
  values (v_provider, 'VERIFY Branch', 'Lagos', '1 Verify Street')
  returning id into v_location;
  insert into public.imaging_studies (provider_id, modality, code, name, price_kobo)
  values (v_provider, 'mri', 'VERIFY-MRI-BRAIN', 'VERIFY MRI Brain', 15000000)
  returning id into v_study;

  -- ------------------------------------------------------------------------
  -- Check 1: a Care Coordinator CANNOT create an imaging order.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cc_profile, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    insert into public.imaging_orders (organisation_id, patient_id, study_id, indication)
    values (v_org, v_pat_a, v_study, 'VERIFY: should be blocked');
    v_order_cc_blocked := false;
  exception when others then
    v_order_cc_blocked := true;
  end;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 2 CONTROL: a real Tier-2 clinician CAN create the same order.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.imaging_orders (organisation_id, patient_id, study_id, indication, urgency)
  values (v_org, v_pat_a, v_study, 'VERIFY: headache, rule out structural cause', 'urgent')
  returning id into v_order_a;

  select count(*) into n_orders_a from public.imaging_orders where id = v_order_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 3: patient B cannot read patient A's imaging order (cross-patient
  -- isolation, same org).
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_orders_b from public.imaging_orders where id = v_order_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 4/5/6: clinician files an ABNORMAL, URGENT imaging report ->
  -- must raise a clinician_alerts row (clinical/abnormal_result/
  -- urgent_escalation/esc 3) and advance the order to 'reported'.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.imaging_reports
    (organisation_id, patient_id, imaging_order_id, modality, body_region, study_date,
     radiologist_name, findings, impression, is_abnormal, urgency, source)
  values (
    v_org, v_pat_a, v_order_a, 'mri', 'Brain', current_date,
    'VERIFY Dr. Radiologist', 'VERIFY: 2cm enhancing lesion, left temporal lobe.',
    'VERIFY: findings concerning for a structural lesion, urgent neurology referral advised.',
    true, 'urgent', 'clinician'
  )
  returning id into v_report_id;

  select ca.level::text, ca.type_code::text, ca.escalation_level
    into v_alert_level, v_alert_type, v_alert_esc
  from public.clinician_alerts ca
  where ca.imaging_report_id = v_report_id;

  select status::text into v_order_status from public.imaging_orders where id = v_order_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 7: an incidental finding marked urgent also escalates.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.imaging_incidental_findings (imaging_report_id, description, is_urgent)
  values (v_report_id, 'VERIFY: incidental 8mm pulmonary nodule noted on scout images.', true)
  returning id into v_finding_id;

  select ca.level::text into v_finding_alert_level
  from public.clinician_alerts ca
  join public.imaging_incidental_findings f on f.clinician_alert_id = ca.id
  where f.id = v_finding_id;

  -- ------------------------------------------------------------------------
  -- Check 8: a flagged safety questionnaire raises a review alert.
  -- ------------------------------------------------------------------------
  insert into public.imaging_safety_questionnaires
    (imaging_order_id, template_key, questions, answers, has_contraindication, contraindication_notes)
  values (
    v_order_a, 'mri_safety_v1', '[]'::jsonb, '{"has_pacemaker": true}'::jsonb,
    true, 'VERIFY: patient reports a cardiac pacemaker.'
  )
  returning clinician_alert_id into v_questionnaire_alert_id;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Check 9/10/11: imaging_ai_assist_drafts -- staff-only read, no client
  -- write path at all (Pattern A governance, spec §59.11).
  -- ------------------------------------------------------------------------
  insert into public.imaging_ai_assist_drafts
    (organisation_id, patient_id, imaging_report_id, assist_type, status, model_id)
  values (v_org, v_pat_a, v_report_id, 'quality_check', 'drafted', 'verify-fixture-model')
  returning id into v_ai_draft_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_ai_drafts_patient from public.imaging_ai_assist_drafts where id = v_ai_draft_id;

  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_ai_drafts_clin from public.imaging_ai_assist_drafts where id = v_ai_draft_id;

  begin
    insert into public.imaging_ai_assist_drafts
      (organisation_id, patient_id, imaging_report_id, assist_type, status)
    values (v_org, v_pat_a, v_report_id, 'triage', 'drafted');
    v_ai_insert_blocked := false;
  exception when others then
    v_ai_insert_blocked := true;
  end;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------------
  -- Results
  -- ------------------------------------------------------------------------
  insert into imaging_rls_result values
    (1, 'Care Coordinator: imaging_orders INSERT is blocked (no ordering authority)',
        'true', v_order_cc_blocked::text,
        case when v_order_cc_blocked then 'PASS' else 'FAIL' end),
    (2, 'CONTROL — Tier-2 clinician CAN create an imaging order',
        '1', n_orders_a::text,
        case when n_orders_a = 1 then 'PASS' else 'FAIL' end),
    (3, 'patient B: cannot read patient A''s imaging_orders row',
        '0', n_orders_b::text,
        case when n_orders_b = 0 then 'PASS' else 'FAIL' end),
    (4, 'abnormal+urgent imaging_reports insert raises clinician_alerts at urgent_escalation',
        'urgent_escalation', coalesce(v_alert_level, 'NULL'),
        case when v_alert_level = 'urgent_escalation' then 'PASS' else 'FAIL' end),
    (5, 'the raised alert is classified clinical/abnormal_result, escalation_level 3',
        'abnormal_result/3', coalesce(v_alert_type, 'NULL') || '/' || coalesce(v_alert_esc::text, 'NULL'),
        case when v_alert_type = 'abnormal_result' and v_alert_esc = 3 then 'PASS' else 'FAIL' end),
    (6, 'filing the report advances the parent imaging_orders.status to reported',
        'reported', coalesce(v_order_status, 'NULL'),
        case when v_order_status = 'reported' then 'PASS' else 'FAIL' end),
    (7, 'an urgent incidental finding raises its own urgent_escalation alert',
        'urgent_escalation', coalesce(v_finding_alert_level, 'NULL'),
        case when v_finding_alert_level = 'urgent_escalation' then 'PASS' else 'FAIL' end),
    (8, 'a flagged safety questionnaire raises a clinician_alert and stamps clinician_alert_id',
        'not null', case when v_questionnaire_alert_id is not null then 'not null' else 'NULL' end,
        case when v_questionnaire_alert_id is not null then 'PASS' else 'FAIL' end),
    (9, 'patient CANNOT read an imaging_ai_assist_drafts row about their own care',
        '0', n_ai_drafts_patient::text,
        case when n_ai_drafts_patient = 0 then 'PASS' else 'FAIL' end),
    (10, 'CONTROL — org staff (clinician) CAN read the same imaging_ai_assist_drafts row',
        '1', n_ai_drafts_clin::text,
        case when n_ai_drafts_clin = 1 then 'PASS' else 'FAIL' end),
    (11, 'no authenticated session (not even a clinician) can INSERT into imaging_ai_assist_drafts directly',
        'true', v_ai_insert_blocked::text,
        case when v_ai_insert_blocked then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from imaging_rls_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from imaging_rls_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'imaging platform RLS/pathway verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
