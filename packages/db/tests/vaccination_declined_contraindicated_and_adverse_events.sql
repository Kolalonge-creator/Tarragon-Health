-- Tarragon Health — Vaccination & Immunisation Engine gap closure verification
--
-- Proves the three additions in this change set, run inside a transaction
-- that is always rolled back — nothing here should ever be committed:
--   1. A patient can decline their own due vaccine; a Care Coordinator
--      (org staff, non-clinical) cannot mark one contraindicated, but a
--      clinical-tier doctor can, and attribution is server-derived.
--   2. A significant adverse-event report (severe, or an allergic reaction
--      at any severity) raises a real clinician_alerts row; a mild report
--      with no allergic-reaction symptom does not.
--   3. A patient cannot report an adverse event against a dose that belongs
--      to a different patient (the FK-ownership cross-check).
--
-- Run: paste into the SQL editor / apply via execute_sql, wrapped in
-- `begin; ... rollback;` (already included below).

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_catalog_id uuid;
  v_patient_profile uuid := gen_random_uuid();
  v_other_patient_profile uuid := gen_random_uuid();
  v_coordinator_profile uuid := gen_random_uuid();
  v_doctor_profile uuid := gen_random_uuid();
  v_doctor_staff uuid;
  v_schedule_id uuid;
  v_other_schedule_id uuid;
  v_record_id uuid;
  v_other_record_id uuid;
  v_event_id uuid;
  v_failed boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  select id into v_catalog_id from public.vaccination_catalog limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient_profile, 'vax-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other_patient_profile, 'vax-test-other-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_coordinator_profile, 'vax-test-coordinator@example.invalid', 'x', now(), '{}', '{}'),
    (v_doctor_profile, 'vax-test-doctor@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Vax Test Patient'
    where id = v_patient_profile;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Vax Test Other Patient'
    where id = v_other_patient_profile;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Vax Test Coordinator'
    where id = v_coordinator_profile;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Vax Test Doctor'
    where id = v_doctor_profile;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_coordinator_profile, v_org, 'Vax Test Coordinator', 'care_coordinator', false, true, 'MDCN', 'VAXTEST-COORD-001', true, v_verifier, v_verifier, now());

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_doctor_profile, v_org, 'Vax Test Doctor', 'tier_2', false, true, 'MDCN', 'VAXTEST-DOC-001', true, v_verifier, v_verifier, now())
  returning id into v_doctor_staff;

  -- ---------------------------------------------------------------------
  -- 1) Declined / contraindicated
  -- ---------------------------------------------------------------------
  insert into public.vaccination_schedules (organisation_id, patient_id, vaccination_catalog_id, status, due_date)
  values (v_org, v_patient_profile, v_catalog_id, 'pending', current_date)
  returning id into v_schedule_id;

  -- The patient declines their own due vaccine.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.vaccination_schedules
    set non_administration_reason = 'declined', non_administration_note = 'Personal choice'
    where id = v_schedule_id;
  reset role;

  if not exists (
    select 1 from public.vaccination_schedules
    where id = v_schedule_id
      and status = 'cancelled'
      and non_administration_reason = 'declined'
      and non_administration_recorded_by = v_patient_profile
      and non_administration_recorded_at is not null
  ) then
    raise exception 'FAIL: patient decline was not recorded/attributed correctly';
  end if;

  -- A Care Coordinator (org staff, non-clinical) cannot mark contraindicated.
  insert into public.vaccination_schedules (organisation_id, patient_id, vaccination_catalog_id, status, due_date)
  values (v_org, v_patient_profile, v_catalog_id, 'pending', current_date)
  returning id into v_other_schedule_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coordinator_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.vaccination_schedules
      set non_administration_reason = 'contraindicated', non_administration_note = 'Should be rejected'
      where id = v_other_schedule_id;
    v_failed := true; -- should not reach here
  exception when others then
    null; -- expected
  end;
  reset role;
  if v_failed then
    raise exception 'FAIL: a Care Coordinator was able to mark a vaccine contraindicated';
  end if;

  -- A real clinical-tier doctor CAN, and attribution is server-derived.
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.vaccination_schedules
    set non_administration_reason = 'contraindicated', non_administration_note = 'Prior anaphylaxis'
    where id = v_other_schedule_id;
  reset role;

  if not exists (
    select 1 from public.vaccination_schedules
    where id = v_other_schedule_id
      and status = 'cancelled'
      and non_administration_reason = 'contraindicated'
      and non_administration_recorded_by = v_doctor_profile
  ) then
    raise exception 'FAIL: doctor contraindication was not recorded/attributed correctly';
  end if;

  -- ---------------------------------------------------------------------
  -- 2) Adverse events — significant vs. non-significant routing
  -- ---------------------------------------------------------------------
  insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered)
  values (v_org, v_patient_profile, v_catalog_id, 1, current_date - 1)
  returning id into v_record_id;

  insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered)
  values (v_org, v_other_patient_profile, v_catalog_id, 1, current_date - 1)
  returning id into v_other_record_id;

  -- A mild report with no allergic-reaction symptom raises no alert.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.vaccination_adverse_events (organisation_id, patient_id, vaccination_record_id, symptoms, severity)
  values (v_org, v_patient_profile, v_record_id, array['pain_at_site']::public.vaccination_adverse_event_symptom[], 'mild')
  returning id into v_event_id;
  reset role;

  if exists (select 1 from public.vaccination_adverse_events where id = v_event_id and alert_id is not null) then
    raise exception 'FAIL: a mild, non-allergic report raised an alert';
  end if;
  if not exists (
    select 1 from public.vaccination_adverse_events where id = v_event_id and reported_by = v_patient_profile
  ) then
    raise exception 'FAIL: reported_by was not server-derived';
  end if;

  -- A severe report raises a real clinician_alerts row tagged symptom_escalation.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.vaccination_adverse_events (organisation_id, patient_id, vaccination_record_id, symptoms, severity, description)
  values (v_org, v_patient_profile, v_record_id, array['fever', 'allergic_reaction']::public.vaccination_adverse_event_symptom[], 'severe', 'Widespread hives and fever')
  returning id into v_event_id;
  reset role;

  if not exists (
    select 1 from public.vaccination_adverse_events vae
    join public.clinician_alerts ca on ca.id = vae.alert_id
    where vae.id = v_event_id
      and ca.type_code = 'symptom_escalation'
      and ca.category = 'clinical'
      and ca.level = 'emergency'
      and ca.patient_id = v_patient_profile
  ) then
    raise exception 'FAIL: a severe allergic-reaction report did not raise the expected clinician_alerts row';
  end if;

  -- 3) A patient cannot report against a dose belonging to a different patient.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_failed := false;
  begin
    insert into public.vaccination_adverse_events (organisation_id, patient_id, vaccination_record_id, symptoms, severity)
    values (v_org, v_patient_profile, v_other_record_id, array['fever']::public.vaccination_adverse_event_symptom[], 'mild');
    v_failed := true; -- should not reach here
  exception when others then
    null; -- expected
  end;
  reset role;
  if v_failed then
    raise exception 'FAIL: reported against a dose belonging to a different patient';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
