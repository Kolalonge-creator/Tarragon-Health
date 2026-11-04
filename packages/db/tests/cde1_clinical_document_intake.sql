-- Proof: clinical document engine, step 1 (migration *_cde1_clinical_document_intake.sql). One intake record for every uploaded
-- lab document, whichever door it came in by; status derived from the facts; a failed read reaches a person; the same file is
-- never filed twice in one record. Design: docs/plans/clinical-document-engine-2026-11-04.md.
--
--   1. A patient's own upload opens one intake row (patient_app, kind lab, processing, visible to that patient only).
--   2. Privacy: the patient reads it; another patient and anon read nothing; no client can insert, update or delete an intake
--      or job row; the patient reads no job row (error text is staff-only).
--   3. A failed read: processing_failed, one failed attempt, the error kept, and it is on the ops exception queue ('documents').
--      A second failure counts 2. A clean read afterwards: processed, failed count back to 0, off the queue.
--   4. A read with a low-confidence row: awaiting_verification, never processed.
--   5. Duplicate: the same file again in the same record is refused (clinical_document_duplicate); the same file in another
--      patient's record is accepted.
--   6. Team path (S27): a clinician's file for the patient opens an intake row (clinician, doctor_review_required) that the
--      patient cannot see and the clinician can; the same bytes as the patient's own upload are refused; release makes it reviewed
--      and visible.
--      6b. A withdrawn result is hidden from the patient again. 6c. A patient's own S27 file, withheld by a clinician, is hidden
--      from that patient (the uploader branch of the read policy is for staff uploaders only).
--   7. Replacement: a patient replacing an unreviewed upload marks the old intake row superseded. 7b. The replaced file may be
--      uploaded again, and a later review of the replaced upload still succeeds (the unique index keys on is_superseded).
--   8. SABOTAGE (automatic): with the extraction trigger dropped, a failed read leaves the document "processing" (so 3 proves the
--      trigger); with the intake trigger dropped, an upload opens no intake row and a duplicate is not refused (so 1 and 5 prove it).
--   Sabotage by hand (checked 2026-11-04): withdrawn_at removed from the lab_results trigger -> FAIL 6b; the read policy's uploader
--   branch opened to patients -> FAIL 6c; the unique index keyed on status <> 'superseded' -> 7b's review raises a duplicate key.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde1_clinical_document_intake.sql

begin;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_patient uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_staff uuid;
  v_doc uuid;
  v_doc2 uuid;
  v_new_doc uuid;
  v_cd public.clinical_documents;
  v_n integer;
  v_err text;
  v_q jsonb;
  v_sha_a text := repeat('a', 64);
  v_sha_b text := repeat('b', 64);
  v_sha_c text := repeat('c', 64);
  v_ready jsonb := '[{"code":"hba1c","value":6.1,"unit":"%","confidence":"high","status":"ready"}]';
  v_low jsonb := '[{"code":"hba1c","value":6.1,"unit":"%","confidence":"low","status":"ready"}]';
