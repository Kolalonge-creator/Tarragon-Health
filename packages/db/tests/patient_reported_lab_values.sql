-- Tarragon Health: patient-reported lab values (migration 20261029192438).
--
-- A patient whose plan has no doctor time can confirm the numbers read from their own uploaded report and see them on their
-- own trend, labelled as theirs. This proves what that must and must not do, as the real roles, in a transaction that is
-- always rolled back:
--   1. the patient is offered the numbers read from their own uploaded report, and nobody else is offered them;
--   2. confirming (and correcting) puts them on the patient's trend as source 'patient_reported' with NO flag and NO range;
--   3. they are NEVER written to lab_analyte_readings, the clinical table that feeds doctor-facing metrics;
--   4. they are shown only to the patient: the same function asked for a caregiver or doctor (not the patient) omits them;
--   5. refused: someone else's report, a report a clinic or lab supplied, a sensitive analyte, a code not on the report,
--      a future date, an absurd value, a direct table write, and a report a doctor has already filed;
--   6. if a doctor files the same report, the doctor's value replaces the patient's: one point, not two;
--   7. a tied doctor can read the patient's reported rows, an untied clinician and another patient cannot.
--
-- Sabotage (by hand): delete the "p_include" test in private.biomarker_points_with_reported (make it always true). Step 4 must
-- then fail; if it still passes, the "only the patient sees them" check is vacuous.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/patient_reported_lab_values.sql

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_patient uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_doc uuid;
  v_doc_clinic uuid;
  v_ext uuid;
  v_ext_clinic uuid;
  v_n integer;
  v_json jsonb;
  v_ok boolean;
  v_msg text;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'prv-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other, 'prv-other@example.invalid', 'x', now(), '{}', '{}'),
    (v_doctor, 'prv-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'PRV Patient', is_test = true where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'PRV Other', is_test = true where id = v_other;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'PRV Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_doctor, v_org, 'PRV Doctor', 'senior_medical_officer', true, 'MDCN', 'PRV-001', true, v_verifier, v_verifier, now());
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_patient, v_doctor, now()) on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- the patient uploads a report (as themself); a second report is supplied by a clinic, not by the patient
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_patient, v_patient::text || '/report.pdf', 'report.pdf', 'application/pdf', 1000, 'patient')
  returning id into v_doc;
  reset role;
  -- The untied clinician is created only now, after the upload alert has been assigned. The alert names its responsible and backup
  -- doctor automatically (least-loaded), and a backup is deliberately given access; a clinician who did not exist yet cannot have been
  -- picked, so this one is untied on every run.
  perform set_config('request.jwt.claims', null, true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_stranger, 'prv-stranger@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'PRV Stranger', is_test = true where id = v_stranger;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_stranger, v_org, 'PRV Stranger', 'senior_medical_officer', true, 'MDCN', 'PRV-002', true, v_verifier, v_verifier, now());

  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source, uploaded_by)
  values (v_org, v_patient, 'clinic/report.pdf', 'clinic.pdf', 'application/pdf', 1000, 'clinician', v_doctor)
  returning id into v_doc_clinic;

  -- the server-side reader's drafts (written directly here)
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, report_date, rows)
  values (v_org, v_patient, v_doc, 'extracted', date '2026-10-01',
          '[{"code":"hba1c","value":6.8,"unit":"%","reportedLabel":"HbA1c"},
            {"code":"ldl","value":3.4,"unit":"mmol/L","reportedLabel":"LDL"},
            {"code":"hiv","value":null,"valueText":"non reactive"},
            {"code":"hep_b","value":1,"unit":"","reportedLabel":"HBsAg"}]'::jsonb)
  returning id into v_ext;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, report_date, rows)
  values (v_org, v_patient, v_doc_clinic, 'extracted', date '2026-09-01', '[{"code":"hba1c","value":9.9,"unit":"%"}]'::jsonb)
  returning id into v_ext_clinic;

  -- 1. offered to the patient (the sensitive and text-only rows are not offered), and to nobody else ----------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.my_lab_report_drafts();
  reset role;
  if jsonb_array_length(v_json) <> 1 then raise exception 'FAIL 1: expected 1 draft for the patient (their own upload only), got %', jsonb_array_length(v_json); end if;
  if jsonb_array_length(v_json -> 0 -> 'rows') <> 2 then
    raise exception 'FAIL 1: expected 2 offered numbers (hba1c, ldl; not hiv or hep_b), got %', v_json -> 0 -> 'rows';
  end if;
  if (v_json -> 0 ->> 'confirmed')::boolean then raise exception 'FAIL 1: draft reads as already confirmed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.my_lab_report_drafts();
  reset role;
  if jsonb_array_length(v_json) <> 0 then raise exception 'FAIL 1: another patient is offered this patient''s report'; end if;

  -- 5. refusals, as the patient ---------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- a report a clinic or lab supplied
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext_clinic, '[{"code":"hba1c","value":9.9,"unit":"%"}]'::jsonb, date '2026-09-01');
    v_ok := true;
  exception when others then null; end;
  if v_ok then raise exception 'FAIL 5: a patient confirmed a report that a clinic supplied'; end if;

  -- a sensitive analyte
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext, '[{"code":"hiv","value":1}]'::jsonb, date '2026-10-01');
    v_ok := true;
  exception when others then null; end;
  if v_ok then raise exception 'FAIL 5: a sensitive analyte was accepted for self-confirmation'; end if;

  -- a code that is not on the report
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext, '[{"code":"potassium","value":4.1}]'::jsonb, date '2026-10-01');
    v_ok := true;
  exception when others then null; end;
  if v_ok then raise exception 'FAIL 5: a number that is not on the report was accepted'; end if;

  -- a future date
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext, '[{"code":"hba1c","value":6.8}]'::jsonb, current_date + 30);
    v_ok := true;
  exception when others then null; end;
  if v_ok then raise exception 'FAIL 5: a future report date was accepted'; end if;

  -- an absurd value, and a non-numeric one
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext, '[{"code":"hba1c","value":99999999}]'::jsonb, date '2026-10-01');
    v_ok := true;
  exception when others then null; end;
  if v_ok then raise exception 'FAIL 5: an absurd value was accepted'; end if;
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext, '[{"code":"hba1c","value":"abc"}]'::jsonb, date '2026-10-01');
    v_ok := true;
  exception when others then null; end;
  if v_ok then raise exception 'FAIL 5: a non-numeric value was accepted'; end if;

  -- a direct table write (there is no write policy)
  v_ok := false;
  begin
    insert into public.patient_reported_lab_values (organisation_id, patient_id, document_id, extraction_id, code, value, taken_at)
    values (v_org, v_patient, v_doc, v_ext, 'hba1c', 5.0, now());
    v_ok := true;
  exception when others then null; end;
  if v_ok then raise exception 'FAIL 5: a patient wrote to patient_reported_lab_values directly'; end if;
  reset role;
  select count(*) into v_n from public.patient_reported_lab_values;
  if v_n <> 0 then raise exception 'FAIL 5: % rows exist after only refused attempts', v_n; end if;

  -- another patient cannot confirm this patient's report
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext, '[{"code":"hba1c","value":1}]'::jsonb, date '2026-10-01');
    v_ok := true;
  exception when others then null; end;
  reset role;
  if v_ok then raise exception 'FAIL 5: another patient confirmed this patient''s report'; end if;

  -- 2. the patient confirms, correcting HbA1c from 6.8 to 6.9 ------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := public.confirm_my_lab_report(v_ext, '[{"code":"hba1c","value":6.9,"unit":"%"},{"code":"ldl","value":3.4,"unit":"mmol/L"}]'::jsonb, date '2026-10-01');
  if v_n <> 2 then reset role; raise exception 'FAIL 2: confirmed % numbers, expected 2', v_n; end if;
  v_json := public.patient_biomarker_trend('hba1c');
  reset role;
  if jsonb_array_length(v_json -> 'points') <> 1 then raise exception 'FAIL 2: trend has % points, expected 1 (%)', jsonb_array_length(v_json -> 'points'), v_json; end if;
  if (v_json -> 'points' -> 0 ->> 'value')::numeric <> 6.9 then raise exception 'FAIL 2: the trend shows the draft value, not the one the patient confirmed'; end if;
  if v_json -> 'points' -> 0 ->> 'source' <> 'patient_reported' then raise exception 'FAIL 2: source is %, expected patient_reported', v_json -> 'points' -> 0 ->> 'source'; end if;
  if v_json -> 'points' -> 0 -> 'flag' <> 'null'::jsonb or v_json -> 'points' -> 0 -> 'ref_low' <> 'null'::jsonb or v_json -> 'points' -> 0 -> 'ref_high' <> 'null'::jsonb then
    raise exception 'FAIL 2: an unreviewed number carries a flag or a reference range (%)', v_json -> 'points' -> 0;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.patient_biomarker_list();
  reset role;
  if not exists (select 1 from jsonb_array_elements(v_json) x where x ->> 'code' = 'hba1c' and (x ->> 'readings')::int = 1) then
    raise exception 'FAIL 2: the biomarker list does not show hba1c with 1 reading (%)', v_json;
  end if;
  -- the page must not grade or draw a range bar for a number nobody reviewed, so the list says where the latest value came from
  if not exists (select 1 from jsonb_array_elements(v_json) x where x ->> 'code' = 'hba1c' and x ->> 'latest_source' = 'patient_reported') then
    raise exception 'FAIL 2: the biomarker list does not mark the latest hba1c as patient_reported (%)', v_json;
  end if;

  -- correcting again replaces, not duplicates
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := public.confirm_my_lab_report(v_ext, '[{"code":"hba1c","value":7.0,"unit":"%"}]'::jsonb, date '2026-10-01');
  v_json := public.patient_biomarker_trend('hba1c');
  reset role;
  if jsonb_array_length(v_json -> 'points') <> 1 or (v_json -> 'points' -> 0 ->> 'value')::numeric <> 7.0 then
    raise exception 'FAIL 2: a correction did not replace the earlier confirmation (%)', v_json -> 'points';
  end if;
  select count(*) into v_n from public.patient_reported_lab_values where extraction_id = v_ext;
  if v_n <> 1 then raise exception 'FAIL 2: % rows after a correction, expected 1', v_n; end if;

  -- 3. never in the clinical table --------------------------------------------------------------------------------------
  select count(*) into v_n from public.lab_analyte_readings where patient_id = v_patient;
  if v_n <> 0 then raise exception 'FAIL 3: patient-reported numbers leaked into lab_analyte_readings (% rows)', v_n; end if;
  select count(*) into v_n from private.biomarker_points(v_patient, 'hba1c');
  if v_n <> 0 then raise exception 'FAIL 3: the clinical private.biomarker_points now returns patient-reported values'; end if;

  -- 4. shown only to the patient: the same function for anyone else's view omits them -----------------------------------
  select count(*) into v_n from private.biomarker_points_with_reported(v_patient, 'hba1c', false);
  if v_n <> 0 then raise exception 'FAIL 4: patient-reported values are returned when the caller is not the patient'; end if;
  select count(*) into v_n from private.biomarker_points_with_reported(v_patient, 'hba1c', true);
  if v_n <> 1 then raise exception 'FAIL 4: the patient''s own view lost the value'; end if;

  -- 7. who can read the rows --------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.patient_reported_lab_values where patient_id = v_patient;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 7: the tied doctor sees % reported rows, expected 1', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.patient_reported_lab_values where patient_id = v_patient;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 7: a clinician with no tie to this patient reads their reported values'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.patient_reported_lab_values where patient_id = v_patient;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 7: another patient reads this patient''s reported values'; end if;

  -- 6. the doctor files the same report: the doctor's value replaces the patient's ---------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext, '[{"code":"hba1c","value":6.8,"unit":"%"}]'::jsonb, date '2026-10-01');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.patient_biomarker_trend('hba1c');
  reset role;
  if jsonb_array_length(v_json -> 'points') <> 1 then
    raise exception 'FAIL 6: % points after the doctor filed the same report, expected 1 (the patient copy should drop out): %', jsonb_array_length(v_json -> 'points'), v_json -> 'points';
  end if;
  if v_json -> 'points' -> 0 ->> 'source' = 'patient_reported' or (v_json -> 'points' -> 0 ->> 'value')::numeric <> 6.8 then
    raise exception 'FAIL 6: the doctor''s value did not replace the patient''s (%)', v_json -> 'points' -> 0;
  end if;

  -- and a filed report can no longer be confirmed by the patient
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ok := false;
  begin
    perform public.confirm_my_lab_report(v_ext, '[{"code":"hba1c","value":5.5}]'::jsonb, date '2026-10-01');
    v_ok := true;
  exception when others then null; end;
  reset role;
  if v_ok then raise exception 'FAIL 5: a patient re-confirmed a report a doctor has already filed'; end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
