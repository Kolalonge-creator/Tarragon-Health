-- Proof: T2-04, a result filed from an uploaded lab report raises the same abnormal-result alert as a result recorded by hand
-- (migration *_t2_filed_upload_results_join_abnormal_result_engine.sql). The brief's release criterion: "an abnormal result
-- uploaded as a PDF or photograph produces the same clinical alert as the equivalent structured result."
--
--   1. Signed range filled: each filed panel value gets the CMO-signed range and flag (range_source cmo_signed_config); a test not
--      on the panel, and a panel test in a different unit, stay unspecified and unflagged (never "normal").
--   2. One screening row per screen type with an abnormal value: HbA1c high -> hba1c, potassium critical (filed as "mmol/l") -> kft
--      (critical), HIV reactive -> hiv, hepatitis C "Weakly reactive" (cannot be classified) -> hep_c for a doctor; a normal ALT
--      and an off-panel test raise nothing; no internal identifier in the patient-readable summary; no health-education
--      recommendation from a sensitive result.
--   3. Parity: each row has a clinician alert, and the level and SLA match a hand-recorded screening result of the same status
--      (critical -> emergency on the signed 12-hour SLA; abnormal -> urgent on the signed 24-hour SLA).
--   4. The lab's printed range is quoted beside Tarragon's in the summary.
--   5. Privacy: the patient reads their HbA1c row but not the HIV row until a clinician discloses it; another patient reads none.
--   6. A filing with only normal values raises nothing; a writer's own lab range is never replaced.
--   7. SABOTAGE (automatic): with the filing trigger dropped, the same abnormal filing raises no screening row and no alert, so
--      step 2 and 3 are proving the new trigger and are not passing on their own.
--   Sabotage by hand: drop trigger lab_reading_fill_signed_range before the do block; step 1 must fail (checked 2026-11-04:
--   "FAIL 1: hba1c not flagged high against the signed range").
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/t2_upload_alert_parity.sql

begin;

