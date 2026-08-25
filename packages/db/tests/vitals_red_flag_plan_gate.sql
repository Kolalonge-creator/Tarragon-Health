-- Tarragon Health — verification for
-- 20260810120000_gate_vitals_red_flag_escalation_to_paid_plans.sql
--
-- Proves, for a genuinely fresh Free-tier patient (no subscriptions row at
-- all) vs. a genuinely fresh paid-tier patient (an active 'complete'
-- subscription): a RED-range BP reading and an EMERGENCY-range SpO2 reading
-- raise a clinician_alerts row for the paid patient, exactly as before, and
-- raise NO clinician_alerts row plus an in_app self-care suggestion
-- notification for the free patient. Also proves the free patient still gets
-- the full emergency_events safety net (the row itself, patient-readable,
-- unrelated to clinician_alert_id) on the emergency-tier case.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.

begin;

create temporary table vrfpg_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org           uuid;
  v_free_patient  uuid := gen_random_uuid();
  v_paid_patient  uuid := gen_random_uuid();
  v_complete_plan uuid;
begin
  select organisation_id into v_org
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_complete_plan from public.subscription_plans where code = 'complete' limit 1;
  if v_complete_plan is null then
    raise exception 'no complete subscription_plans row found — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_free_patient, 'vrfpg-test-free@example.invalid', 'x', now(), '{}', '{}'),
    (v_paid_patient, 'vrfpg-test-paid@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_free_patient, v_org, 'patient', 'VRFPG Test Free Patient'),
    (v_paid_patient, v_org, 'patient', 'VRFPG Test Paid Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- v_free_patient deliberately gets NO subscriptions row at all — the same
  -- state a real Tarragon Free patient is in.
  insert into public.subscriptions (organisation_id, subscriber_id, plan_id, status)
  values (v_org, v_paid_patient, v_complete_plan, 'active');

  insert into vrfpg_fixture(k, v) values
    ('org', v_org), ('free_patient', v_free_patient), ('paid_patient', v_paid_patient);
end $$;

-- ==========================================================================
-- 1. RED BP reading: paid patient gets a clinician_alerts row; free patient
--    gets none, plus an in_app suggestion.
-- ==========================================================================
do $$
declare
  v_org  uuid := (select v from vrfpg_fixture where k = 'org');
  v_free uuid := (select v from vrfpg_fixture where k = 'free_patient');
  v_paid uuid := (select v from vrfpg_fixture where k = 'paid_patient');
  v_reading_id uuid;
  v_alert_count integer;
  v_suggestion_count integer;
begin
  -- Paid patient: RED BP (systolic 170) -> clinician_alerts row, no suggestion.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_paid, 'blood_pressure', 170, 105, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 1 then
    raise exception 'FAIL: paid patient RED BP reading raised % clinician_alerts rows, expected 1', v_alert_count;
  end if;

  select count(*) into v_suggestion_count from public.notifications
    where recipient_id = v_paid and template = 'free_tier_reading_self_care_suggestion';
  if v_suggestion_count <> 0 then
    raise exception 'FAIL: paid patient unexpectedly got a free-tier self-care suggestion';
  end if;
  raise notice 'PASS 1: paid patient RED BP reading raised a clinician_alerts row, no suggestion';

  -- Free patient: identical RED BP reading -> NO clinician_alerts row, one suggestion.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_free, 'blood_pressure', 170, 105, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 0 then
    raise exception 'FAIL: free patient RED BP reading unexpectedly raised % clinician_alerts rows, expected 0', v_alert_count;
  end if;

  select count(*) into v_suggestion_count from public.notifications
    where recipient_id = v_free and channel = 'in_app' and template = 'free_tier_reading_self_care_suggestion';
  if v_suggestion_count <> 1 then
    raise exception 'FAIL: free patient RED BP reading raised % self-care suggestions, expected 1', v_suggestion_count;
  end if;
  raise notice 'PASS 2: free patient RED BP reading raised no clinician_alerts row, exactly one self-care suggestion';
end $$;

-- ==========================================================================
-- 2. EMERGENCY SpO2 reading: paid patient gets clinician_alerts (via
--    handle_emergency_event); free patient gets the emergency_events row
--    (full patient-facing safety net intact) but no clinician_alerts row,
--    plus a suggestion.
-- ==========================================================================
do $$
declare
  v_org  uuid := (select v from vrfpg_fixture where k = 'org');
  v_free uuid := (select v from vrfpg_fixture where k = 'free_patient');
  v_paid uuid := (select v from vrfpg_fixture where k = 'paid_patient');
  v_reading_id uuid;
  v_event record;
  v_alert_count integer;
  v_suggestion_count integer;
begin
  -- Paid patient: SpO2 85% (emergency) -> emergency_events row WITH a linked
  -- clinician_alert_id.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_paid, 'spo2', 85, now(), 'manual')
  returning id into v_reading_id;

  select id, clinician_alert_id into v_event
  from public.emergency_events where vital_reading_id = v_reading_id;

  if v_event.id is null then
    raise exception 'FAIL: paid patient EMERGENCY SpO2 reading raised no emergency_events row';
  end if;
  if v_event.clinician_alert_id is null then
    raise exception 'FAIL: paid patient EMERGENCY SpO2 reading raised an emergency_events row with no clinician_alert_id';
  end if;
  raise notice 'PASS 3: paid patient EMERGENCY SpO2 reading raised emergency_events + a linked clinician_alert';

  -- Free patient: identical EMERGENCY SpO2 reading -> emergency_events row
  -- WITHOUT a clinician_alert_id, plus a suggestion.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_free, 'spo2', 85, now(), 'manual')
  returning id into v_reading_id;

  select id, clinician_alert_id into v_event
  from public.emergency_events where vital_reading_id = v_reading_id;

  if v_event.id is null then
    raise exception 'FAIL: free patient EMERGENCY SpO2 reading raised no emergency_events row — the patient-facing safety net must survive plan-gating';
  end if;
  if v_event.clinician_alert_id is not null then
    raise exception 'FAIL: free patient EMERGENCY SpO2 reading unexpectedly raised a linked clinician_alert';
  end if;

  select count(*) into v_alert_count from public.clinician_alerts where id = v_event.clinician_alert_id;
  if v_alert_count <> 0 then
    raise exception 'FAIL: free patient EMERGENCY SpO2 reading created % clinician_alerts rows, expected 0', v_alert_count;
  end if;

  select count(*) into v_suggestion_count from public.notifications
    where recipient_id = v_free and channel = 'in_app' and template = 'free_tier_reading_self_care_suggestion';
  if v_suggestion_count <> 2 then
    raise exception 'FAIL: free patient has % self-care suggestions after two gated events, expected 2 (BP + SpO2)', v_suggestion_count;
  end if;
  raise notice 'PASS 4: free patient EMERGENCY SpO2 reading kept the full emergency_events safety net, raised no clinician_alert, added a suggestion';
  raise notice 'ALL VITALS_RED_FLAG_PLAN_GATE CHECKS PASSED';
end $$;

rollback;
