-- ===========================================================================
-- Proof: *_s05f_review_tie_gate_three_definer_functions.sql (S05f review follow-up; INV-10, INV-12).
--
-- consultation_prep_bundle, search_patient_record and clear_vitals_validation_flag used to admit ANY org staff member. Proves, with
-- simulated sessions: a tied clinician gets the bundle (with an audit row, basis tied), searches the record (audited) and clears a
-- validation flag; an untied clinician, an admin, a pharmacist and another organisation's clinician are refused each (same answer as an
-- unknown id for the flag); the patient still searches her own record; a caregiver with the medical-history grant still searches; anon
-- cannot execute. SABOTAGE: the old org-staff-only gate lets an untied clinician in.
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
  v_cg uuid := gen_random_uuid();
  v_pa uuid;
  v_vc uuid;
  v_reading uuid;
  v_who uuid;
  v_json jsonb;
  v_n integer;
  v_audits integer;
  v_failed boolean;
  v_msg text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05f R Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's05fr-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_tied, v_untied, v_admin, v_pharm, v_other, v_cg]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',    'S05fR Patient',      '+2348058880401'),
    (v_tied,   v_org,  'clinician',  'S05fR Tied Doctor',  '+2348058880402'),
    (v_untied, v_org,  'clinician',  'S05fR Untied Doctor','+2348058880403'),
    (v_admin,  v_org,  'admin',      'S05fR Admin',        '+2348058880404'),
    (v_pharm,  v_org,  'pharmacist', 'S05fR Pharmacist',   '+2348058880405'),
    (v_other,  v_org2, 'clinician',  'S05fR Other Org Dr', '+2348058880406'),
    (v_cg,     v_org,  'patient',    'S05fR Caregiver',    '+2348058880407')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org,  v_tied,   'S05fR Tied Doctor',   true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FR-1', now() + interval '1 year'),
    (v_org,  v_untied, 'S05fR Untied Doctor', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FR-2', now() + interval '1 year'),
    (v_org2, v_other,  'S05fR Other Org Dr',  true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FR-3', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_cg, v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medical_history');
  perform set_config('request.jwt.claims', null, true);

  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source) values (v_org, v_pat, 'S05fR penicillin', 'hives', 'severe', 'patient');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values (v_org, v_pat, 'blood_pressure', 130, 85, now() - interval '1 day', 'manual') returning id into v_reading;
  update public.vitals_readings set validation_status = 'requires_validation' where id = v_reading;
  insert into public.video_consultations (organisation_id, patient_id, context) values (v_org, v_pat, 'general_checkin') returning id into v_vc;

  -- 1. the tied clinician: bundle (audited), search (audited), clears the flag
  select count(*) into v_audits from public.audit_log where actor_id = v_tied and action = 'staff.chart_read' and event ->> 'basis' = 'tied' and result = 'success';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_json := public.consultation_prep_bundle(v_vc);
  select count(*) into v_n from public.search_patient_record(v_pat, 'penicillin');
  perform public.clear_vitals_validation_flag(v_reading);
  execute 'reset role';
  if jsonb_array_length(v_json -> 'allergies') <> 1 then raise exception 'FAIL 1a: the tied clinician lost the prep bundle: %', v_json; end if;
  if v_n <> 1 then raise exception 'FAIL 1b: the tied clinician lost the record search (% hits)', v_n; end if;
  if (select validation_status::text from public.vitals_readings where id = v_reading) <> 'valid' then raise exception 'FAIL 1c: the flag was not cleared'; end if;
  select count(*) into v_n from public.audit_log where actor_id = v_tied and action = 'staff.chart_read' and event ->> 'basis' = 'tied' and result = 'success';
  if v_n - v_audits < 2 then raise exception 'FAIL 1d: expected 2 audited tied reads (bundle and search), saw %', v_n - v_audits; end if;

  -- 2. everyone else is refused on each function
  update public.vitals_readings set validation_status = 'requires_validation' where id = v_reading;
  foreach v_who in array array[v_untied, v_admin, v_pharm, v_other] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin perform public.consultation_prep_bundle(v_vc); exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL 2a: % read the prep bundle', v_who; end if;
    v_failed := false;
    begin perform * from public.search_patient_record(v_pat, 'penicillin'); exception when others then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL 2b: % searched the record', v_who; end if;
    v_failed := false;
    begin perform public.clear_vitals_validation_flag(v_reading); exception when insufficient_privilege then v_failed := true; v_msg := sqlerrm; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 2c: % cleared a validation flag', v_who; end if;
  end loop;
  if (select validation_status::text from public.vitals_readings where id = v_reading) <> 'requires_validation' then raise exception 'FAIL 2d: a refused caller changed the reading'; end if;
  -- an unknown reading id answers exactly like an untied caller
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.clear_vitals_validation_flag(gen_random_uuid());
  exception when insufficient_privilege then
    if sqlerrm <> v_msg then execute 'reset role'; raise exception 'FAIL 2e: an unknown id answers differently (% vs %)', sqlerrm, v_msg; end if;
  end;
  execute 'reset role';

  -- 3. the patient and a medical-history caregiver still search; anon cannot execute any of the three
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.search_patient_record(v_pat, 'penicillin');
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 3a: the patient lost her own record search'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.search_patient_record(v_pat, 'penicillin');
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 3b: the caregiver lost the record search'; end if;
  if has_function_privilege('anon', 'public.consultation_prep_bundle(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.search_patient_record(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clear_vitals_validation_flag(uuid)', 'EXECUTE') then
    raise exception 'FAIL 3c: anon can execute one of the three';
  end if;

  -- SABOTAGE: the old org-staff-only gate on the flag function would let an untied clinician in
  create or replace function public.clear_vitals_validation_flag(p_reading_id uuid) returns void language plpgsql security definer set search_path = ''
    as $f$ declare v_org uuid; begin select organisation_id into v_org from public.vitals_readings where id = p_reading_id;
      if v_org is null or not private.is_org_staff(v_org) then raise exception 'Not authorised' using errcode = 'insufficient_privilege'; end if;
      update public.vitals_readings set validation_status = 'valid' where id = p_reading_id; end $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.clear_vitals_validation_flag(v_reading);
  execute 'reset role';
  if (select validation_status::text from public.vitals_readings where id = v_reading) <> 'valid' then
    raise exception 'SABOTAGE FAIL: the org-staff-only gate did not let the untied clinician clear the flag, so check 2c proves nothing';
  end if;
end $$;

rollback;
