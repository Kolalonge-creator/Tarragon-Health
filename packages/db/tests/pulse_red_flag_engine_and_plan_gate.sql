-- Tarragon Health — verification for 20260829140000_pulse_red_flag_engine.sql
--
-- Proves, for a genuinely fresh Free-tier patient (no service_purchases row
-- at all) vs. a genuinely fresh paid-tier patient (an active complete_pack
-- purchase): a RED-range pulse reading raises a clinician_alerts row for
-- the paid patient and raises NO clinician_alerts row plus an in_app
-- self-care suggestion for the free patient (mirrors
-- vitals_red_flag_plan_gate.sql's BP case). Also proves an EMERGENCY-range
-- pulse reading gets the same treatment via emergency_events, and that a
-- routine (GREEN) reading raises nothing at all — the trigger must not fire
-- on every ordinary heart-rate log.
--
-- Updated 2026-09-03 for the pay-per-service migration, matching
-- vitals_red_flag_plan_gate.sql: "paid" is now an active service_purchases
-- row (complete_pack) rather than a subscriptions row —
-- private.patient_has_feature_access itself was repointed at
-- service_purchases (20260831141943_rewire_feature_access_to_service_purchases.sql),
-- so this fixture was left checking a table the gate no longer reads at all,
-- meaning the "paid patient" branch was never actually exercised as paid.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.

begin;

create temporary table prfe_fixture(k text primary key, v uuid) on commit drop;

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

  select id into v_complete_plan from public.service_products where code = 'complete_pack' limit 1;
  if v_complete_plan is null then
    raise exception 'no complete_pack service_products row found — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_free_patient, 'prfe-test-free@example.invalid', 'x', now(), '{}', '{}'),
    (v_paid_patient, 'prfe-test-paid@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_free_patient, v_org, 'patient', 'PRFE Test Free Patient'),
    (v_paid_patient, v_org, 'patient', 'PRFE Test Paid Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- v_free_patient deliberately gets NO service_purchases row at all — the
  -- same state a real Tarragon Free patient is in.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_paid_patient, v_paid_patient, v_complete_plan, 'active', 2000000, 'NGN', now(), now() + interval '30 days');

  insert into prfe_fixture(k, v) values
    ('org', v_org), ('free_patient', v_free_patient), ('paid_patient', v_paid_patient);
end $$;

-- ==========================================================================
-- 1. GREEN pulse reading: nothing raised for either patient — the trigger
--    must not fire on an ordinary heart rate.
-- ==========================================================================
do $$
declare
  v_org  uuid := (select v from prfe_fixture where k = 'org');
  v_paid uuid := (select v from prfe_fixture where k = 'paid_patient');
  v_reading_id uuid;
  v_alert_count integer;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  values (gen_random_uuid(), v_org, v_paid, 'pulse', 72, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 0 then
    raise exception 'FAIL: a routine 72 bpm reading raised % clinician_alerts rows, expected 0', v_alert_count;
  end if;
  if exists (select 1 from public.emergency_events where vital_reading_id = v_reading_id) then
    raise exception 'FAIL: a routine 72 bpm reading raised an emergency_events row';
  end if;
  raise notice 'PASS 1: routine heart rate reading raised nothing';
end $$;

-- ==========================================================================
-- 2. RED pulse reading (130 bpm, sourced as if from a wearable): paid patient
--    gets a clinician_alerts row; free patient gets none, plus an in_app
--    suggestion that mentions checking with a proper device.
-- ==========================================================================
do $$
declare
  v_org  uuid := (select v from prfe_fixture where k = 'org');
  v_free uuid := (select v from prfe_fixture where k = 'free_patient');
  v_paid uuid := (select v from prfe_fixture where k = 'paid_patient');
  v_reading_id uuid;
  v_alert_count integer;
  v_suggestion_count integer;
begin
  -- Paid patient: RED heart rate (130 bpm) -> clinician_alerts row, no suggestion.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  values (gen_random_uuid(), v_org, v_paid, 'pulse', 130, now(), 'wearable')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 1 then
    raise exception 'FAIL: paid patient RED pulse reading raised % clinician_alerts rows, expected 1', v_alert_count;
  end if;

  select count(*) into v_suggestion_count from public.notifications
    where recipient_id = v_paid and template = 'free_tier_reading_self_care_suggestion';
  if v_suggestion_count <> 0 then
    raise exception 'FAIL: paid patient unexpectedly got a free-tier self-care suggestion';
  end if;
  raise notice 'PASS 2: paid patient RED pulse reading raised a clinician_alerts row, no suggestion';

  -- Free patient: identical RED wearable pulse reading -> NO clinician_alerts
  -- row, one suggestion that does not depend on a doctor.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  values (gen_random_uuid(), v_org, v_free, 'pulse', 130, now(), 'wearable')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 0 then
    raise exception 'FAIL: free patient RED pulse reading unexpectedly raised % clinician_alerts rows, expected 0', v_alert_count;
  end if;

  select count(*) into v_suggestion_count from public.notifications
    where recipient_id = v_free and channel = 'in_app' and template = 'free_tier_reading_self_care_suggestion';
  if v_suggestion_count <> 1 then
    raise exception 'FAIL: free patient RED pulse reading raised % self-care suggestions, expected 1', v_suggestion_count;
  end if;
  raise notice 'PASS 3: free patient RED wearable pulse reading raised no clinician_alerts row, exactly one self-care suggestion';
end $$;

-- ==========================================================================
-- 3. EMERGENCY pulse reading (180 bpm): paid patient gets clinician_alerts
--    (via handle_emergency_event); free patient gets the emergency_events
--    row (full patient-facing safety net intact — the acknowledge-gated
--    hospital-now dialog reads this table directly) but no clinician_alerts
--    row, plus a suggestion.
-- ==========================================================================
do $$
declare
  v_org  uuid := (select v from prfe_fixture where k = 'org');
  v_free uuid := (select v from prfe_fixture where k = 'free_patient');
  v_paid uuid := (select v from prfe_fixture where k = 'paid_patient');
  v_reading_id uuid;
  v_event record;
  v_suggestion_count integer;
begin
  -- Paid patient: 180 bpm (emergency) -> emergency_events row WITH a linked
  -- clinician_alert_id.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  values (gen_random_uuid(), v_org, v_paid, 'pulse', 180, now(), 'wearable')
  returning id into v_reading_id;

  select id, clinician_alert_id into v_event
  from public.emergency_events where vital_reading_id = v_reading_id;

  if v_event.id is null then
    raise exception 'FAIL: paid patient EMERGENCY pulse reading raised no emergency_events row';
  end if;
  if v_event.clinician_alert_id is null then
    raise exception 'FAIL: paid patient EMERGENCY pulse reading raised an emergency_events row with no clinician_alert_id';
  end if;
  raise notice 'PASS 4: paid patient EMERGENCY pulse reading raised emergency_events + a linked clinician_alert';

  -- Free patient: identical EMERGENCY wearable pulse reading -> emergency_events
  -- row WITHOUT a clinician_alert_id (the patient's own safety net survives
  -- plan-gating), plus a suggestion — the whole point of this feature.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  values (gen_random_uuid(), v_org, v_free, 'pulse', 180, now(), 'wearable')
  returning id into v_reading_id;

  select id, clinician_alert_id into v_event
  from public.emergency_events where vital_reading_id = v_reading_id;

  if v_event.id is null then
    raise exception 'FAIL: free patient EMERGENCY pulse reading raised no emergency_events row — a dangerous wearable reading must never be silently dropped';
  end if;
  if v_event.clinician_alert_id is not null then
    raise exception 'FAIL: free patient EMERGENCY pulse reading unexpectedly raised a linked clinician_alert';
  end if;

  select count(*) into v_suggestion_count from public.notifications
    where recipient_id = v_free and channel = 'in_app' and template = 'free_tier_reading_self_care_suggestion';
  if v_suggestion_count <> 2 then
    raise exception 'FAIL: free patient has % self-care suggestions after two gated pulse events, expected 2 (RED + EMERGENCY)', v_suggestion_count;
  end if;
  raise notice 'PASS 5: free patient EMERGENCY wearable pulse reading kept the full emergency_events safety net, raised no clinician_alert, added a suggestion';
  raise notice 'ALL PULSE_RED_FLAG_ENGINE_AND_PLAN_GATE CHECKS PASSED';
end $$;

rollback;
