-- Tarragon Health — verification for the episodic-fee rebuild's entitlement
-- rewrite (20260830014719_entitlement_gates_use_programme_purchases.sql and
-- 20260830015233_entitlement_allowlist_missed_features.sql).
--
-- Replaces vitals_red_flag_plan_gate.sql's subscriptions-based fixture with a
-- programme_purchases one, proving the same shape of behaviour survived the
-- rebuild: a genuinely fresh patient with an ACTIVE programme purchase vs. a
-- genuinely fresh patient with NONE (never bought anything, and separately, a
-- lapsed purchase whose window has ended) — RED-range BP and EMERGENCY-range
-- SpO2 readings raise a clinician_alerts row for the covered patient and none
-- (plus an in_app self-care suggestion) for the uncovered ones, while the
-- emergency_events safety net stays unconditional for everyone regardless.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it, including a
-- temporary price on the hypertension programme (real pricing is admin-set
-- and may legitimately be NULL in production; this test sets one just for
-- the fixture and never commits it).

begin;

create temporary table ppeg_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org             uuid;
  v_covered_patient uuid := gen_random_uuid();
  v_none_patient    uuid := gen_random_uuid();
  v_lapsed_patient  uuid := gen_random_uuid();
  v_htn_programme   uuid;
begin
  select organisation_id into v_org
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_htn_programme from public.chronic_condition_programmes where code = 'hypertension';
  if v_htn_programme is null then
    raise exception 'no hypertension chronic_condition_programmes row found — cannot run this test';
  end if;

  -- A price must exist for the purchase trigger to accept an insert at all —
  -- set one just for this transaction regardless of what production has.
  update public.chronic_condition_programmes
    set price_kobo = 5000000, default_duration_weeks = coalesce(default_duration_weeks, 12)
  where id = v_htn_programme;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_covered_patient, 'ppeg-test-covered@example.invalid', 'x', now(), '{}', '{}'),
    (v_none_patient, 'ppeg-test-none@example.invalid', 'x', now(), '{}', '{}'),
    (v_lapsed_patient, 'ppeg-test-lapsed@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_covered_patient, v_org, 'patient', 'PPEG Test Covered Patient'),
    (v_none_patient, v_org, 'patient', 'PPEG Test No-Purchase Patient'),
    (v_lapsed_patient, v_org, 'patient', 'PPEG Test Lapsed Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- v_none_patient deliberately gets NO programme_purchases row at all — the
  -- same state a real patient who has never bought anything is in.
  --
  -- Insert-then-update, not a one-shot insert with status='active': the
  -- BEFORE INSERT trigger (private.set_programme_purchase_computed_price)
  -- unconditionally forces every new row to 'pending_payment' regardless of
  -- what the insert specifies — nobody, including this fixture, can forge an
  -- already-active purchase in one INSERT. This mirrors the real activation
  -- path (private.activate_programme_purchase_from_transaction), which only
  -- ever flips status via UPDATE.
  insert into public.programme_purchases (patient_id, programme_id)
  values (v_covered_patient, v_htn_programme), (v_lapsed_patient, v_htn_programme);

  update public.programme_purchases
    set status = 'active', starts_at = current_date, ends_at = current_date + interval '12 weeks',
        purchased_at = now(), payment_provider = 'paystack', payment_provider_ref = 'ppeg-covered-ref'
  where patient_id = v_covered_patient;

  update public.programme_purchases
    set status = 'expired', starts_at = current_date - interval '20 weeks', ends_at = current_date - interval '8 weeks',
        purchased_at = now() - interval '20 weeks', payment_provider = 'paystack', payment_provider_ref = 'ppeg-lapsed-ref'
  where patient_id = v_lapsed_patient;

  insert into ppeg_fixture(k, v) values
    ('org', v_org), ('covered_patient', v_covered_patient), ('none_patient', v_none_patient),
    ('lapsed_patient', v_lapsed_patient);
end $$;

-- ==========================================================================
-- 1. RED BP reading: covered patient gets a clinician_alerts row; the
--    no-purchase patient and the lapsed-purchase patient get none, plus a
--    self-care suggestion each.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from ppeg_fixture where k = 'org');
  v_covered uuid := (select v from ppeg_fixture where k = 'covered_patient');
  v_none    uuid := (select v from ppeg_fixture where k = 'none_patient');
  v_lapsed  uuid := (select v from ppeg_fixture where k = 'lapsed_patient');
  v_reading_id uuid;
  v_alert_count integer;
  v_suggestion_count integer;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_covered, 'blood_pressure', 170, 105, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 1 then
    raise exception 'FAIL: covered patient RED BP reading raised % clinician_alerts rows, expected 1', v_alert_count;
  end if;
  raise notice 'PASS 1: covered patient RED BP reading raised a clinician_alerts row';

  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_none, 'blood_pressure', 170, 105, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 0 then
    raise exception 'FAIL: no-purchase patient RED BP reading unexpectedly raised % clinician_alerts rows, expected 0', v_alert_count;
  end if;

  select count(*) into v_suggestion_count from public.notifications
    where recipient_id = v_none and channel = 'in_app' and template = 'free_tier_reading_self_care_suggestion';
  if v_suggestion_count <> 1 then
    raise exception 'FAIL: no-purchase patient RED BP reading raised % self-care suggestions, expected 1', v_suggestion_count;
  end if;
  raise notice 'PASS 2: no-purchase patient RED BP reading raised no clinician_alerts row, one self-care suggestion';

  -- Sabotage check inline: a lapsed (expired) purchase must behave exactly
  -- like no purchase at all, proving ends_at is actually enforced rather than
  -- merely the presence of a programme_purchases row.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_lapsed, 'blood_pressure', 170, 105, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_alert_count from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert_count <> 0 then
    raise exception 'FAIL: lapsed-purchase patient RED BP reading raised % clinician_alerts rows, expected 0 — ends_at is not being enforced', v_alert_count;
  end if;
  raise notice 'PASS 3: lapsed-purchase patient (ends_at in the past) is treated exactly like no purchase at all';
end $$;

-- ==========================================================================
-- 2. EMERGENCY SpO2 reading: covered patient gets clinician_alerts (via
--    handle_emergency_event); no-purchase patient gets the emergency_events
--    row (full patient-facing safety net intact) but no clinician_alerts row.
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from ppeg_fixture where k = 'org');
  v_covered uuid := (select v from ppeg_fixture where k = 'covered_patient');
  v_none    uuid := (select v from ppeg_fixture where k = 'none_patient');
  v_reading_id uuid;
  v_event record;
  v_alert_count integer;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_covered, 'spo2', 85, now(), 'manual')
  returning id into v_reading_id;

  select id, clinician_alert_id into v_event
  from public.emergency_events where vital_reading_id = v_reading_id;

  if v_event.id is null then
    raise exception 'FAIL: covered patient EMERGENCY SpO2 reading raised no emergency_events row';
  end if;
  if v_event.clinician_alert_id is null then
    raise exception 'FAIL: covered patient EMERGENCY SpO2 reading raised an emergency_events row with no clinician_alert_id';
  end if;
  raise notice 'PASS 4: covered patient EMERGENCY SpO2 reading raised emergency_events + a linked clinician_alert';

  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_none, 'spo2', 85, now(), 'manual')
  returning id into v_reading_id;

  select id, clinician_alert_id into v_event
  from public.emergency_events where vital_reading_id = v_reading_id;

  if v_event.id is null then
    raise exception 'FAIL: no-purchase patient EMERGENCY SpO2 reading raised no emergency_events row — the patient-facing safety net must survive purchase-gating';
  end if;
  if v_event.clinician_alert_id is not null then
    raise exception 'FAIL: no-purchase patient EMERGENCY SpO2 reading unexpectedly raised a linked clinician_alert';
  end if;
  raise notice 'PASS 5: no-purchase patient EMERGENCY SpO2 reading kept the full emergency_events safety net, raised no clinician_alert';
  raise notice 'ALL PROGRAMME_PURCHASE_ENTITLEMENT_GATE CHECKS PASSED';
end $$;

rollback;