do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_patient uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_doc uuid;
  v_ext uuid;
  v_hand uuid;
  v_n integer;
  v_rec record;
  v_hand_alert record;
  v_summary text;
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
    (v_doctor, 't2-parity-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'T2 Parity Patient',
         sex = 'female', date_of_birth = date '1980-01-15', is_test = true where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'T2 Parity Other',
         sex = 'male', date_of_birth = date '1980-01-15', is_test = true where id = v_other;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'T2 Parity Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_doctor, v_org, 'T2 Parity Doctor', 'senior_medical_officer', true, 'MDCN', 'T2PARITY-001', true, v_verifier, v_verifier, now());
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_patient, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- the patient uploads the report; the reader's draft is written directly (it is a server-side step)
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_patient, v_patient::text || '/t2-parity.pdf', 'report.pdf', 'application/pdf', 1000, 'patient')
  returning id into v_doc;
  reset role;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date, lab_name)
  values (v_org, v_patient, v_doc, 'extracted', v_rows, date '2026-10-20', 'Any Lab Ikeja')
  returning id into v_ext;

  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.confirm_lab_report_extraction(v_ext, v_file, date '2026-10-20') into v_n;
  reset role;
  if v_n <> 8 then raise exception 'FAIL setup: the doctor filed % readings, expected 8', v_n; end if;

  -- 1. signed range filled, never guessed
  for v_rec in select code, abnormal_flag::text flag, range_source, range_source_ref, reference_range_low, reference_range_high, reference_range_text
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
    elsif v_rec.code in ('vitamin_d', 'creatinine') and (v_rec.flag is not null or v_rec.range_source <> 'unspecified') then
      raise exception 'FAIL 1: % (off-panel or a different unit) was classified instead of left unspecified (%)', v_rec.code, to_jsonb(v_rec);
    end if;
  end loop;

  -- 2. one screening row per abnormal screen type, nothing for normal or off-panel
  select count(*) into v_n from public.screening_results where patient_id = v_patient;
  if v_n <> 4 then
    raise exception 'FAIL 2: % screening rows raised, expected 4 (hba1c, kft, hiv, hep_c): %', v_n,
      (select jsonb_agg(jsonb_build_object('type', screen_type_code, 'status', result_status)) from public.screening_results where patient_id = v_patient);
  end if;
  if not exists (select 1 from public.screening_results where patient_id = v_patient and screen_type_code = 'kft' and result_status = 'critical') then
    raise exception 'FAIL 2: the critical potassium did not raise a critical kidney-and-salts result';
  end if;
  if not exists (select 1 from public.screening_results where patient_id = v_patient and screen_type_code = 'hba1c' and result_status = 'abnormal'
                 and abnormal_flags @> array['hba1c']) then
    raise exception 'FAIL 2: the high HbA1c did not raise an abnormal hba1c result carrying the hba1c flag';
  end if;
  -- sensitivity comes from the screen type (screen_types.hiv is sensitive and 'restricted'), not from an extra word in the flags
  if not exists (select 1 from public.screening_results s join public.screen_types st on st.code = s.screen_type_code
                  where s.patient_id = v_patient and s.screen_type_code = 'hiv' and st.sensitive and s.abnormal_flags @> array['hiv_screen']) then
    raise exception 'FAIL 2: the reactive HIV result did not raise a sensitive hiv result';
  end if;
  if not exists (select 1 from public.screening_results where patient_id = v_patient and screen_type_code = 'hep_c' and result_status = 'abnormal'
                 and result_summary like '%could not be checked automatically%') then
    raise exception 'FAIL 2: a "Weakly reactive" hepatitis C result (not positive, not negative) did not go to a doctor';
  end if;
  if exists (select 1 from public.screening_results where patient_id = v_patient and result_summary like '%lab_panel_versions%') then
    raise exception 'FAIL 2: an internal identifier appears in a patient-readable result summary';
  end if;
  if exists (select 1 from public.health_education_recommendations where patient_id = v_patient
             and (trigger_reason ilike '%hiv%' or trigger_reason ilike '%hcv%' or trigger_reason ilike '%hep%')) then
    raise exception 'FAIL 2: a sensitive result produced a patient-visible health-education recommendation';
  end if;
  if exists (select 1 from public.screening_results where patient_id = v_patient and screen_type_code = 'lft') then
    raise exception 'FAIL 2: a normal ALT raised a liver result';
  end if;

  -- 3. parity with a hand-recorded result of the same status
  insert into public.screening_results (organisation_id, patient_id, result_status, result_summary, abnormal_flags, screen_type_code)
  values (v_org, v_other, 'critical', 'hand-recorded parity control', array['potassium'], 'kft')
  returning id into v_hand;
  select level::text, escalation_level, sla_due_at - created_at as sla into v_hand_alert from public.clinician_alerts where screening_result_id = v_hand;
  if v_hand_alert.level is null then raise exception 'FAIL 3: the hand-recorded control raised no alert, so parity cannot be checked'; end if;

  for v_rec in select s.screen_type_code, s.result_status::text status, a.level::text level, a.escalation_level, a.sla_due_at - a.created_at as sla
                 from public.screening_results s left join public.clinician_alerts a on a.screening_result_id = s.id
                where s.patient_id = v_patient loop
    if v_rec.level is null then raise exception 'FAIL 3: the filed % result raised no clinician alert', v_rec.screen_type_code; end if;
    if v_rec.status = 'critical' and (v_rec.level <> v_hand_alert.level or v_rec.escalation_level <> v_hand_alert.escalation_level
                                      or abs(extract(epoch from v_rec.sla - v_hand_alert.sla)) > 60) then
      raise exception 'FAIL 3: filed critical alert (%, %, %) differs from the hand-recorded one (%, %, %)',
        v_rec.level, v_rec.escalation_level, v_rec.sla, v_hand_alert.level, v_hand_alert.escalation_level, v_hand_alert.sla;
    end if;
    if v_rec.status = 'critical' and abs(extract(epoch from v_rec.sla) / 60 - private.escalation_sla_minutes('screening_abnormal_result', 'emergency')) > 1 then
      raise exception 'FAIL 3: the critical alert is not on the signed emergency SLA (%)', v_rec.sla;
    end if;
    if v_rec.status = 'abnormal' and (v_rec.level <> 'urgent_escalation'
        or abs(extract(epoch from v_rec.sla) / 60 - private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation')) > 1) then
      raise exception 'FAIL 3: the abnormal % alert is not urgent on the signed SLA (%, %)', v_rec.screen_type_code, v_rec.level, v_rec.sla;
    end if;
  end loop;

  -- 4. the lab's printed range sits beside Tarragon's
  select result_summary into v_summary from public.screening_results where patient_id = v_patient and screen_type_code = 'hba1c';
  if v_summary not like '%range on the report: 4.0-5.6%' or v_summary not like '%HbA1c 7.8 % high (our range%' then
    raise exception 'FAIL 4: the summary does not quote both ranges: %', v_summary;
  end if;

  -- 5. privacy
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.screening_results where patient_id = v_patient and screen_type_code = 'hba1c';
  if v_n <> 1 then reset role; raise exception 'FAIL 5: the patient cannot read their own HbA1c result'; end if;
  select count(*) into v_n from public.screening_results where patient_id = v_patient and screen_type_code in ('hiv', 'hep_c');
  if v_n <> 0 then reset role; raise exception 'FAIL 5: the patient can read an HIV or hepatitis result before a clinician has disclosed it'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.screening_results where patient_id = v_patient;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 5: another patient can read this patient''s results'; end if;

  -- 6a. a normal-only filing raises nothing
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_patient, v_patient::text || '/t2-normal.pdf', 'normal.pdf', 'application/pdf', 1000, 'patient') returning id into v_doc;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  values (v_org, v_patient, v_doc, 'extracted', '[{"code":"alt","value":25,"unit":"U/L","status":"ready"}]', date '2026-09-01') returning id into v_ext;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext, '[{"code":"alt","value":25,"unit":"U/L"}]', date '2026-09-01');
  reset role;
  select count(*) into v_n from public.screening_results where patient_id = v_patient;
  if v_n <> 4 then raise exception 'FAIL 6: a normal-only filing raised a screening result (% rows now)', v_n; end if;

  -- 6b. a writer's own lab range is kept
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, reference_range_low, reference_range_high, range_source)
  values (v_org, v_other, 'hba1c', 6.0, '%', now(), 4.0, 6.0, 'lab_report');
  if not exists (select 1 from public.lab_analyte_readings where patient_id = v_other and code = 'hba1c'
                 and range_source = 'lab_report' and reference_range_high = 6.0 and abnormal_flag is null) then
    raise exception 'FAIL 6: a lab-supplied range was replaced';
  end if;

  -- 7. SABOTAGE: without the filing trigger the same abnormal filing raises nothing, so 2 and 3 prove the trigger
  drop trigger lab_report_extraction_raise_abnormal on public.lab_report_extractions;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_other, v_other::text || '/t2-sabotage.pdf', 's.pdf', 'application/pdf', 1000, 'patient') returning id into v_doc;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  values (v_org, v_other, v_doc, 'extracted', '[{"code":"potassium","value":6.8,"unit":"mmol/L","status":"ready"}]', date '2026-10-21') returning id into v_ext;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_other, v_doctor, now()) on conflict (patient_id) do update set clinician_id = excluded.clinician_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext, '[{"code":"potassium","value":6.8,"unit":"mmol/L"}]', date '2026-10-21');
  reset role;
  select count(*) into v_n from public.screening_results where patient_id = v_other and id <> v_hand;
  if v_n <> 0 then
    raise exception 'FAIL 7 (sabotage): a screening result was raised with the trigger removed, so steps 2 and 3 do not prove the trigger';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
