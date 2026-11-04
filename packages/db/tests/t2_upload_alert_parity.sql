-- Proof: T2-04 / T2-07, one result engine for every source. A result filed from an uploaded lab report goes through the S27 lab
-- result machine exactly as a structured partner-portal result does (migrations *_t2_filed_upload_results_join_abnormal_result_engine
-- .sql and *_t2_uploads_through_s27_one_result_engine.sql). The brief's release criterion: "an abnormal result uploaded as a PDF or
-- photograph produces the same clinical alert as the equivalent structured result."
--
--   1. Signed range filled: each filed panel value gets the CMO-signed range and flag (range_source cmo_signed_config); a test not
--      on the panel, a panel test in a different unit and an unrecognised answer stay unspecified and unflagged (never "normal").
--   2. The filing becomes one S27 result, submitted by the Tarragon team with the document attached: HbA1c high, potassium critical
--      (filed as "mmol/l"), HIV positive are items; a "Weakly reactive" hepatitis C, a creatinine in umol/L and an off-panel test are
--      not; it is held for disclosure (sensitive positive); a critical call is open for it; the only screening rows at filing are the
--      uncheckable hepatitis C (restricted) and creatinine, each sent to a doctor on its own row.
--   3. Parity: the same values entered as a structured S27 result and as a filed upload are held for the same reason, carry the same
--      item flags and each open a critical call.
--   4. Release -> Category upgrade without a second page: when the clinician releases the upload's S27 result, one screening row per
--      abnormal screen type is written and linked (hba1c abnormal, kft critical), the screening upgrade and doctor-dashboard alert
--      follow, and the row is marked not to page (lab_result_id set). A normal screen type (liver) gets nothing.
--      A released correction of an already-mirrored result is not mirrored again.
--   5. Privacy: before release the patient reads no screening row for it; another patient reads none after.
--   6. A filing with only off-panel tests submits nothing; a writer's own lab range is never replaced.
--   7. SABOTAGE (automatic): with the filing trigger dropped, a filing creates no S27 result, so 2 to 4 prove the trigger.
--   Sabotage by hand: drop trigger lab_reading_fill_signed_range before the do block; step 1 must fail.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/t2_upload_alert_parity.sql

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_patient uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_third uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_staff uuid;
  v_doc uuid;
  v_ext uuid;
  v_lr uuid;
  v_lr_upload uuid;
  v_lr_portal uuid;
  v_n integer;
  v_rec record;
  v_a jsonb;
  v_b jsonb;
  v_out jsonb;
  v_rows jsonb := '[
    {"code":"hba1c","value":7.8,"unit":"%","reportedRange":"4.0-5.6","confidence":"high","status":"ready"},
    {"code":"potassium","value":6.8,"unit":"mmol/l","reportedRange":"3.5-5.1","confidence":"high","status":"ready"},
    {"code":"sodium","value":140,"unit":"mmol/L","confidence":"high","status":"ready"},
    {"code":"alt","value":30,"unit":"U/L","confidence":"high","status":"ready"},
    {"code":"hiv_screen","valueText":"Reactive","confidence":"high","status":"ready"},
    {"code":"hcv_ab","valueText":"Weakly reactive","confidence":"high","status":"ready"},
    {"code":"vitamin_d","value":20,"unit":"ng/mL","confidence":"high","status":"ready"},
    {"code":"creatinine","value":95,"unit":"umol/L","confidence":"high","status":"ready"}
  ]';
  v_file jsonb := '[
    {"code":"hba1c","value":7.8,"unit":"%"},
    {"code":"potassium","value":6.8,"unit":"mmol/l"},
    {"code":"sodium","value":140,"unit":"mmol/L"},
    {"code":"alt","value":30,"unit":"U/L"},
    {"code":"hiv_screen","value_text":"Reactive"},
    {"code":"hcv_ab","value_text":"Weakly reactive"},
    {"code":"vitamin_d","value":20,"unit":"ng/mL"},
    {"code":"creatinine","value":95,"unit":"umol/L"}
  ]';
  v_parity_file jsonb := '[{"code":"hba1c","value":7.8,"unit":"%"},{"code":"potassium","value":6.8,"unit":"mmol/L"},{"code":"alt","value":30,"unit":"U/L"}]';
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  -- Production's yearly-panel ranges were signed by the CMO through sign_lab_panels (v5, 2026-10-30); a fresh replay has the same
  -- sign-off row unsigned. Sign it here as a test CMO, inside this rolled-back transaction, the way s27_lab_results_release.sql does.
  if not private.lab_panels_signed() then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_cmo, 't2-parity-cmo@example.invalid', 'x', now(), '{}', '{}');
    update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'T2 Parity CMO', is_test = true where id = v_cmo;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
        license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'T2 Parity CMO', 'MDCN', 'T2PARITY-CMO', true, 'active', now(), v_verifier,
        'chief_medical_officer', 'contracted', 2, true, v_verifier, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.sign_lab_panels((select id from public.lab_panel_signoffs where is_active));
    reset role;
    perform set_config('request.jwt.claims', null, true);
  end if;
  if not private.lab_panels_signed() then
    raise exception 'SETUP: the yearly panel could not be signed in this database';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 't2-parity-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other, 't2-parity-other@example.invalid', 'x', now(), '{}', '{}'),
    (v_third, 't2-parity-third@example.invalid', 'x', now(), '{}', '{}'),
    (v_doctor, 't2-parity-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'T2 Parity Patient',
         sex = 'female', date_of_birth = date '1980-01-15', is_test = true where id in (v_patient, v_other, v_third);
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'T2 Parity Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'T2 Parity Doctor', 'MDCN', 'T2PARITY-001', true, 'active', now(), v_verifier,
      'senior_medical_officer', 'contracted', 2, true, v_verifier, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (v_org, v_staff, 'result_review', v_verifier, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  select v_org, p, v_doctor, now() from unnest(array[v_patient, v_other, v_third]) p
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- the patient uploads the report; the reader's draft is written directly (it is a server-side step); the doctor files it
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_patient, v_patient::text || '/t2-parity.pdf', 'report.pdf', 'application/pdf', 1000, 'patient')
  returning id into v_doc;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date, lab_name)
  values (v_org, v_patient, v_doc, 'extracted', v_rows, date '2026-10-20', 'Any Lab Ikeja')
  returning id into v_ext;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.confirm_lab_report_extraction(v_ext, v_file, date '2026-10-20') into v_n;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 8 then raise exception 'FAIL setup: the doctor filed % readings, expected 8', v_n; end if;

  -- 1. signed range filled, never guessed
  for v_rec in select code, abnormal_flag::text flag, range_source, range_source_ref, reference_range_high, reference_range_text
                 from public.lab_analyte_readings where patient_id = v_patient loop
    if v_rec.code = 'hba1c' and (v_rec.flag is distinct from 'high' or v_rec.range_source <> 'cmo_signed_config'
                                 or v_rec.range_source_ref not like 'lab_panel_versions:membership_annual:v%' or v_rec.reference_range_high is null) then
      raise exception 'FAIL 1: hba1c not flagged high against the signed range (%)', to_jsonb(v_rec);
    elsif v_rec.code = 'potassium' and v_rec.flag is distinct from 'critical_high' then
      raise exception 'FAIL 1: potassium 6.8 filed in "mmol/l" not flagged critical_high (unit case must not matter) (%)', to_jsonb(v_rec);
    elsif v_rec.code = 'sodium' and v_rec.flag is distinct from 'normal' then
      raise exception 'FAIL 1: sodium 140 not flagged normal (%)', to_jsonb(v_rec);
    elsif v_rec.code = 'hiv_screen' and (v_rec.flag is not null or v_rec.reference_range_text is distinct from 'Negative') then
      raise exception 'FAIL 1: HIV result should carry the signed range text and no numeric flag (%)', to_jsonb(v_rec);
    elsif v_rec.code in ('vitamin_d', 'creatinine', 'hcv_ab') and (v_rec.flag is not null or v_rec.range_source <> 'unspecified') then
      raise exception 'FAIL 1: % (off-panel, other unit or unrecognised answer) was classified instead of left unspecified (%)', v_rec.code, to_jsonb(v_rec);
    end if;
  end loop;

  -- 2. one S27 result for the filing
  select count(*) into v_n from public.lab_results where patient_id = v_patient;
  if v_n <> 1 then raise exception 'FAIL 2: the filing created % S27 results, expected 1', v_n; end if;
  select id into v_lr_upload from public.lab_results where patient_id = v_patient;
  select * into v_rec from public.lab_results where id = v_lr_upload;
  if v_rec.submitted_by_kind <> 'tarragon_team' or v_rec.source <> 'portal_entry' or v_rec.document_id is null then
    raise exception 'FAIL 2: the S27 result is not a Tarragon-team entry with the document attached (%)', to_jsonb(v_rec);
  end if;
  if v_rec.release_state <> 'clinician_disclosure_required' then
    raise exception 'FAIL 2: a reactive HIV result must hold the S27 result for disclosure, got %', v_rec.release_state;
  end if;
  select jsonb_object_agg(analyte_code, flag) into v_a from public.lab_result_items where lab_result_id = v_lr_upload;
  if v_a ->> 'hba1c' is distinct from 'high' or v_a ->> 'potassium' is distinct from 'critical' or v_a ->> 'hiv_screen' is distinct from 'positive'
     or v_a ? 'hcv_ab' or v_a ? 'creatinine' or v_a ? 'vitamin_d' then
    raise exception 'FAIL 2: the S27 items are wrong (%)', v_a;
  end if;
  if not exists (select 1 from public.lab_critical_calls where lab_result_id = v_lr_upload) then
    raise exception 'FAIL 2: the critical potassium opened no tracked critical call';
  end if;
  -- the only screening rows at filing are the uncheckable values: "Weakly reactive" hepatitis C (its own restricted screen type) and
  -- creatinine in umol/L (kidney); the classifiable values are all in S27
  if (select count(*) from public.screening_results where patient_id = v_patient) <> 2
     or not exists (select 1 from public.screening_results where patient_id = v_patient and screen_type_code = 'kft'
                    and result_summary like '%Creatinine could not be checked automatically%')
     or not exists (select 1 from public.screening_results where patient_id = v_patient and screen_type_code = 'hep_c'
                    and result_status = 'abnormal' and lab_result_id is null and result_summary like '%Hepatitis C antibody could not be checked automatically%') then
    raise exception 'FAIL 2: at filing only the two uncheckable values (hepatitis C, creatinine) should have screening rows: %',
      (select jsonb_agg(jsonb_build_object('type', screen_type_code, 'summary', result_summary)) from public.screening_results where patient_id = v_patient);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.screening_results where patient_id = v_patient and screen_type_code = 'hep_c';
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 2: the patient can read the uncheckable hepatitis C row before a clinician'; end if;

  -- 3. parity: the same values as a structured S27 entry and as a filed upload
  v_out := private.submit_lab_result(v_other, null, 'membership_annual',
    '[{"analyte_code":"hba1c","value_numeric":7.8,"unit":"%"},{"analyte_code":"potassium","value_numeric":6.8,"unit":"mmol/L"},{"analyte_code":"alt","value_numeric":30,"unit":"U/L"}]'::jsonb,
    null, 'partner', v_doctor, null);
  v_lr_portal := (v_out ->> 'lab_result_id')::uuid;

  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_third, v_third::text || '/t2-parity-3.pdf', 'r3.pdf', 'application/pdf', 1000, 'patient') returning id into v_doc;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  values (v_org, v_third, v_doc, 'extracted', '[]', date '2026-10-22') returning id into v_ext;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext, v_parity_file, date '2026-10-22');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select id into v_lr from public.lab_results where patient_id = v_third;

  select jsonb_build_object('state', release_state, 'reason', release_reason,
           'items', (select jsonb_object_agg(analyte_code, flag) from public.lab_result_items where lab_result_id = l.id),
           'call', exists (select 1 from public.lab_critical_calls c where c.lab_result_id = l.id))
    into v_a from public.lab_results l where id = v_lr_portal;
  select jsonb_build_object('state', release_state, 'reason', release_reason,
           'items', (select jsonb_object_agg(analyte_code, flag) from public.lab_result_items where lab_result_id = l.id),
           'call', exists (select 1 from public.lab_critical_calls c where c.lab_result_id = l.id))
    into v_b from public.lab_results l where id = v_lr;
  if v_b is null or v_a is distinct from v_b or (v_a ->> 'call')::boolean is not true then
    raise exception 'FAIL 3: a filed upload is not handled like the same structured result: structured % vs upload %', v_a, v_b;
  end if;

  -- 5a. before release the patient reads no screening row for it
  perform set_config('request.jwt.claims', json_build_object('sub', v_third, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.screening_results where patient_id = v_third;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 5: a held result is visible as a screening row before release'; end if;

  -- 4. release -> one linked screening row per abnormal screen type, upgrade and alert, not paged again
  select id into v_doc from public.lab_critical_calls where lab_result_id = v_lr;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.acknowledge_lab_critical_call(v_doc);
  v_out := public.release_lab_result(v_lr, 'reviewed, patient called');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_out ->> 'ok' is distinct from 'true' then raise exception 'FAIL 4 setup: the doctor could not release the result (%)', v_out; end if;

  select count(*) into v_n from public.screening_results where patient_id = v_third and lab_result_id = v_lr;
  if v_n <> 2 then
    raise exception 'FAIL 4: release wrote % linked screening rows, expected 2 (hba1c, kft): %', v_n,
      (select jsonb_agg(jsonb_build_object('type', screen_type_code, 'status', result_status)) from public.screening_results where patient_id = v_third);
  end if;
  if not exists (select 1 from public.screening_results s join public.screening_upgrades u on u.screening_result_id = s.id
                  join public.clinician_alerts a on a.screening_result_id = s.id
                  where s.lab_result_id = v_lr and s.screen_type_code = 'kft' and s.result_status = 'critical' and a.level = 'emergency') then
    raise exception 'FAIL 4: the released critical potassium did not raise the screening upgrade and the doctor-dashboard alert';
  end if;
  if not exists (select 1 from public.screening_results s join public.screening_upgrades u on u.screening_result_id = s.id
                  where s.lab_result_id = v_lr and s.screen_type_code = 'hba1c' and u.condition_triggered = 'diabetes') then
    raise exception 'FAIL 4: the released high HbA1c did not trigger the diabetes Category upgrade';
  end if;
  if exists (select 1 from public.screening_results where lab_result_id = v_lr and screen_type_code = 'lft') then
    raise exception 'FAIL 4: a normal ALT was mirrored';
  end if;

  -- 4b. a correction of an already-mirrored result does not raise the same finding again
  v_out := private.submit_lab_result(v_third, null, 'membership_annual',
    '[{"analyte_code":"hba1c","value_numeric":7.9,"unit":"%"},{"analyte_code":"potassium","value_numeric":6.8,"unit":"mmol/L"},{"analyte_code":"alt","value_numeric":30,"unit":"U/L"}]'::jsonb,
    null, 'partner', v_doctor, null, v_lr, 'amended', 'lab re-issued the report');
  update public.lab_results set release_state = 'released', reviewed_by = v_doctor, reviewed_at = now()
   where id = (v_out ->> 'lab_result_id')::uuid;
  select count(*) into v_n from public.screening_results where patient_id = v_third;
  if v_n <> 2 then raise exception 'FAIL 4b: releasing a correction mirrored the same findings again (% rows)', v_n; end if;

  -- 5b. another patient reads none of it
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.screening_results where patient_id = v_third;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 5: another patient can read this patient''s results'; end if;

  -- 6a. only off-panel tests: nothing for S27
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_other, v_other::text || '/t2-offpanel.pdf', 'o.pdf', 'application/pdf', 1000, 'patient') returning id into v_doc;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  values (v_org, v_other, v_doc, 'extracted', '[]', date '2026-09-01') returning id into v_ext;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext, '[{"code":"vitamin_d","value":40,"unit":"ng/mL"}]', date '2026-09-01');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from public.lab_results where patient_id = v_other;
  if v_n <> 1 then raise exception 'FAIL 6: an off-panel-only filing created an S27 result (% now for this patient)', v_n; end if;

  -- 6b. a writer's own lab range is kept
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, reference_range_low, reference_range_high, range_source)
  values (v_org, v_other, 'hba1c', 6.0, '%', now(), 4.0, 6.0, 'lab_report');
  if not exists (select 1 from public.lab_analyte_readings where patient_id = v_other and code = 'hba1c'
                 and range_source = 'lab_report' and reference_range_high = 6.0 and abnormal_flag is null) then
    raise exception 'FAIL 6: a lab-supplied range was replaced';
  end if;

  -- 7. SABOTAGE: without the filing trigger a filing creates no S27 result
  drop trigger lab_report_extraction_raise_abnormal on public.lab_report_extractions;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_other, v_other::text || '/t2-sabotage.pdf', 's.pdf', 'application/pdf', 1000, 'patient') returning id into v_doc;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  values (v_org, v_other, v_doc, 'extracted', '[]', date '2026-10-21') returning id into v_ext;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext, '[{"code":"potassium","value":6.8,"unit":"mmol/L"}]', date '2026-10-21');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from public.lab_results where patient_id = v_other;
  if v_n <> 1 then
    raise exception 'FAIL 7 (sabotage): an S27 result was created with the trigger removed, so steps 2 to 4 do not prove the trigger';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
