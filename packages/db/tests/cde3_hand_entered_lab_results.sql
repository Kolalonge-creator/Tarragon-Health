-- Proof: clinical document engine, step 3 (migration *_cde4_hand_entered_lab_results.sql). A Care Coordinator types in lab results
-- by hand (CDE-02). Design: docs/plans/clinical-document-engine-2026-11-04.md §5.2.
--
--   1. A hand entry stores a care_coordinator document hidden from the patient, ALWAYS opens a clinician review alert (this patient
--      has no plan that would otherwise open one) with its own title, and a draft marked entry_method = 'manual' with who typed it
--      and where the values came from. The intake record is entered_by_hand, care_coordinator channel, waiting for a doctor, and
--      no reader attempt is counted. The patient gets the values-free notice (CDE-08) and reads neither document nor draft.
--   2. A critical typed value can raise that alert to urgent (the same bridge an AI reading uses).
--   3. A doctor files it through confirm_lab_report_extraction: an S27 result exists and the intake record is reviewed.
--   4. Refused: a clinician (not a coordinator), a name that does not match, no rows, a malformed row, no source, a future test
--      date, a file outside the patient's folder, details that do not line up with the rows. A draft cannot claim to be manual
--      without who typed it and where from.
--   5. SABOTAGE (automatic): with the CDE-02 branch removed from private.handle_lab_result_document, a hand entry for a patient
--      with no plan opens no review alert (so 1 proves the branch).
--   Sabotage by hand (checked 2026-11-04): the entry_method filter removed from private.cde_on_lab_report_extraction -> FAIL 1
--   (a hand entry counted as a reader attempt).
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde3_hand_entered_lab_results.sql

begin;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_patient uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_staff uuid;
  v_lab uuid;
  v_out jsonb;
  v_doc public.lab_result_documents;
  v_ext public.lab_report_extractions;
  v_cd public.clinical_documents;
  v_alert public.clinician_alerts;
  v_n integer;
  v_err text;
  v_def text;
  v_rows jsonb := '[
    {"reportedLabel":"Potassium","code":"potassium","label":"Potassium","value":6.9,"valueText":null,"unit":"mmol/L","canonicalUnit":"mmol/L","converted":false,"reportedRange":"3.5-5.1","confidence":"high","status":"ready","flags":[]},
    {"reportedLabel":"HbA1c","code":"hba1c","label":"HbA1c","value":7.8,"valueText":null,"unit":"%","canonicalUnit":"%","converted":false,"reportedRange":null,"confidence":"high","status":"ready","flags":[]}
  ]';
  v_details jsonb := '[{"labFlag":"high","specimen":"Serum","comment":null},{"labFlag":"high","specimen":null,"comment":null}]';
  v_identity jsonb := '{"name_on_report":"Ngozi Okafor","date_of_birth_on_report":"1980-01-15"}';
