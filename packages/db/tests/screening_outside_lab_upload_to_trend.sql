-- Tarragon Health: the outside-lab path, end to end.
--
-- Founder ask 2026-10-29: a patient takes the printed request to a lab of their choice, uploads the result, it lands in
-- their results, the doctor and the patient can both see it, and it trends. Everything on this path already existed, but
-- no real patient had ever gone through it (0 screening schedules, 0 lab orders, 0 filed results in production on that
-- date), so nothing proved the pieces join up. This does, as the real roles, in a transaction that is always rolled back.
--
-- Path proven, in order:
--   1. the nightly scheduler creates the screening schedule for a patient (private.run_screening_scheduler);
--   2. request automation issues a self-arranged, zero-cost lab order for it (private.run_screening_request_automation);
--   3. before an upload the schedule still counts as awaiting a result, so reminders keep chasing
--      (private.screening_result_uploaded is false);
--   4. the PATIENT uploads the outside lab's result against that request: a clinician review alert is raised and the
--      reminders stop (screening_result_uploaded is true);
--   5. the patient and the tied doctor can both read the document; another patient cannot;
--   6. a doctor files the values read from the report (confirm_lab_report_extraction), and a PATIENT cannot;
--   7. the patient gets the value from patient_biomarker_trend, a second, earlier report makes it a two-point trend in
--      date order, the doctor sees the same filed values, and another patient is refused.
--
-- Sabotage (run by hand, see the end of the file): taking the doctor's care-team tie away makes step 5 fail, so the
-- "doctor can see it" assertions are real and not vacuous.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/screening_outside_lab_upload_to_trend.sql

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_patient uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_schedule uuid;
  v_order uuid;
  v_doc1 uuid;
  v_doc2 uuid;
  v_ext1 uuid;
  v_ext2 uuid;
  v_alert uuid;
  v_n integer;
  v_trend jsonb;
  v_ok boolean;
  v_vals numeric[];
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'outside-lab-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other, 'outside-lab-other@example.invalid', 'x', now(), '{}', '{}'),
    (v_doctor, 'outside-lab-doctor@example.invalid', 'x', now(), '{}', '{}');

  -- is_test lets the scheduler and the request job run for this patient before their go-live guards are on.
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Outside Lab Patient',
         sex = 'female', date_of_birth = date '1980-01-15', is_test = true where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Outside Lab Other',
         sex = 'male', date_of_birth = date '1980-01-15', is_test = true where id = v_other;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Outside Lab Doctor', is_test = true where id = v_doctor;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_doctor, v_org, 'Outside Lab Doctor', 'senior_medical_officer', true, 'MDCN', 'OUTSIDELAB-001', true, v_verifier, v_verifier, now());

  -- Staff access is tied to the patient (private.clinician_has_patient_access); without this the doctor reads nothing.
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_patient, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- 1. the scheduler creates the HbA1c item (every adult from 18, rule set v3)
  perform private.run_screening_scheduler(v_patient);
  select s.id into v_schedule from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
   where s.patient_id = v_patient and st.code = 'hba1c';
  if v_schedule is null then raise exception 'FAIL 1: the scheduler did not create an HbA1c schedule for an adult patient'; end if;

  -- make it due now so the request job picks it up
  update public.screening_schedules set due_date = current_date where id = v_schedule;

  -- 2. request automation issues a self-arranged, zero-cost order for it
  perform private.run_screening_request_automation(v_patient);
  select o.id into v_order from public.lab_orders o where o.screening_schedule_id = v_schedule;
  if v_order is null then raise exception 'FAIL 2: no printable test request was issued for the due HbA1c'; end if;
  if not exists (select 1 from public.lab_orders where id = v_order and fulfilment = 'self_arranged' and total_kobo = 0) then
    raise exception 'FAIL 2: the request is not self-arranged and free to Tarragon';
  end if;

  -- 3. nothing uploaded yet: the schedule still awaits a result, so reminders keep chasing
  if private.screening_result_uploaded(v_schedule) then
    raise exception 'FAIL 3: the schedule counts as having a result before anything was uploaded';
  end if;

  -- 4. the patient uploads the outside lab's result against the request
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_patient, v_order, v_patient::text || '/outside-lab-hba1c.pdf', 'hba1c-report.pdf', 'application/pdf', 1000, 'patient')
  returning id into v_doc1;
  reset role;

  select clinician_alert_id into v_alert from public.lab_result_documents where id = v_doc1;
  if v_alert is null then raise exception 'FAIL 4: an uploaded outside-lab result raised no clinician review alert'; end if;
  if not private.screening_result_uploaded(v_schedule) then
    raise exception 'FAIL 4: the schedule still counts as awaiting a result after the patient uploaded it, so reminders would keep nagging';
  end if;

  -- 5. the patient and the tied doctor can read it; another patient cannot
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_result_documents where id = v_doc1;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 5: the patient cannot see their own uploaded result'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_result_documents where id = v_doc1;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 5: the care-team doctor cannot see the patient''s uploaded result'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_result_documents where id = v_doc1;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 5: another patient can see this patient''s uploaded result'; end if;

  -- The untied clinician is created only now, after the upload alert has been assigned. The alert names its responsible and backup
  -- doctor automatically (least-loaded), and a backup is deliberately given access; a clinician who did not exist yet cannot have been
  -- picked, so this one is untied on every run.
  perform set_config('request.jwt.claims', null, true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_stranger, 'outside-lab-stranger@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Outside Lab Stranger', is_test = true where id = v_stranger;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_stranger, v_org, 'Outside Lab Stranger', 'senior_medical_officer', true, 'MDCN', 'OUTSIDELAB-002', true, v_verifier, v_verifier, now());

  -- A clinician with no care-team tie and no alert of their own for this patient must not read it. This is the check that
  -- makes the doctor assertions above mean something: uploading raises an alert for the responsible doctor, which is itself
  -- a way in, so removing the tie alone would not change the doctor's access.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_result_documents where id = v_doc1;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 5: a clinician with no tie to this patient can read the uploaded result'; end if;

  -- 6. the report is read (the draft is written by the server-side reader; the test writes it directly), then a doctor files it
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  values (v_org, v_patient, v_doc1, 'extracted',
          '[{"code":"hba1c","value":6.8,"unit":"%","confidence":"high"}]'::jsonb, date '2026-10-01')
  returning id into v_ext1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ok := false;
  begin
    perform public.confirm_lab_report_extraction(v_ext1, '[{"code":"hba1c","value":6.8,"unit":"%"}]'::jsonb, date '2026-10-01');
    v_ok := true;
  exception when others then null;
  end;
  reset role;
  if v_ok then raise exception 'FAIL 6: a patient was able to file their own extracted result as clinically confirmed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.confirm_lab_report_extraction(v_ext1, '[{"code":"hba1c","value":6.8,"unit":"%"}]'::jsonb, date '2026-10-01') into v_n;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 6: the doctor filed % readings, expected 1', v_n; end if;

  -- 7. an earlier report from the same patient makes it a trend
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_patient, v_patient::text || '/earlier-hba1c.pdf', 'earlier.pdf', 'application/pdf', 1000, 'patient')
  returning id into v_doc2;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  values (v_org, v_patient, v_doc2, 'extracted', '[{"code":"hba1c","value":7.4,"unit":"%"}]'::jsonb, date '2026-04-01')
  returning id into v_ext2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext2, '[{"code":"hba1c","value":7.4,"unit":"%"}]'::jsonb, date '2026-04-01');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_trend := public.patient_biomarker_trend('hba1c', v_patient);
  reset role;
  if jsonb_array_length(v_trend -> 'points') <> 2 then
    raise exception 'FAIL 7: the patient''s trend has % points, expected 2 (%)', jsonb_array_length(v_trend -> 'points'), v_trend;
  end if;
  if (v_trend -> 'points' -> 0 ->> 'value')::numeric <> 7.4 or (v_trend -> 'points' -> 1 ->> 'value')::numeric <> 6.8 then
    raise exception 'FAIL 7: the trend is not in date order or carries the wrong values (%)', v_trend -> 'points';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- patient_biomarker_trend serves the patient and their family circle (profile_access); the care team reads the filed values
  -- from lab_analyte_readings through the tie-gated staff policy, which is what the clinician screens query.
  select array_agg(value order by taken_at) into v_vals from public.lab_analyte_readings where patient_id = v_patient and code = 'hba1c';
  reset role;
  if v_vals is distinct from array[7.4, 6.8]::numeric[] then
    raise exception 'FAIL 7: the care-team doctor sees % instead of [7.4, 6.8] in date order', v_vals;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_analyte_readings where patient_id = v_patient;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 7: a clinician with no tie to this patient can read their filed lab values'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_ok := false;
  begin
    perform public.patient_biomarker_trend('hba1c', v_patient);
    v_ok := true;
  exception when others then null;
  end;
  reset role;
  if v_ok then raise exception 'FAIL 7: another patient can read this patient''s trend'; end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;

-- Sabotage, by hand: run `update public.platform_modules set is_enabled = false where key = 'tied_staff_reads';` just before the
-- do block. The stranger clinician then reads the result and step 5 must fail; if it still passes the access checks are vacuous.
