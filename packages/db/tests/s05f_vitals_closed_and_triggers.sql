-- ===========================================================================
-- Proof: *_s05f_close_staff_access_vitals_readings.sql (S05f piece D2; INV-10, INV-12).
--
-- Proves, with simulated sessions: after the closing migration a tied clinician, an untied clinician, an admin, a pharmacist and another
-- organisation's clinician read, insert, update and delete NOTHING directly in vitals_readings, while the tied clinician still gets the
-- rows through the audited read (the gate opens); the patient reads, inserts and updates her own readings; an acting supporter still
-- logs one; a caregiver grant still reads. The 17 triggers still fire for a patient's insert: a hypertensive-crisis BP, a low SpO2 and
-- a dangerous pulse each raise an emergency event, the manual timestamp is stamped, a duplicate is flagged. SABOTAGE 1: restoring the
-- old staff policies lets an untied clinician read. SABOTAGE 2: dropping the BP red-flag trigger stops the emergency event, so the
-- trigger assertions can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_cg uuid := gen_random_uuid();
  v_pa uuid;
  v_who uuid;
  v_id uuid;
  v_json jsonb;
  v_n integer;
  v_before integer;
  v_failed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05f D2 Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's05fd2-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_tied, v_untied, v_admin, v_pharm, v_other, v_sup, v_cg]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',    'S05fD2 Patient',     '+2348058880201'),
    (v_tied,   v_org,  'clinician',  'S05fD2 Tied Doctor', '+2348058880202'),
    (v_untied, v_org,  'clinician',  'S05fD2 Untied Doctor','+2348058880203'),
    (v_admin,  v_org,  'admin',      'S05fD2 Admin',       '+2348058880204'),
    (v_pharm,  v_org,  'pharmacist', 'S05fD2 Pharmacist',  '+2348058880205'),
    (v_other,  v_org2, 'clinician',  'S05fD2 Other Org Dr','+2348058880206'),
    (v_sup,    v_org,  'patient',    'S05fD2 Supporter',   '+2348058880207'),
    (v_cg,     v_org,  'patient',    'S05fD2 Caregiver',   '+2348058880208')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org,  v_tied,   'S05fD2 Tied Doctor',   true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FD2-1', now() + interval '1 year'),
    (v_org,  v_untied, 'S05fD2 Untied Doctor', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FD2-2', now() + interval '1 year'),
    (v_org2, v_other,  'S05fD2 Other Org Dr',  true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FD2-3', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_cg, v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'vitals_readings');
  perform set_config('request.jwt.claims', null, true);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level) values (v_pat, v_sup, v_pat, 'manage');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_pat, 'weight', 70.5, now() - interval '1 day', 'device');

  -- 1. staff read, insert, update and delete nothing directly (the tied clinician too); the audited read still opens for the tied one
  foreach v_who in array array[v_tied, v_untied, v_admin, v_pharm, v_other] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_n from public.vitals_readings;
    if v_n <> 0 then execute 'reset role'; raise exception 'FAIL 1a: % read % rows directly', v_who, v_n; end if;
    v_failed := false;
    begin insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source) values (v_org, v_pat, 'weight', 99, 'manual');
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL 1b: % inserted a reading directly', v_who; end if;
    update public.vitals_readings set weight_kg = 1 where patient_id = v_pat;
    get diagnostics v_n = row_count;
    if v_n <> 0 then execute 'reset role'; raise exception 'FAIL 1c: % updated % rows', v_who, v_n; end if;
    delete from public.vitals_readings where patient_id = v_pat;
    get diagnostics v_n = row_count;
    execute 'reset role';
    if v_n <> 0 then raise exception 'FAIL 1d: % deleted % rows', v_who, v_n; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_vitals_audited(v_pat, 'S05fD2 proof: tied review') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 1 then raise exception 'FAIL 1e: the tied clinician lost the audited read: %', v_json; end if;

  -- 2. the patient reads and writes her own; the caregiver reads; an acting supporter logs one
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.vitals_readings;
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 2a: the patient reads % rows, expected 1', v_n; end if;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, source) values (v_org, v_pat, 'glucose', 5.4, 'manual') returning id into v_id;
  select count(*) into v_n from public.vitals_readings;
  execute 'reset role';
  if v_n <> 2 then raise exception 'FAIL 2b: the patient did not read back her own insert (% rows)', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.vitals_readings;
  execute 'reset role';
  if v_n <> 2 then raise exception 'FAIL 2c: the caregiver reads % rows, expected 2 (the gate must open)', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source) values (v_org, v_pat, 'weight', 71, 'manual');
  execute 'reset role';
  if not exists (select 1 from public.vitals_readings where patient_id = v_pat and logged_by_profile_id = v_sup) then
    raise exception 'FAIL 2d: the acting supporter reading was not stamped with her profile';
  end if;

  -- 3. the red-flag and stamping triggers still fire for a patient's insert (a crisis BP, a low SpO2 and a dangerous pulse)
  select count(*) into v_before from public.emergency_events where patient_id = v_pat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_pat, 'blood_pressure', 210, 130, 'manual');
  execute 'reset role';
  select count(*) into v_n from public.emergency_events where patient_id = v_pat;
  if v_n <= v_before then raise exception 'FAIL 3a: a hypertensive-crisis BP raised no emergency event'; end if;
  v_before := v_n;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source) values (v_org, v_pat, 'spo2', 80, 'manual');
  execute 'reset role';
  select count(*) into v_n from public.emergency_events where patient_id = v_pat;
  if v_n <= v_before then raise exception 'FAIL 3b: a low SpO2 raised no emergency event'; end if;
  v_before := v_n;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source) values (v_org, v_pat, 'pulse', 180, 'manual');
  execute 'reset role';
  select count(*) into v_n from public.emergency_events where patient_id = v_pat;
  if v_n <= v_before then raise exception 'FAIL 3c: a dangerous pulse raised no emergency event'; end if;
  -- the manual timestamp is stamped by the trigger (a patient cannot backdate)
  if exists (select 1 from public.vitals_readings where patient_id = v_pat and source = 'manual' and taken_at < now() - interval '1 minute') then
    raise exception 'FAIL 3d: a manual reading kept a backdated timestamp';
  end if;

  -- SABOTAGE 1: the old staff policies would let an untied clinician read directly
  create policy s05fd2_sabotage_staff_select on public.vitals_readings for select to authenticated using (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.vitals_readings;
  execute 'reset role';
  if v_n = 0 then raise exception 'SABOTAGE 1 FAIL: the old staff policy did not let the untied clinician read, so check 1a proves nothing'; end if;
  drop policy s05fd2_sabotage_staff_select on public.vitals_readings;

  -- SABOTAGE 2: without the BP red-flag trigger a crisis BP raises nothing, so check 3a can fail
  alter table public.vitals_readings disable trigger vitals_readings_bp_red_flag;
  select count(*) into v_before from public.emergency_events where patient_id = v_pat and source = 'bp_reading';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_pat, 'blood_pressure', 215, 135, 'manual');
  execute 'reset role';
  alter table public.vitals_readings enable trigger vitals_readings_bp_red_flag;
  select count(*) into v_n from public.emergency_events where patient_id = v_pat and source = 'bp_reading';
  if v_n <> v_before then raise exception 'SABOTAGE 2 FAIL: disabling the BP red-flag trigger still raised an event, so check 3a proves nothing'; end if;
end $$;

rollback;