begin
  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  if v_admin is null then raise exception 'SETUP: no admin in the seed organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'cde1-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_other, 'cde1-other@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde1-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'CDE1 Patient', sex = 'female',
         date_of_birth = date '1980-01-15', is_test = true where id in (v_patient, v_other);
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE1 Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'CDE1 Doctor', 'MDCN', 'CDE1-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (v_org, v_staff, 'result_review', v_admin, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  select v_org, p, v_doctor, now() from unnest(array[v_patient, v_other]) p
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- 1. the patient uploads their own report
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by, content_sha256)
  values (v_org, v_patient, v_patient::text || '/cde1-a.pdf', 'a.pdf', 'application/pdf', 1000, 'patient', v_patient, v_sha_a)
  returning id into v_doc;
  reset role;
  perform set_config('request.jwt.claims', null, true);

  select * into v_cd from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = v_doc;
  if v_cd.id is null then raise exception 'FAIL 1: an upload opened no intake row'; end if;
  if v_cd.upload_channel <> 'patient_app' or v_cd.kind_code <> 'lab' or v_cd.status <> 'processing'
     or not v_cd.visible_to_patient or v_cd.uploaded_by <> v_patient or v_cd.content_sha256 <> v_sha_a or not v_cd.is_test then
    raise exception 'FAIL 1: intake row is wrong: channel %, kind %, status %, visible %', v_cd.upload_channel, v_cd.kind_code,
      v_cd.status, v_cd.visible_to_patient;
  end if;

  -- 2. privacy and no client write path
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_documents where id = v_cd.id;
  if v_n <> 1 then reset role; raise exception 'FAIL 2: the patient cannot read their own intake row'; end if;
  v_err := null;
  begin
    update public.clinical_documents set status = 'reviewed' where id = v_cd.id;
  exception when others then v_err := sqlstate;
  end;
  if v_err is distinct from '42501' then reset role; raise exception 'FAIL 2: a patient could update an intake row (%)', v_err; end if;
  v_err := null;
  begin
    insert into public.clinical_documents (organisation_id, patient_id, upload_channel, kind_code, kind_source, access_category,
        status, routed_table, routed_id)
    values (v_org, v_patient, 'patient_app', 'lab', 'uploader', 'labs_results', 'reviewed', 'lab_result_documents', gen_random_uuid());
  exception when others then v_err := sqlstate;
  end;
  if v_err is distinct from '42501' then reset role; raise exception 'FAIL 2: a patient could insert an intake row (%)', v_err; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_documents where id = v_cd.id;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 2: another patient can read the intake row'; end if;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  v_err := null;
  begin
    select count(*) into v_n from public.clinical_documents;
  exception when others then v_err := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_err is distinct from '42501' then raise exception 'FAIL 2: anon can query clinical_documents (%)', v_err; end if;

  -- 3. the reader fails (server-side step, written as the runner writes it)
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, error_message)
  values (v_org, v_patient, v_doc, 'failed', '[]', 'timeout after 30s');
  select * into v_cd from public.clinical_documents where id = v_cd.id;
  if v_cd.status <> 'processing_failed' or v_cd.failed_attempts <> 1 or v_cd.extraction_attempts <> 1
     or v_cd.last_error <> 'timeout after 30s' then
    raise exception 'FAIL 3: a failed read is %, failed % of %', v_cd.status, v_cd.failed_attempts, v_cd.extraction_attempts;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_q := public.ops_exception_queue('documents', 200);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if not exists (select 1 from jsonb_array_elements(v_q) e where (e ->> 'entity_id')::uuid = v_cd.id and e ->> 'domain' = 'documents') then
    raise exception 'FAIL 3: a failed read is not on the ops exception queue';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_document_jobs where document_id = v_cd.id;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 2: the patient can read reader job rows (error text is staff-only)'; end if;

  update public.lab_report_extractions set status = 'failed', error_message = 'model unavailable' where document_id = v_doc;
  select * into v_cd from public.clinical_documents where id = v_cd.id;
  if v_cd.failed_attempts <> 2 or v_cd.last_error <> 'model unavailable' then
    raise exception 'FAIL 3: a second failure was not counted (failed %)', v_cd.failed_attempts;
  end if;

  update public.lab_report_extractions set status = 'extracted', rows = v_ready, error_message = null where document_id = v_doc;
  select * into v_cd from public.clinical_documents where id = v_cd.id;
  if v_cd.status <> 'processed' or v_cd.failed_attempts <> 0 or v_cd.extraction_attempts <> 3 then
    raise exception 'FAIL 3: a clean read after failures is %, failed %, attempts %', v_cd.status, v_cd.failed_attempts, v_cd.extraction_attempts;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_q := public.ops_exception_queue('documents', 200);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if exists (select 1 from jsonb_array_elements(v_q) e where (e ->> 'entity_id')::uuid = v_cd.id) then
    raise exception 'FAIL 3: a document that was read is still on the ops exception queue';
  end if;

  -- 4. a low-confidence row holds the document for verification
  update public.lab_report_extractions set rows = v_low where document_id = v_doc;
  update public.lab_report_extractions set status = 'extracted' where document_id = v_doc;
  select * into v_cd from public.clinical_documents where id = v_cd.id;
  if v_cd.status <> 'awaiting_verification' then
    raise exception 'FAIL 4: a low-confidence read is % (must be awaiting_verification)', v_cd.status;
  end if;

  -- 5. the same file again in the same record is refused; in another patient's record it is accepted
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null;
  begin
    insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
        source, uploaded_by, content_sha256)
    values (v_org, v_patient, v_patient::text || '/cde1-a-again.pdf', 'a.pdf', 'application/pdf', 1000, 'patient', v_patient, v_sha_a);
  exception when others then v_err := sqlerrm;
  end;
  reset role;
  if v_err is distinct from 'clinical_document_duplicate' then
    raise exception 'FAIL 5: the same file was not refused in the same record (%)', v_err;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by, content_sha256)
  values (v_org, v_other, v_other::text || '/cde1-a.pdf', 'a.pdf', 'application/pdf', 1000, 'patient', v_other, v_sha_a);
  reset role;
  perform set_config('request.jwt.claims', null, true);

  -- 6. the S27 team path
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.team_submit_lab_result(v_patient, null, null, null,
      jsonb_build_object('file_path', v_patient::text || '/cde1-team-dup.pdf', 'original_filename', 'dup.pdf',
                         'mime_type', 'application/pdf', 'file_size_bytes', 1000, 'content_sha256', v_sha_a));
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'clinical_document_duplicate' then
    reset role; raise exception 'FAIL 6: the team path accepted a file already in the record (%)', v_err;
  end if;
  perform public.team_submit_lab_result(v_patient, null, null, null,
    jsonb_build_object('file_path', v_patient::text || '/cde1-team.pdf', 'original_filename', 'team.pdf',
                       'mime_type', 'application/pdf', 'file_size_bytes', 1000, 'content_sha256', v_sha_b));
  select count(*) into v_n from public.clinical_documents where patient_id = v_patient and content_sha256 = v_sha_b;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 6: the uploading clinician cannot see their upload''s intake row'; end if;
  if current_setting('tarragon.upload_sha256', true) <> '' then
    raise exception 'FAIL 6: the fingerprint setting leaked past the submit call';
  end if;

  select * into v_cd from public.clinical_documents where patient_id = v_patient and content_sha256 = v_sha_b;
  if v_cd.routed_table <> 'lab_result_files' or v_cd.upload_channel <> 'clinician' or v_cd.status <> 'doctor_review_required'
     or v_cd.visible_to_patient then
    raise exception 'FAIL 6: team intake row is wrong: %, %, %, visible %', v_cd.routed_table, v_cd.upload_channel, v_cd.status,
      v_cd.visible_to_patient;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_documents where id = v_cd.id;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 6: the patient can see a held team upload before release'; end if;

  select id into v_doc2 from public.lab_results where document_id = v_cd.routed_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_q := public.release_lab_result(v_doc2, 'Reviewed, nothing to add');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if coalesce((v_q ->> 'ok')::boolean, false) is not true then raise exception 'SETUP 6: the clinician could not release (%)', v_q; end if;
  select * into v_cd from public.clinical_documents where id = v_cd.id;
  if v_cd.status <> 'reviewed' or not v_cd.visible_to_patient then
    raise exception 'FAIL 6: a released team upload is %, visible %', v_cd.status, v_cd.visible_to_patient;
  end if;

  -- 6b. withdrawing a released result hides it from the patient again (lab_results: withdrawn_at is null)
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_q := public.withdraw_lab_result(v_doc2, 'Report belonged to another patient');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if coalesce((v_q ->> 'ok')::boolean, false) is not true then raise exception 'SETUP 6b: the clinician could not withdraw (%)', v_q; end if;
  select * into v_cd from public.clinical_documents where id = v_cd.id;
  if v_cd.visible_to_patient then raise exception 'FAIL 6b: a withdrawn result is still visible to the patient'; end if;

  -- 6c. a patient's own S27 file, withheld by a clinician: hidden from the patient although the patient uploaded it
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.patient_add_lab_result(jsonb_build_object('file_path', v_other::text || '/cde1-own.pdf', 'original_filename', 'own.pdf',
                                                           'mime_type', 'application/pdf', 'file_size_bytes', 1000));
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select * into v_cd from public.clinical_documents where routed_table = 'lab_result_files' and patient_id = v_other;
  if v_cd.id is null or v_cd.upload_channel <> 'patient_app' or not v_cd.visible_to_patient then
    raise exception 'FAIL 6c: a patient-added S27 file is not visible to its patient (channel %, visible %)', v_cd.upload_channel, v_cd.visible_to_patient;
  end if;
  select id into v_doc2 from public.lab_results where document_id = v_cd.routed_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_q := public.withhold_lab_result(v_doc2, 'Not a lab report: a photo of a prescription');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if coalesce((v_q ->> 'ok')::boolean, false) is not true then raise exception 'SETUP 6c: the clinician could not withhold (%)', v_q; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_documents where id = v_cd.id;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 6c: the patient still reads the intake row of their withheld file'; end if;

  -- 7. replacing an unreviewed upload marks the old one superseded
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by, content_sha256)
  values (v_org, v_patient, v_patient::text || '/cde1-c.pdf', 'c.pdf', 'application/pdf', 1000, 'patient', v_patient, v_sha_c)
  returning id into v_doc2;
  v_new_doc := public.replace_my_result_document(v_doc2, v_patient::text || '/cde1-c2.pdf', 'c2.pdf', 'application/pdf', 1200);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select * into v_cd from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = v_doc2;
  if v_cd.status <> 'superseded' then raise exception 'FAIL 7: a replaced upload is % (must be superseded)', v_cd.status; end if;
  if not exists (select 1 from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = v_new_doc) then
    raise exception 'FAIL 7: the replacement opened no intake row';
  end if;

  -- 7b. the replaced file may be uploaded again, and a later review of the replaced upload still succeeds
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by, content_sha256)
  values (v_org, v_patient, v_patient::text || '/cde1-c3.pdf', 'c.pdf', 'application/pdf', 1000, 'patient', v_patient, v_sha_c);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select routed_id into v_doc2 from public.clinical_documents where routed_table = 'lab_result_documents' and content_sha256 = v_sha_c
     and is_superseded;
  if v_doc2 is null then raise exception 'FAIL 7b: the replaced upload is not marked superseded'; end if;
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_doctor where id = v_doc2;
  select * into v_cd from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = v_doc2;
  if v_cd.status <> 'reviewed' or not v_cd.is_superseded then
    raise exception 'FAIL 7b: reviewing a replaced upload gave %, superseded %', v_cd.status, v_cd.is_superseded;
  end if;

  -- 8. SABOTAGE
  drop trigger cde_refresh_on_extraction on public.lab_report_extractions;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by)
  values (v_org, v_other, v_other::text || '/cde1-sab.pdf', 's.pdf', 'application/pdf', 1000, 'patient', v_other)
  returning id into v_doc;
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, error_message)
  values (v_org, v_other, v_doc, 'failed', '[]', 'timeout');
  select * into v_cd from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = v_doc;
  if v_cd.status = 'processing_failed' then
    raise exception 'FAIL 8 (sabotage): a failed read reached processing_failed without the extraction trigger, so 3 does not prove it';
  end if;

  drop trigger cde_intake_on_insert on public.lab_result_documents;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by, content_sha256)
  values (v_org, v_other, v_other::text || '/cde1-a-dup.pdf', 'a.pdf', 'application/pdf', 1000, 'patient', v_other, v_sha_a)
  returning id into v_doc;
  if exists (select 1 from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = v_doc) then
    raise exception 'FAIL 8 (sabotage): an intake row appeared without the intake trigger, so 1 does not prove it';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
