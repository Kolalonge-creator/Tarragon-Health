-- 12-week two-track chronic-care programme — pooled doctor-checkin slot
-- search (excludes Care Coordinator BY NAME, not by a doctor_tier-is-null
-- check, since care_coordinator is itself a non-null doctor_tier value —
-- this exact mistake was already made and fixed once elsewhere in this
-- codebase) and the medication titration snapshot trigger (fires only on a
-- real dose/frequency/etc change, never on a no-op touch, and is
-- trigger-only-write — no direct client INSERT is possible).
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test
-- convention.
begin;

do $$
declare
  v_org           uuid;
  v_doctor        uuid;
  v_prescriber    uuid;
  v_coordinator   uuid;
  v_patient       uuid;
  v_other_patient uuid;
  v_day           smallint;
  v_medication    uuid;
  v_version_count integer;
begin
  select id into v_coordinator from public.clinical_staff where doctor_tier = 'care_coordinator' and active limit 1;
  if v_coordinator is null then
    raise exception 'need an active care_coordinator clinical_staff row to run this test';
  end if;
  select organisation_id into v_org from public.clinical_staff where id = v_coordinator;

  select id into v_doctor from public.clinical_staff
    where organisation_id = v_org and active and doctor_tier is not null and doctor_tier <> 'care_coordinator'
  limit 1;
  if v_doctor is null then
    raise exception 'need an active real-doctor clinical_staff row in the same organisation to run this test';
  end if;

  -- Titration needs Tier 2+ prescribing authority (private.enforce_medication_confirm_only
  -- refuses a dose/frequency change below that, even for a superuser role —
  -- it's a plain trigger, not RLS, so it isn't bypassed).
  select id into v_prescriber from public.clinical_staff
    where organisation_id = v_org and active
      and doctor_tier in ('tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
  limit 1;
  if v_prescriber is null then
    raise exception 'need an active Tier 2+ clinical_staff row in the same organisation to run this test';
  end if;

  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient' limit 1;
  select id into v_other_patient from public.profiles where organisation_id = v_org and role = 'patient' and id <> v_patient limit 1;
  if v_patient is null or v_other_patient is null then
    raise exception 'need at least 2 patients in the organisation to run this test';
  end if;

  -- A day of week comfortably in the future within get_available_doctor_checkin_slots'
  -- default 13-day window, so the generated slot always lands inside it
  -- regardless of what day this test happens to run on.
  v_day := extract(dow from current_date + 3)::smallint;

  ---------------------------------------------------------------- 1. pooled slots include the doctor, never the coordinator
  insert into public.provider_availability_rules
    (organisation_id, clinician_id, day_of_week, start_time, end_time, consultation_method, appointment_types, slot_duration_minutes, buffer_minutes)
  values
    (v_org, (select profile_id from public.clinical_staff where id = v_doctor), v_day, '09:00', '11:00', 'telemedicine', array['follow_up']::public.appointment_type[], 30, 0),
    (v_org, (select profile_id from public.clinical_staff where id = v_coordinator), v_day, '09:00', '11:00', 'telemedicine', array['follow_up']::public.appointment_type[], 30, 0);

  -- get_available_appointment_slots (which this wraps) checks the caller is
  -- org staff for p_organisation_id via auth.uid() — simulate the patient's
  -- own assigned doctor calling it, same as the real booking flow would.
  perform set_config('request.jwt.claims', json_build_object('sub', (select profile_id from public.clinical_staff where id = v_doctor), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  if not exists (
    select 1 from public.get_available_doctor_checkin_slots(v_org, current_date, current_date + 13)
    where clinician_id = (select profile_id from public.clinical_staff where id = v_doctor)
  ) then
    raise exception 'FAIL 1: get_available_doctor_checkin_slots returned no slot for the real doctor''s freshly defined rule';
  end if;
  if exists (
    select 1 from public.get_available_doctor_checkin_slots(v_org, current_date, current_date + 13)
    where clinician_id = (select profile_id from public.clinical_staff where id = v_coordinator)
  ) then
    raise exception 'FAIL 1: get_available_doctor_checkin_slots returned a slot for the Care Coordinator — must be excluded by name';
  end if;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 2. titration snapshot fires only on a real change
  perform set_config('request.jwt.claims', json_build_object('sub', (select profile_id from public.clinical_staff where id = v_prescriber), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active)
  values (v_org, v_patient, 'QA Titration Test Med', '5mg', 'once daily', true)
  returning id into v_medication;

  -- A no-op touch (same values, only updated_at moves) must not snapshot.
  update public.medications set dose = '5mg' where id = v_medication;
  select count(*) into v_version_count from public.medication_dose_history where medication_id = v_medication;
  if v_version_count <> 0 then
    raise exception 'FAIL 2: a no-op UPDATE (same dose) created a titration snapshot (count=%)', v_version_count;
  end if;

  -- A real dose change must snapshot the OLD value, version 1.
  update public.medications set dose = '10mg' where id = v_medication;
  select count(*) into v_version_count from public.medication_dose_history where medication_id = v_medication;
  if v_version_count <> 1 then
    raise exception 'FAIL 2: a real dose change did not create exactly one titration snapshot (count=%)', v_version_count;
  end if;
  if not exists (
    select 1 from public.medication_dose_history
    where medication_id = v_medication and version_number = 1 and snapshot ->> 'dose' = '5mg'
  ) then
    raise exception 'FAIL 2: the snapshot does not hold the OLD dose (5mg) before the change to 10mg';
  end if;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 3. RLS: the patient can read their own titration history, another patient cannot
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if not exists (select 1 from public.medication_dose_history where medication_id = v_medication) then
    raise exception 'FAIL 3: the patient could not read their own titration history';
  end if;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_other_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.medication_dose_history where medication_id = v_medication) then
    raise exception 'FAIL 3: a different patient could read this patient''s titration history';
  end if;

  ---------------------------------------------------------------- 4. RLS: no direct client INSERT into medication_dose_history (trigger-only-write)
  begin
    insert into public.medication_dose_history
      (organisation_id, medication_id, patient_id, version_number, snapshot)
    values (v_org, v_medication, v_other_patient, 99, '{}'::jsonb);
    raise exception 'FAIL 4: a direct client INSERT into medication_dose_history was allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: pooled doctor-checkin search excludes the Care Coordinator by name, the titration trigger snapshots only on a real change with the correct OLD value, and medication_dose_history is trigger-only-write with patient-scoped read RLS';
end $$;

rollback;
