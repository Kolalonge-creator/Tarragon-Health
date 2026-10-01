-- ===========================================================================
-- Proof: *_s05f_* migrations (S05f piece B; INV-10, INV-12): medication_logs and symptoms.
--
-- Proves, with simulated sessions: the patient reads and writes her own rows; a caregiver with the 'medications' category grant still reads
-- the dose log but not symptoms; a tied clinician, an untied clinician, an admin, a pharmacist and another organisation's clinician read
-- NOTHING directly from either table and cannot insert, update or delete; the audited dose-log read opens for the tied clinician (with
-- the drug name, one audit row with basis tied) and is denied for everyone else; the symptoms chart section opens for the tied clinician
-- and is denied for the untied one; a patient caller raises, a short reason raises, anon cannot execute; an acting supporter can still
-- log a dose; the red-flag trigger still marks a severe symptom. SABOTAGE 1: restoring the old org-staff read policy lets an untied
-- clinician read. SABOTAGE 2: a function that skips the tie check lets an untied clinician read the dose log.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cg uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_med uuid;
  v_pa uuid;
  v_json jsonb;
  v_n integer;
  v_audits integer;
  v_failed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05f Other Org', 'direct_consumer');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's05f-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_pat2,   's05f-pat2@example.invalid',   'x', now(), '{}', '{}'),
    (v_tied,   's05f-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 's05f-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,  's05f-admin@example.invalid',  'x', now(), '{}', '{}'),
    (v_pharm,  's05f-pharm@example.invalid',  'x', now(), '{}', '{}'),
    (v_other,  's05f-other@example.invalid',  'x', now(), '{}', '{}'),
    (v_cg,     's05f-cg@example.invalid',     'x', now(), '{}', '{}'),
    (v_sup,    's05f-sup@example.invalid',    'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',    'S05f Patient One',  '+2348056660001'),
    (v_pat2,   v_org,  'patient',    'S05f Patient Two',  '+2348056660002'),
    (v_tied,   v_org,  'clinician',  'S05f Tied Doctor',  '+2348056660003'),
    (v_untied, v_org,  'clinician',  'S05f Untied Doctor','+2348056660004'),
    (v_admin,  v_org,  'admin',      'S05f Admin',        '+2348056660005'),
    (v_pharm,  v_org,  'pharmacist', 'S05f Pharmacist',   '+2348056660006'),
    (v_other,  v_org2, 'clinician',  'S05f Other Org Dr', '+2348056660007'),
    (v_cg,     v_org,  'patient',    'S05f Caregiver',    '+2348056660008'),
    (v_sup,    v_org,  'patient',    'S05f Supporter',    '+2348056660009')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org,  v_tied,   'S05f Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org,  v_untied, 'S05f Untied Doctor', true, now(), 'medical_officer'),
    (v_org2, v_other,  'S05f Other Org Dr',  true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  -- caregiver: view-level grant with the 'medications' category only; supporter: manage level (can act for her)
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_cg, v_pat) returning id into v_pa;
  -- only the record's owner may set a category grant (private.enforce_category_access_owner), so do it as the patient
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');
  perform set_config('request.jwt.claims', null, true);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level) values (v_pat, v_sup, v_pat, 'manage');

  insert into public.medications (organisation_id, patient_id, drug_name) values (v_org, v_pat, 'S05f Amlodipine') returning id into v_med;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (v_org, v_pat, v_med, 'taken');
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_pat, 'fatigue', 3);

  -- 1. the patient reads her own rows; another patient reads none; the caregiver reads the dose log but not symptoms
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.medication_logs;
  if v_n <> 1 then raise exception 'FAIL 1a: the patient reads % dose logs, expected 1', v_n; end if;
  select count(*) into v_n from public.symptoms;
  if v_n <> 1 then raise exception 'FAIL 1b: the patient reads % symptoms, expected 1', v_n; end if;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.medication_logs) + (select count(*) from public.symptoms) into v_n;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 1c: another patient read % rows', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.medication_logs;
  if v_n <> 1 then raise exception 'FAIL 1d: the caregiver with the medications grant reads % dose logs, expected 1 (the gate must open)', v_n; end if;
  select count(*) into v_n from public.symptoms;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 1e: the caregiver read % symptoms', v_n; end if;

  -- 2. the tied clinician reads nothing directly, but the audited paths open
  select count(*) into v_audits from public.audit_log where actor_id = v_tied and action = 'staff.chart_read';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.medication_logs) + (select count(*) from public.symptoms) into v_n;
  if v_n <> 0 then raise exception 'FAIL 2a: a tied clinician read % rows directly', v_n; end if;
  select public.read_medication_dose_log_audited(v_pat, 'S05f proof: tied clinician review') into v_json;
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 1
     or v_json -> 'rows' -> 0 -> 'medication' ->> 'drug_name' <> 'S05f Amlodipine' then
    raise exception 'FAIL 2b: the tied clinician lost the audited dose log (or the drug name): %', v_json;
  end if;
  select public.read_patient_chart_audited(v_pat, array['symptoms'], 'S05f proof: tied clinician review') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'sections' -> 'symptoms') <> 1 then
    raise exception 'FAIL 2c: the tied clinician lost the symptoms chart section: %', v_json;
  end if;
  select count(*) into v_n from public.audit_log
   where actor_id = v_tied and action = 'staff.chart_read' and event ->> 'basis' = 'tied' and result = 'success';
  if v_n - v_audits < 2 then raise exception 'FAIL 2d: expected 2 audited tied reads, saw %', v_n - v_audits; end if;

  -- 3. untied clinician, admin, pharmacist and another organisation's clinician: nothing directly, denied on the audited path
  declare
    v_who uuid;
  begin
    foreach v_who in array array[v_untied, v_admin, v_pharm, v_other] loop
      perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select (select count(*) from public.medication_logs) + (select count(*) from public.symptoms) into v_n;
      if v_n <> 0 then raise exception 'FAIL 3a: % read % rows directly', v_who, v_n; end if;
      select public.read_medication_dose_log_audited(v_pat, 'S05f proof: untied attempt') into v_json;
      if v_json ->> 'status' <> 'denied' or jsonb_array_length(v_json -> 'rows') <> 0 then
        raise exception 'FAIL 3b: % was not denied the dose log: %', v_who, v_json;
      end if;
      select public.read_patient_chart_audited(v_pat, array['symptoms'], 'S05f proof: untied attempt') into v_json;
      execute 'reset role';
      if v_json ->> 'status' <> 'denied' then raise exception 'FAIL 3c: % was not denied the symptoms section: %', v_who, v_json; end if;
    end loop;
  end;

  -- 4. staff cannot write: insert, update, delete (the tied clinician too)
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (v_org, v_pat, v_med, 'missed');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4a: a clinician inserted a dose log for a patient'; end if;
  v_failed := false;
  begin
    insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_pat, 'pain', 4);
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4b: a clinician inserted a symptom for a patient'; end if;
  perform set_config('app.change_reason', 'S05f proof: staff update attempt', true);
  update public.symptoms set severity = 9 where patient_id = v_pat;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL 4c: a clinician updated % symptom rows', v_n; end if;
  delete from public.symptoms where patient_id = v_pat;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL 4d: a clinician deleted % symptom rows', v_n; end if;
  delete from public.medication_logs where patient_id = v_pat;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4e: a clinician deleted % dose logs', v_n; end if;

  -- 5. a patient caller raises, a short reason raises, anon cannot execute
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.read_medication_dose_log_audited(v_pat, 'S05f proof: patient caller');
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 5a: a patient caller was not refused'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.read_medication_dose_log_audited(v_pat, 'short');
  exception when invalid_parameter_value then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 5b: a short reason was accepted'; end if;
  if has_function_privilege('anon', 'public.read_medication_dose_log_audited(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL 5c: anon can execute the dose log read';
  end if;

  -- 6. the patient and an acting supporter still write; the red-flag trigger still marks a severe symptom; the patient updates her own
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (v_org, v_pat, v_med, 'skipped');
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (v_org, v_pat, 'chest_pain', 9);
  perform set_config('app.change_reason', 'S05f proof: patient edit', true);
  update public.symptoms set description = 'S05f edit' where patient_id = v_pat and symptom_type = 'fatigue';
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 6a: the patient could not update her own symptom (% rows)', v_n; end if;
  if not exists (select 1 from public.symptoms where patient_id = v_pat and symptom_type = 'chest_pain' and is_red_flag) then
    raise exception 'FAIL 6b: the red-flag trigger no longer marks a severe symptom';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (v_org, v_pat, v_med, 'taken');
  execute 'reset role';
  if not exists (select 1 from public.medication_logs where patient_id = v_pat and logged_by_profile_id = v_sup) then
    raise exception 'FAIL 6c: the acting supporter dose entry was not stamped with her profile';
  end if;

  -- SABOTAGE 1: the old org-staff read policy would let the untied clinician read directly
  create policy s05f_sabotage_old_staff_read on public.medication_logs for select to authenticated using (private.is_org_staff(organisation_id));
  create policy s05f_sabotage_old_staff_read on public.symptoms for select to authenticated using (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.medication_logs) + (select count(*) from public.symptoms) into v_n;
  execute 'reset role';
  if v_n = 0 then raise exception 'SABOTAGE 1 FAIL: restoring the staff read policy did not let the untied clinician read, so checks 2a/3a prove nothing'; end if;
  drop policy s05f_sabotage_old_staff_read on public.medication_logs;
  drop policy s05f_sabotage_old_staff_read on public.symptoms;

  -- SABOTAGE 2: the real function with its tie check removed would give the untied clinician the dose log, so check 3b can fail
  create or replace function public.read_medication_dose_log_audited(p_patient uuid, p_reason text) returns jsonb
    language sql security definer set search_path = ''
    as $f$ select jsonb_build_object('status', 'ok', 'rows', coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb))
             from public.medication_logs l where l.patient_id = p_patient $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_medication_dose_log_audited(v_pat, 'S05f proof: sabotage') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') = 0 then
    raise exception 'SABOTAGE 2 FAIL: removing the tie check did not let the untied clinician read, so check 3b proves nothing';
  end if;
end $$;

rollback;