begin
  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  select id into v_lab from public.lab_providers limit 1;
  if v_admin is null or v_lab is null then raise exception 'SETUP: seed admin or laboratory missing'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'cde3-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_coord, 'cde3-coord@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde3-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Ngozi Adaeze Okafor', sex = 'female',
         date_of_birth = date '1980-01-15', is_test = true where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'care_coordinator', full_name = 'CDE3 Coordinator', is_test = true where id = v_coord;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE3 Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'CDE3 Doctor', 'MDCN', 'CDE3-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (v_org, v_staff, 'result_review', v_admin, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_patient, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- 1. the coordinator types in two results from an email
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.coordinator_submit_manual_results(v_patient, v_identity,
    jsonb_build_object('file_path', v_patient::text || '/cde3-typed.pdf', 'original_filename', 'typed.pdf', 'mime_type', 'application/pdf',
                       'file_size_bytes', 2000, 'content_sha256', repeat('6', 64)),
    false, v_rows, v_details, date '2026-11-03', 'Email from Synlab Ikeja, 3 Nov', v_lab, null, 'Lab asked us to pass it on');
  reset role;
  perform set_config('request.jwt.claims', null, true);

  select * into v_doc from public.lab_result_documents where id = (v_out ->> 'document_id')::uuid;
  select * into v_ext from public.lab_report_extractions where id = (v_out ->> 'extraction_id')::uuid;
  select * into v_cd from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = v_doc.id;
  select * into v_alert from public.clinician_alerts where id = v_doc.clinician_alert_id;
  if v_doc.source::text <> 'care_coordinator' or v_doc.uploaded_by <> v_coord or v_doc.content_sha256 <> repeat('6', 64) then
    raise exception 'FAIL 1: document is wrong: source %, uploader %', v_doc.source, v_doc.uploaded_by;
  end if;
  if v_alert.id is null or v_alert.status <> 'open' or v_alert.title not like 'Lab results typed in by the care team%' then
    raise exception 'FAIL 1: no clinician review alert for a hand entry (alert %, title %)', v_alert.id, v_alert.title;
  end if;
  if v_ext.entry_method <> 'manual' or v_ext.entered_by <> v_coord or v_ext.source_description <> 'Email from Synlab Ikeja, 3 Nov'
     or v_ext.status <> 'extracted' or v_ext.manual_details <> v_details or jsonb_array_length(v_ext.rows) <> 2 then
    raise exception 'FAIL 1: draft provenance is wrong: %', to_jsonb(v_ext) - 'rows';
  end if;
  if not v_cd.entered_by_hand or v_cd.upload_channel <> 'care_coordinator' or v_cd.status <> 'doctor_review_required'
     or v_cd.visible_to_patient or v_cd.extraction_attempts <> 0 or v_cd.investigation_date <> date '2026-11-03'
     or v_cd.identity_check -> 'matched_on' <> '["name", "date_of_birth"]'::jsonb then
    raise exception 'FAIL 1: intake record is wrong: %', to_jsonb(v_cd);
  end if;
  if not exists (select 1 from public.notifications where recipient_id = v_patient and template = 'lab_report_received'
                 and payload = jsonb_build_object('clinical_document_id', v_cd.id)) then
    raise exception 'FAIL 1: no values-free notice for the hand entry (CDE-08)';
  end if;
  if not exists (select 1 from public.audit_log where entity_id = v_ext.id and action = 'lab_results.entered_by_hand') then
    raise exception 'FAIL 1: the hand entry was not audited';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_result_documents where id = v_doc.id;
  select v_n + count(*) into v_n from public.lab_report_extractions where id = v_ext.id;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 1: the patient can read the unreviewed hand entry (% rows)', v_n; end if;

  -- 2. a critical typed value raises the alert to urgent (the bridge the server action calls)
  perform public.raise_lab_extraction_alert(v_doc.id, 'urgent_escalation', 'Potassium 6.9 typed in by hand');
  if (select level from public.clinician_alerts where id = v_alert.id) <> 'urgent_escalation' then
    raise exception 'FAIL 2: a critical hand-typed value could not raise the review alert';
  end if;

  -- 3. the doctor files it through the ordinary path
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.confirm_lab_report_extraction(v_ext.id, '[{"code":"potassium","value":6.9,"unit":"mmol/L"},{"code":"hba1c","value":7.8,"unit":"%"}]',
    date '2026-11-03');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if (select status from public.lab_report_extractions where id = v_ext.id) <> 'confirmed' then
    raise exception 'FAIL 3: the doctor could not file the hand entry';
  end if;
  if not exists (select 1 from public.lab_results where patient_id = v_patient) then
    raise exception 'FAIL 3: filing the hand entry created no S27 result';
  end if;
  if (select status from public.clinical_documents where id = v_cd.id) <> 'reviewed' then
    raise exception 'FAIL 3: the intake record is not reviewed after filing';
  end if;

  -- 4. refusals
  for v_out in select * from (values
      (jsonb_build_object('who', v_doctor, 'expect', 'This action is for care coordinators')),
      (jsonb_build_object('who', v_coord, 'identity', '{"name_on_report":"Amaka Eze","date_of_birth_on_report":"1980-01-15"}'::jsonb, 'expect', 'identity_name_mismatch')),
      (jsonb_build_object('who', v_coord, 'rows', '[]'::jsonb, 'expect', 'manual_rows_required')),
      (jsonb_build_object('who', v_coord, 'rows', '[{"code":"potassium","status":"ready","confidence":"low","reportedLabel":"K"}]'::jsonb, 'expect', 'manual_rows_invalid')),
      (jsonb_build_object('who', v_coord, 'source', '', 'expect', 'manual_source_required')),
      (jsonb_build_object('who', v_coord, 'date', '2099-01-01', 'expect', 'investigation_date_required')),
      (jsonb_build_object('who', v_coord, 'path', 'someone-else/x.pdf', 'expect', 'lab_file_path_invalid')),
      (jsonb_build_object('who', v_coord, 'details', '[{"labFlag":"none","specimen":null,"comment":null}]'::jsonb, 'expect', 'manual_details_invalid'))
    ) t(c) loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_out ->> 'who', 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_err := null;
    begin
      perform public.coordinator_submit_manual_results(v_patient, coalesce(v_out -> 'identity', v_identity),
        jsonb_build_object('file_path', coalesce(v_out ->> 'path', v_patient::text || '/cde3-x.pdf'), 'original_filename', 'x.pdf',
                           'mime_type', 'application/pdf', 'file_size_bytes', 1000, 'content_sha256', repeat('7', 64)),
        false, coalesce(v_out -> 'rows', v_rows), coalesce(v_out -> 'details', v_details), coalesce((v_out ->> 'date')::date, date '2026-11-03'),
        coalesce(v_out ->> 'source', 'Email from the lab'), v_lab, null, null);
    exception when others then v_err := sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', null, true);
    if v_err is distinct from (v_out ->> 'expect') then
      raise exception 'FAIL 4: expected refusal "%" got "%"', v_out ->> 'expect', v_err;
    end if;
  end loop;

  v_err := null;
  begin
    insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, entry_method)
    values (v_org, v_patient, v_doc.id, 'extracted', '[]', 'manual');
  exception when others then v_err := sqlstate;
  end;
  if v_err is distinct from '23514' and v_err is distinct from '23505' then
    raise exception 'FAIL 4: a manual draft without who typed it and where from was accepted (%)', v_err;
  end if;

  -- 5. SABOTAGE: without the CDE-02 branch, a hand entry for a patient with no plan opens no review alert
  select pg_get_functiondef('private.handle_lab_result_document()'::regprocedure) into v_def;
  v_def := replace(v_def, 'if new.source::text = ''care_coordinator'' then
    v_has_review_access := true;
  elsif new.lab_order_id is not null then', 'if new.lab_order_id is not null then');
  execute v_def;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.coordinator_submit_manual_results(v_patient, v_identity,
    jsonb_build_object('file_path', v_patient::text || '/cde3-sab.pdf', 'original_filename', 's.pdf', 'mime_type', 'application/pdf',
                       'file_size_bytes', 1000, 'content_sha256', repeat('8', 64)),
    false, v_rows, v_details, date '2026-11-03', 'Email from the lab', v_lab, null, null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if (select clinician_alert_id from public.lab_result_documents where id = (v_out ->> 'document_id')::uuid) is not null then
    raise exception 'FAIL 5 (sabotage): a review alert opened without the CDE-02 branch, so 1 does not prove it';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
