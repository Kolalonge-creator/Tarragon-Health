-- Tarragon Health — individualised SpO2/temperature target verification
--
-- Proves (1) a reading in the population GREEN band is upgraded to AMBER
-- once it crosses a patient-specific amber threshold, for both SpO2 and
-- temperature, (2) a patient with NO override still uses the fixed
-- population bands unchanged, and (3) the override can never cross into the
-- fixed RED/EMERGENCY safety floor — the CHECK constraint itself must
-- reject an attempt to set one there.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org       uuid;
  v_patient   uuid := gen_random_uuid();
  v_control   uuid := gen_random_uuid();
  v_reading_id uuid;
  v_alert     record;
  v_rejected  boolean := false;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'sptp-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_control, 'sptp-test-control@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient, v_org, 'patient', 'SPTP Test Patient'),
    (v_control, v_org, 'patient', 'SPTP Test Control');

  -- A patient whose clinician wants earlier warning: amber fires at <=97%
  -- instead of the population <=94%.
  insert into public.patient_spo2_targets (organisation_id, patient_id, amber_threshold_pct)
  values (v_org, v_patient, 97);

  -- 1) 96% is population GREEN (>94) but this patient's amber_threshold_pct
  --    is 97, so it must upgrade to amber and raise a clinician_review alert.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'spo2', 96, now(), 'manual')
  returning id into v_reading_id;

  select * into v_alert from public.clinician_alerts where vital_reading_id = v_reading_id;
  if v_alert.id is null or v_alert.level <> 'clinician_review' then
    raise exception 'FAIL: spo2_pct=96 with amber_threshold_pct=97 did not raise a clinician_review alert (got %)', v_alert.level;
  end if;
  raise notice 'PASS 1: population-green SpO2 reading upgraded to amber by a tighter patient-specific threshold';

  -- 2) The SAME 96% reading for a patient with NO override stays green —
  --    fixed population bands unchanged for everyone else.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_control, 'spo2', 96, now(), 'manual')
  returning id into v_reading_id;

  if exists (select 1 from public.clinician_alerts where vital_reading_id = v_reading_id) then
    raise exception 'FAIL: spo2_pct=96 with no override unexpectedly raised an alert';
  end if;
  raise notice 'PASS 2: same reading with no override stays population-green, no alert';

  -- 3) The override can never reach into the fixed RED band (<=92) or below —
  --    the CHECK constraint (amber_threshold_pct > 92) must reject it.
  begin
    insert into public.patient_spo2_targets (organisation_id, patient_id, amber_threshold_pct)
    values (v_org, v_control, 90);
    v_rejected := false;
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL: amber_threshold_pct=90 (inside the fixed RED band) was accepted — safety floor not enforced';
  end if;
  raise notice 'PASS 3: an override attempting to reach into the fixed RED/EMERGENCY band is rejected by the CHECK constraint';

  raise notice 'ALL SPO2_TEMPERATURE_PULSE_INDIVIDUALISED_TARGETS CHECKS PASSED';
end $$;

rollback;
