-- Tarragon Health — heart failure RPM weight-gain deterioration alert
-- verification
--
-- Proves (1) a >2kg gain within 3 days for a patient ENROLLED in the
-- heart_failure programme raises a Priority-1 clinician_alerts row with a
-- 4-hour SLA, (2) the same gain for a patient NOT enrolled in heart_failure
-- raises nothing (must not fire for an unrelated weight swing), and (3) a
-- second qualifying gain refreshes the same alert rather than duplicating
-- it.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org              uuid;
  v_hf_patient        uuid := gen_random_uuid();
  v_control_patient   uuid := gen_random_uuid();
  v_hf_programme_id   uuid;
  v_alert             record;
  v_alert_count       integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_hf_patient, 'hfrpm-test-hf@example.invalid', 'x', now(), '{}', '{}'),
    (v_control_patient, 'hfrpm-test-control@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_hf_patient, v_org, 'patient', 'HFRPM Test HF Patient'),
    (v_control_patient, v_org, 'patient', 'HFRPM Test Control Patient');

  select id into v_hf_programme_id
  from public.chronic_condition_programmes where code = 'heart_failure';

  if v_hf_programme_id is null then
    raise exception 'FAIL: no heart_failure programme row found — cannot run this test';
  end if;

  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status, source)
  values (v_org, v_hf_patient, v_hf_programme_id, 'enrolled', 'clinician');

  -- 1) Baseline weight 2 days ago, then a >2kg gain today for the HF patient.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_hf_patient, 'weight', 80.0, now() - interval '2 days', 'manual');

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_hf_patient, 'weight', 82.5, now(), 'manual');

  select * into v_alert
  from public.clinician_alerts
  where patient_id = v_hf_patient and title = 'Heart failure: rapid weight gain' and status = 'open';

  if v_alert.id is null then
    raise exception 'FAIL: a 2.5kg gain in 2 days for an enrolled heart_failure patient raised no alert';
  end if;
  if v_alert.level <> 'urgent_escalation' or v_alert.escalation_level <> 3 then
    raise exception 'FAIL: heart failure weight-gain alert level/escalation = %/% (expected urgent_escalation/3)',
      v_alert.level, v_alert.escalation_level;
  end if;
  if v_alert.sla_due_at > now() + interval '4 hours 1 minute' or v_alert.sla_due_at < now() + interval '3 hours 59 minutes' then
    raise exception 'FAIL: heart failure weight-gain alert sla_due_at not ~4 hours out (got %)', v_alert.sla_due_at;
  end if;
  raise notice 'PASS 1: >2kg/3-day gain for an enrolled heart_failure patient raised a Priority-1, 4-hour-SLA alert';

  -- 2) The SAME gain pattern for a patient NOT enrolled in heart_failure
  --    must raise nothing under this mechanism.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_control_patient, 'weight', 80.0, now() - interval '2 days', 'manual');

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_control_patient, 'weight', 82.5, now(), 'manual');

  if exists (
    select 1 from public.clinician_alerts
    where patient_id = v_control_patient and title = 'Heart failure: rapid weight gain'
  ) then
    raise exception 'FAIL: the same weight-gain pattern raised a heart-failure alert for a non-enrolled patient';
  end if;
  raise notice 'PASS 2: an unrelated (non-heart_failure) patient with the same gain pattern raised nothing';

  -- 3) A second qualifying gain refreshes the existing alert, not a duplicate.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_hf_patient, 'weight', 85.5, now() + interval '10 minutes', 'manual');

  select count(*) into v_alert_count
  from public.clinician_alerts
  where patient_id = v_hf_patient and title = 'Heart failure: rapid weight gain';

  if v_alert_count <> 1 then
    raise exception 'FAIL: a second qualifying gain created % alert rows (expected exactly 1, refreshed not duplicated)', v_alert_count;
  end if;
  raise notice 'PASS 3: a second qualifying gain refreshed the existing alert rather than duplicating it';

  raise notice 'ALL HEART_FAILURE_RPM_WEIGHT_GAIN_ALERT CHECKS PASSED';
end $$;

rollback;
