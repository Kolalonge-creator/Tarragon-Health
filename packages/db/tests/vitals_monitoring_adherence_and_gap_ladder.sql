-- Tarragon Health — monitoring schedule auto-seed, baseline capture, and
-- adherence computation verification
--
-- Proves (1) enrolling a patient in the (live) hypertension programme
-- auto-seeds a monitoring_schedule_items row per programme.monitoring_vitals
-- at the expected default frequency, (2) the first matching reading sets
-- that item's baseline, and doesn't overwrite it on a second reading, and
-- (3) public.patient_vitals_adherence()'s expected/completed/adherence%
-- math is correct for a same-day window.
--
-- Uses a freshly created synthetic patient (not a shared seed patient) so
-- this can't collide with any pre-existing enrolment/schedule state.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org         uuid;
  v_patient     uuid := gen_random_uuid();
  v_programme   record;
  v_bp_item     record;
  v_adherence   record;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'vmagl-test-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'VMAGL Test Patient');

  select id, condition, monitoring_vitals into v_programme
  from public.chronic_condition_programmes
  where code = 'hypertension' and is_active;

  if v_programme.id is null then
    raise exception 'FAIL: no active hypertension programme found — cannot run this test';
  end if;

  -- 1) Enrolling seeds a monitoring_schedule_items row per monitored vital.
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status, source)
  values (v_org, v_patient, v_programme.id, 'enrolled', 'clinician');

  select * into v_bp_item
  from public.monitoring_schedule_items
  where patient_id = v_patient and vital_type = 'blood_pressure' and status = 'active';

  if v_bp_item.id is null then
    raise exception 'FAIL: enrolling in hypertension did not seed a blood_pressure monitoring_schedule_items row';
  end if;
  if v_bp_item.frequency_per_week <> private.default_monitoring_frequency('hypertension', 'blood_pressure') then
    raise exception 'FAIL: seeded BP frequency_per_week = % (expected %)',
      v_bp_item.frequency_per_week, private.default_monitoring_frequency('hypertension', 'blood_pressure');
  end if;
  if v_bp_item.baseline_value is not null then
    raise exception 'FAIL: a freshly seeded schedule item already has a baseline before any reading exists';
  end if;
  raise notice 'PASS 1: enrolment auto-seeded blood_pressure monitoring_schedule_items at frequency %', v_bp_item.frequency_per_week;

  -- 2) First matching reading sets the baseline; a second does not overwrite it.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (v_org, v_patient, 'blood_pressure', 156, 96, 'seated', 'left', now(), 'manual');

  select * into v_bp_item from public.monitoring_schedule_items where id = v_bp_item.id;
  if v_bp_item.baseline_value is distinct from jsonb_build_object('systolic', 156, 'diastolic', 96) then
    raise exception 'FAIL: baseline not set from first reading (got %)', v_bp_item.baseline_value;
  end if;
  if v_bp_item.baseline_source <> 'first_reading' then
    raise exception 'FAIL: baseline_source = % (expected first_reading)', v_bp_item.baseline_source;
  end if;

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (v_org, v_patient, 'blood_pressure', 122, 80, 'seated', 'left', now(), 'manual');

  select * into v_bp_item from public.monitoring_schedule_items where id = v_bp_item.id;
  if v_bp_item.baseline_value is distinct from jsonb_build_object('systolic', 156, 'diastolic', 96) then
    raise exception 'FAIL: baseline was overwritten by a later reading (got %)', v_bp_item.baseline_value;
  end if;
  raise notice 'PASS 2: baseline captured from first reading only, not overwritten';

  -- 3) Adherence math. Both readings above land on "day 0" of the window
  --    (start_date = current_date), so expected_count = ceil(freq*1/7) = 1
  --    for a 3x/week item, completed_count = 2 (the two readings just
  --    logged), and adherence_pct is capped at 100 rather than reading 200.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, position, arm, taken_at, source)
  values (v_org, v_patient, 'blood_pressure', 130, 84, 'seated', 'left', now(), 'manual');

  select * into v_adherence
  from public.patient_vitals_adherence(v_patient, 28)
  where vital_type = 'blood_pressure';

  if v_adherence.expected_count <> 1 then
    raise exception 'FAIL: expected_count = % (expected 1 for a same-day 3x/week item)', v_adherence.expected_count;
  end if;
  if v_adherence.completed_count <> 3 then
    raise exception 'FAIL: completed_count = % (expected 3 BP readings logged)', v_adherence.completed_count;
  end if;
  if v_adherence.adherence_pct <> 100 then
    raise exception 'FAIL: adherence_pct = % (expected 100, capped rather than exceeding it)', v_adherence.adherence_pct;
  end if;
  if v_adherence.missed_count <> 0 then
    raise exception 'FAIL: missed_count = % (expected 0)', v_adherence.missed_count;
  end if;
  raise notice 'PASS 3: patient_vitals_adherence() expected/completed/adherence_pct math correct';

  raise notice 'ALL VITALS_MONITORING_ADHERENCE_AND_GAP_LADDER CHECKS PASSED';
end $$;

rollback;
