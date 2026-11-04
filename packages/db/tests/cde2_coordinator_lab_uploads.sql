-- Proof: clinical document engine, step 2 (migration *_cde2_coordinator_lab_uploads.sql). A Care Coordinator uploads a lab report
-- for a patient (CDE-03: no separate Laboratory Liaison role). Design: docs/plans/clinical-document-engine-2026-11-04.md §5.
--
--   1. Search: by patient number, by phone in any of its Nigerian forms, by email; a name alone is refused; a name with the right
--      date of birth finds the patient and with a wrong one finds nobody; a coordinator of another organisation finds nobody; a
--      patient and a clinician are refused; each search is audited without its text.
--   2. Upload: name + date of birth (or + patient number) files a held S27 result; the intake row is care_coordinator, records what
--      matched, the laboratory and the test date; the patient cannot see it, the coordinator can. Refused: a date of birth or a
--      patient number that does not match, a name that does not match, a name with no second identifier, no fingerprint, no
--      laboratory, a patient in another organisation, a clinician (not a coordinator), the same file twice.
--   3. Corrections: the uploader corrects the test date with a reason (audited with the old value); another coordinator cannot;
--      after a clinician has released the result nobody can.
--   4. Fingerprint gaps closed: a patient's replacement upload and a patient-added S27 file are refused when the file is already in
--      the record.
--      2b. A record holding a single name can still be uploaded for. 3b. Choosing a typed laboratory replaces a directory one; an
--      empty note clears the note. The search masks the patient number (last four characters only).
--   5. Laboratory assignments: a coordinator reads their own and cannot create one; an admin can; 5b. only a coordinator of the
--      same organisation can hold one.
--   6. SABOTAGE (automatic): with the uploader check opened to any active account, the clinician's upload is no longer refused
--      (so 2 proves the check).
--   Sabotage by hand (checked 2026-11-04): private.cde_name_words made to return a constant -> FAIL 2 (a wrong name is accepted);
--   the duplicate refusal and its unique index removed -> FAIL 2 (the same file is filed twice).
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde2_coordinator_lab_uploads.sql

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid;
  v_admin uuid;
  v_patient uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_coord2 uuid := gen_random_uuid();
  v_coord_other uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_staff uuid;
  v_lab uuid;
  v_n integer;
  v_err text;
  v_out jsonb;
  v_cd public.clinical_documents;
  v_lr uuid;
  v_doc uuid;
  v_sha1 text := repeat('1', 64);
  v_sha2 text := repeat('2', 64);
  v_sha3 text := repeat('3', 64);
  v_audit_before integer;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  select id into v_lab from public.lab_providers limit 1;
  if v_admin is null or v_lab is null then raise exception 'SETUP: seed admin or laboratory missing'; end if;
  insert into public.organisations (id, name, type) select gen_random_uuid(), 'CDE2 Other Org', type from public.organisations where id = v_org returning id into v_org2;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'cde2-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_coord, 'cde2-coord@example.invalid', 'x', now(), '{}', '{}'),
         (v_coord2, 'cde2-coord2@example.invalid', 'x', now(), '{}', '{}'),
         (v_coord_other, 'cde2-coord-other@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde2-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Ngozi Adaeze Okafor', sex = 'female',
         date_of_birth = date '1980-01-15', phone = '+2348031234567', patient_number = 'CDE2-0001', is_test = true where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'care_coordinator', full_name = 'CDE2 Coordinator', is_test = true
   where id in (v_coord, v_coord2);
  update public.profiles set organisation_id = v_org2, role = 'care_coordinator', full_name = 'CDE2 Other Coordinator', is_test = true
   where id = v_coord_other;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE2 Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'CDE2 Doctor', 'MDCN', 'CDE2-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (v_org, v_staff, 'result_review', v_admin, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_patient, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- 1. search
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_audit_before from public.audit_log where actor_id = v_coord and action = 'patient.upload_search';
  select count(*) into v_n from public.find_patient_for_upload('cde2-0001') where patient_id = v_patient and patient_number_hint = '…0001';
  if v_n <> 1 then reset role; raise exception 'FAIL 1: not found by patient number, or the number is not masked'; end if;
  select count(*) into v_n from public.find_patient_for_upload('08031234567') where patient_id = v_patient;
  if v_n <> 1 then reset role; raise exception 'FAIL 1: not found by local phone form'; end if;
  select count(*) into v_n from public.find_patient_for_upload('+234 803 123 4567') where patient_id = v_patient;
  if v_n <> 1 then reset role; raise exception 'FAIL 1: not found by international phone form'; end if;
  select count(*) into v_n from public.find_patient_for_upload('CDE2-Patient@example.invalid') where patient_id = v_patient;
  if v_n <> 1 then reset role; raise exception 'FAIL 1: not found by email'; end if;
  v_err := null;
  begin
    perform public.find_patient_for_upload('Ngozi Okafor');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'find_patient_name_needs_date_of_birth' then reset role; raise exception 'FAIL 1: a name alone was accepted (%)', v_err; end if;
  select count(*) into v_n from public.find_patient_for_upload('okafor ngozi', date '1980-01-15') where patient_id = v_patient;
  if v_n <> 1 then reset role; raise exception 'FAIL 1: not found by name with date of birth'; end if;
  select count(*) into v_n from public.find_patient_for_upload('Ngozi Okafor', date '1981-01-15');
  if v_n <> 0 then reset role; raise exception 'FAIL 1: a wrong date of birth still found someone'; end if;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from public.audit_log where actor_id = v_coord and action = 'patient.upload_search';
  if v_n - v_audit_before <> 6 then raise exception 'FAIL 1: % searches audited, expected 6', v_n - v_audit_before; end if;
  if exists (select 1 from public.audit_log where actor_id = v_coord and action = 'patient.upload_search'
             and (event::text ilike '%okafor%' or event::text like '%0803%')) then
    raise exception 'FAIL 1: the search text was written to the audit log';
  end if;

  -- a coordinator in another organisation finds nobody
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.find_patient_for_upload('08031234567');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 1: a coordinator of another organisation found the patient'; end if;

  foreach v_doc in array array[v_patient, v_doctor] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_err := null; v_n := null;
    begin
      select count(*) into v_n from public.find_patient_for_upload('CDE2-0001');
    exception when others then v_err := sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims', null, true);
    if v_err is distinct from '42501' then raise exception 'FAIL 1: % could search (found %, %)', v_doc, v_n, v_err; end if;
  end loop;

  -- 2. upload
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.coordinator_submit_lab_report(v_patient,
    jsonb_build_object('file_path', v_patient::text || '/cde2-a.pdf', 'original_filename', 'a.pdf', 'mime_type', 'application/pdf',
                       'file_size_bytes', 1000, 'content_sha256', v_sha1),
    jsonb_build_object('name_on_report', 'OKAFOR, Ngozi A.', 'date_of_birth_on_report', '1980-01-15'),
    v_lab, null, date '2026-11-01', 'Emailed by the lab');
  select count(*) into v_n from public.clinical_documents where id = (v_out ->> 'document_id')::uuid;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 1 then raise exception 'FAIL 2: the coordinator cannot see their own upload'; end if;
  select * into v_cd from public.clinical_documents where id = (v_out ->> 'document_id')::uuid;
  if v_cd.upload_channel <> 'care_coordinator' or v_cd.status <> 'doctor_review_required' or v_cd.visible_to_patient
     or v_cd.source_facility_id <> v_lab or v_cd.investigation_date <> date '2026-11-01' or v_cd.admin_note <> 'Emailed by the lab'
     or v_cd.identity_check -> 'matched_on' <> '["name", "date_of_birth"]'::jsonb or (v_cd.identity_check ->> 'confirmed_by')::uuid <> v_coord then
    raise exception 'FAIL 2: intake row is wrong: %', to_jsonb(v_cd);
  end if;
  select id into v_lr from public.lab_results where id = (v_out ->> 'lab_result_id')::uuid
     and submitted_by_kind = 'tarragon_team' and submitted_by = v_coord and release_state <> 'released';
  if v_lr is null then raise exception 'FAIL 2: no held S27 result for the upload'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_documents where id = v_cd.id;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 2: the patient sees a held coordinator upload'; end if;

  -- patient number as the second identifier
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.coordinator_submit_lab_report(v_patient,
    jsonb_build_object('file_path', v_patient::text || '/cde2-b.pdf', 'original_filename', 'b.pdf', 'mime_type', 'application/pdf',
                       'file_size_bytes', 1000, 'content_sha256', v_sha2),
    jsonb_build_object('name_on_report', 'Ngozi Okafor', 'patient_number_on_report', 'cde2-0001'),
    null, 'Afriglobal Ikeja', null, null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if (select identity_check -> 'matched_on' from public.clinical_documents where id = (v_out ->> 'document_id')::uuid)
     <> '["name", "patient_number"]'::jsonb then
    raise exception 'FAIL 2: patient number was not recorded as the second identifier';
  end if;

  -- refusals
  for v_out in select * from (values
      (jsonb_build_object('who', v_coord, 'name', 'Ngozi Okafor', 'dob', '1981-01-15', 'sha', v_sha3, 'lab', v_lab, 'expect', 'identity_date_of_birth_mismatch')),
      (jsonb_build_object('who', v_coord, 'name', 'Ngozi Okafor', 'number', 'CDE2-9999', 'sha', v_sha3, 'lab', v_lab, 'expect', 'identity_patient_number_mismatch')),
      (jsonb_build_object('who', v_coord, 'name', 'Amaka Eze', 'dob', '1980-01-15', 'sha', v_sha3, 'lab', v_lab, 'expect', 'identity_name_mismatch')),
      (jsonb_build_object('who', v_coord, 'name', 'Ngozi Okafor', 'sha', v_sha3, 'lab', v_lab, 'expect', 'identity_second_identifier_required')),
      (jsonb_build_object('who', v_coord, 'name', 'Ngozi Okafor', 'dob', '1980-01-15', 'lab', v_lab, 'expect', 'lab_file_hash_invalid')),
      (jsonb_build_object('who', v_coord, 'name', 'Ngozi Okafor', 'dob', '1980-01-15', 'sha', v_sha3, 'expect', 'source_facility_required')),
      (jsonb_build_object('who', v_coord, 'name', 'Ngozi Okafor', 'dob', '1980-01-15', 'sha', v_sha1, 'lab', v_lab, 'expect', 'clinical_document_duplicate')),
      (jsonb_build_object('who', v_coord_other, 'name', 'Ngozi Okafor', 'dob', '1980-01-15', 'sha', v_sha3, 'lab', v_lab, 'expect', 'Not permitted')),
      (jsonb_build_object('who', v_doctor, 'name', 'Ngozi Okafor', 'dob', '1980-01-15', 'sha', v_sha3, 'lab', v_lab, 'expect', 'This action is for care coordinators'))
    ) t(c) loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_out ->> 'who', 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_err := null;
    begin
      perform public.coordinator_submit_lab_report(v_patient,
        jsonb_strip_nulls(jsonb_build_object('file_path', v_patient::text || '/cde2-x.pdf', 'original_filename', 'x.pdf',
                           'mime_type', 'application/pdf', 'file_size_bytes', 1000, 'content_sha256', v_out ->> 'sha')),
        jsonb_strip_nulls(jsonb_build_object('name_on_report', v_out ->> 'name', 'date_of_birth_on_report', v_out ->> 'dob',
                           'patient_number_on_report', v_out ->> 'number')),
        (v_out ->> 'lab')::uuid, null, null, null);
    exception when others then v_err := sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', null, true);
    if v_err is distinct from (v_out ->> 'expect') then
      raise exception 'FAIL 2: expected refusal "%" got "%"', v_out ->> 'expect', v_err;
    end if;
  end loop;

  -- 3. corrections
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.correct_clinical_document_metadata(v_cd.id, 'Lab printed the wrong date', date '2026-10-31');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if (select investigation_date from public.clinical_documents where id = v_cd.id) <> date '2026-10-31' then
    raise exception 'FAIL 3: the uploader''s correction was not saved';
  end if;
  if not exists (select 1 from public.audit_log where entity_id = v_cd.id and action = 'clinical_document.metadata_corrected'
                 and event -> 'before' ->> 'investigation_date' = '2026-11-01') then
    raise exception 'FAIL 3: the correction was not audited with the old value';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.correct_clinical_document_metadata(v_cd.id, 'Not mine to change', date '2026-10-30');
  exception when others then v_err := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_err is distinct from '42501' then raise exception 'FAIL 3: another coordinator corrected the upload (%)', v_err; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.release_lab_result(v_lr, 'Reviewed, nothing to add');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if coalesce((v_out ->> 'ok')::boolean, false) is not true then raise exception 'SETUP 3: release failed (%)', v_out; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.correct_clinical_document_metadata(v_cd.id, 'Too late to change', date '2026-10-30');
  exception when others then v_err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_err is distinct from 'clinical_document_already_reviewed' then raise exception 'FAIL 3: a reviewed upload was corrected (%)', v_err; end if;

  -- 2b. a record holding a single name can still be uploaded for (one shared word + date of birth)
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values ('0c0de200-0000-4000-8000-000000000001', 'cde2-single@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Adebayo', date_of_birth = date '1975-05-05', is_test = true
   where id = '0c0de200-0000-4000-8000-000000000001';
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.coordinator_submit_lab_report('0c0de200-0000-4000-8000-000000000001',
    jsonb_build_object('file_path', '0c0de200-0000-4000-8000-000000000001/cde2-s.pdf', 'original_filename', 's.pdf',
                       'mime_type', 'application/pdf', 'file_size_bytes', 1000, 'content_sha256', repeat('5', 64)),
    jsonb_build_object('name_on_report', 'ADEBAYO', 'date_of_birth_on_report', '1975-05-05'), v_lab, null, null, null);
  -- 3b. a correction from a directory laboratory to a typed one replaces it, and an empty note clears the note
  perform public.correct_clinical_document_metadata((v_out ->> 'document_id')::uuid, 'Wrong laboratory picked', null, null,
    'Afriglobal Ikeja', '');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select * into v_cd from public.clinical_documents where id = (v_out ->> 'document_id')::uuid;
  if v_cd.source_facility_id is not null or v_cd.source_facility_name <> 'Afriglobal Ikeja' or v_cd.admin_note is not null then
    raise exception 'FAIL 3b: a typed laboratory did not replace the directory one (id %, name %, note %)',
      v_cd.source_facility_id, v_cd.source_facility_name, v_cd.admin_note;
  end if;

  -- 5b. a laboratory assignment is only for a coordinator of the same organisation
  v_err := null;
  begin
    insert into public.staff_lab_assignments (organisation_id, staff_profile_id, lab_provider_id) values (v_org, v_patient, v_lab);
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'staff_lab_assignment_not_a_coordinator' then
    raise exception 'FAIL 5b: a laboratory was assigned to a patient account (%)', v_err;
  end if;

  -- 4. fingerprint gaps closed
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by, content_sha256)
  values (v_org, v_patient, v_patient::text || '/cde2-own.pdf', 'own.pdf', 'application/pdf', 1000, 'patient', v_patient, v_sha3)
  returning id into v_doc;
  v_err := null;
  begin
    perform public.replace_my_result_document(v_doc, v_patient::text || '/cde2-own2.pdf', 'own2.pdf', 'application/pdf', 1000,
      null, v_sha1);
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'clinical_document_duplicate' then
    reset role; raise exception 'FAIL 4: a replacement with a file already in the record was accepted (%)', v_err;
  end if;
  v_err := null;
  begin
    perform public.patient_add_lab_result(jsonb_build_object('file_path', v_patient::text || '/cde2-add.pdf', 'original_filename', 'add.pdf',
      'mime_type', 'application/pdf', 'file_size_bytes', 1000, 'content_sha256', v_sha2));
  exception when others then v_err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_err is distinct from 'clinical_document_duplicate' then
    raise exception 'FAIL 4: a patient-added file already in the record was accepted (%)', v_err;
  end if;

  -- 5. laboratory assignments
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.staff_lab_assignments (organisation_id, staff_profile_id, lab_provider_id, assigned_by)
  values (v_org, v_coord, v_lab, v_admin);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.staff_lab_assignments where staff_profile_id = v_coord;
  v_err := null;
  begin
    insert into public.staff_lab_assignments (organisation_id, staff_profile_id, lab_provider_id) values (v_org, v_coord2, v_lab);
  exception when others then v_err := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 1 then raise exception 'FAIL 5: the coordinator cannot read their own assignment'; end if;
  if v_err is distinct from '42501' then raise exception 'FAIL 5: a coordinator created an assignment (%)', v_err; end if;

  -- 6. SABOTAGE
  create or replace function private.cde_uploader_org() returns uuid language sql stable security definer set search_path to '' as
    $f$ select organisation_id from public.profiles where id = (select auth.uid()) and is_active $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.coordinator_submit_lab_report(v_patient,
      jsonb_build_object('file_path', v_patient::text || '/cde2-sab.pdf', 'original_filename', 's.pdf', 'mime_type', 'application/pdf',
                         'file_size_bytes', 1000, 'content_sha256', repeat('4', 64)),
      jsonb_build_object('name_on_report', 'Ngozi Okafor', 'date_of_birth_on_report', '1980-01-15'), v_lab, null, null, null);
  exception when others then v_err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_err is not null then
    raise exception 'FAIL 6 (sabotage): with the uploader check opened the clinician is still refused (%), so 2 does not prove it', v_err;
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
