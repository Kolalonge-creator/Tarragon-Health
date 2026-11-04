-- Proof: clinical document engine, step 5a (migration *_cde6_ecg_imaging_through_intake.sql). ECG and imaging documents through
-- the intake record, the per-document imaging access category, and "Not sure" uploads routed to the ECG and imaging stores.
-- Design: docs/plans/clinical-document-engine-2026-11-04.md §17.
--
--   1. A patient's ECG upload opens an intake record (kind cardiology.ecg, channel patient_app, waiting for a doctor because the ECG
--      handler opened its alert, visible to the patient); the same file again, even as an imaging upload, is refused as a duplicate.
--      A clinician's review moves the intake record to reviewed. A clinician's own ECG upload sends no lab notice (CDE-08 is for
--      the lab stores; the ECG handler tells the patient itself).
--   2. A "Not sure" upload sorted as an obstetric ultrasound waits for its reader ('processing', not routed). route_clinical_document
--      inserts the imaging row for the copied file with the kind's category (reproductive_health), the intake row is adopted (no
--      second row) and is waiting for a doctor; a report filed from that document inherits the category.
--   3. A "Not sure" upload sorted as an ECG is routed into the ECG store, with the ECG review alert.
--   4. Refused: route_clinical_document for a client (service role only), for a document not waiting for a reader, for a file that
--      is not in the reader's bucket or not in the patient's folder; changing an imaging record's category from a session.
--   5. SABOTAGE (automatic): without the ECG branch of the adoption in private.cde_open_intake, routing a sorted ECG is refused as a
--      duplicate of its own waiting upload (so 3 proves the adoption).
--   Sabotage by hand (checked 2026-11-04): the category-inheritance trigger on imaging_reports dropped -> FAIL 2; the category
--   guard on imaging_report_documents dropped -> FAIL 4; the lab-store condition on the CDE-08 notice removed -> FAIL 1.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde5_ecg_imaging_through_intake.sql

begin;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_study uuid;
  v_pat uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_ecg uuid;
  v_img uuid;
  v_doc uuid;
  v_doc2 uuid;
  v_order uuid;
  v_staff uuid;
  v_report uuid;
  v_cd public.clinical_documents;
  v_out text;
  v_n integer;
  v_err text;
  v_def text;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  if v_admin is null then raise exception 'SETUP: seed admin missing'; end if;
  -- No imaging catalogue is seeded: a provider and one study as fixtures.
  insert into public.imaging_providers (name) values ('CDE5 Imaging') returning id into v_study;
  insert into public.imaging_studies (provider_id, modality, code, name)
  values (v_study, 'ultrasound', 'CDE5-US', 'Pelvic ultrasound')
  returning id into v_study;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'cde5-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde5-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', is_test = true where id = v_pat;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE5 Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'CDE5 Doctor', 'MDCN', 'CDE5-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin, true)
  returning id into v_staff;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  insert into storage.objects (bucket_id, name, owner_id) values
    ('lab-result-documents', v_pat::text || '/cde5-scan.pdf', v_pat::text),
    ('lab-result-documents', v_pat::text || '/cde5-ecg.pdf', v_pat::text),
    ('imaging-reports', v_pat::text || '/cde5-scan-copy.pdf', null),
    ('ecg-reports', v_pat::text || '/cde5-ecg-copy.pdf', null),
    ('ecg-reports', v_admin::text || '/elsewhere.pdf', null);

  -- 1. a patient's own ECG upload
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.ecg_report_documents (organisation_id, patient_id, file_path, mime_type, source, content_sha256)
  values (v_org, v_pat, v_pat::text || '/direct.pdf', 'application/pdf', 'patient', repeat('1', 64))
  returning id into v_ecg;
  select count(*) into v_n from public.clinical_documents where routed_table = 'ecg_report_documents' and routed_id = v_ecg;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 1: the patient cannot see the intake record of their own ECG'; end if;
  select * into v_cd from public.clinical_documents where routed_table = 'ecg_report_documents' and routed_id = v_ecg;
  if v_cd.kind_code <> 'cardiology.ecg' or v_cd.upload_channel <> 'patient_app' or v_cd.status <> 'doctor_review_required'
     or not v_cd.visible_to_patient or v_cd.content_sha256 <> repeat('1', 64) or v_cd.access_category <> 'labs_results' then
    raise exception 'FAIL 1: the ECG intake record is wrong: %', to_jsonb(v_cd);
  end if;
  begin
    set local role authenticated;
    insert into public.imaging_report_documents (organisation_id, patient_id, file_path, mime_type, source, content_sha256)
    values (v_org, v_pat, v_pat::text || '/again.pdf', 'application/pdf', 'patient', repeat('1', 64));
    reset role;
    raise exception 'FAIL 1: the same file was accepted again as an imaging upload';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'clinical_document_duplicate' then raise exception 'FAIL 1: duplicate refused for the wrong reason: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  update public.ecg_report_documents set reviewed_at = now(), review_note = 'Sinus rhythm' where id = v_ecg;
  if (select status from public.clinical_documents where routed_table = 'ecg_report_documents' and routed_id = v_ecg) <> 'reviewed' then
    raise exception 'FAIL 1: a reviewed ECG did not move its intake record to reviewed';
  end if;
  -- a clinician's own ECG upload: no lab notice (the ECG handler tells the patient)
  insert into public.ecg_report_documents (organisation_id, patient_id, file_path, mime_type, source, content_sha256)
  values (v_org, v_pat, v_pat::text || '/team.pdf', 'application/pdf', 'clinician', repeat('2', 64));
  perform set_config('request.jwt.claims', null, true);
  if exists (select 1 from public.notifications where recipient_id = v_pat and template = 'lab_report_received') then
    raise exception 'FAIL 1: an ECG upload sent the lab report notice';
  end if;

  -- 2. a "Not sure" upload sorted as an obstetric ultrasound
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_doc := public.submit_unsorted_document(v_pat::text || '/cde5-scan.pdf', 'scan.pdf', 'application/pdf', 1000, repeat('3', 64), null);
  v_doc2 := public.submit_unsorted_document(v_pat::text || '/cde5-ecg.pdf', 'trace.pdf', 'application/pdf', 1000, repeat('4', 64), null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  v_out := public.record_document_classification(v_doc, 'imaging.ultrasound.obstetric', 0.95, 'ai', 'AI-024:test', true, null);
  select * into v_cd from public.clinical_documents where id = v_doc;
  if v_out <> 'imaging' or v_cd.status <> 'processing' or v_cd.routed_table is not null or v_cd.access_category <> 'reproductive_health' then
    raise exception 'FAIL 2: a sorted scan is not waiting for its reader: %', to_jsonb(v_cd);
  end if;
  v_img := public.route_clinical_document(v_doc, v_pat::text || '/cde5-scan-copy.pdf');
  select * into v_cd from public.clinical_documents where id = v_doc;
  if v_cd.routed_table <> 'imaging_report_documents' or v_cd.routed_id <> v_img or v_cd.status <> 'doctor_review_required'
     or v_cd.access_category <> 'reproductive_health' or v_cd.kind_code <> 'imaging.ultrasound.obstetric'
     or (select count(*) from public.clinical_documents where patient_id = v_pat and content_sha256 = repeat('3', 64)) <> 1 then
    raise exception 'FAIL 2: the scan was not routed onto the same intake record: %', to_jsonb(v_cd);
  end if;
  if (select access_category from public.imaging_report_documents where id = v_img) <> 'reproductive_health'
     or (select clinician_alert_id from public.imaging_report_documents where id = v_img) is null
     or (select source::text from public.imaging_report_documents where id = v_img) <> 'patient' then
    raise exception 'FAIL 2: the imaging document lost its category, its alert or its source';
  end if;
  set local session_replication_role = replica; -- an order needs a catalogue study and its own prerequisites; a fixture only
  insert into public.imaging_orders (organisation_id, patient_id, ordering_clinician_id, study_id, indication)
  values (v_org, v_pat, v_staff, v_study, 'CDE5 fixture') returning id into v_order;
  set local session_replication_role = origin;
  insert into public.imaging_reports (organisation_id, patient_id, imaging_order_id, modality, body_region, study_date, findings,
      impression, report_status, is_abnormal, urgency, ai_assisted, document_id, source)
  values (v_org, v_pat, v_order, 'ultrasound', 'pelvis', current_date, 'Single live intrauterine pregnancy.', 'Normal.',
      'final', false, 'routine', false, v_img, 'clinician')
  returning id into v_report;
  if (select access_category from public.imaging_reports where id = v_report) <> 'reproductive_health' then
    raise exception 'FAIL 2: a report filed from a reproductive_health scan did not inherit the category';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.imaging_report_documents set access_category = 'labs_results' where id = v_img;
    reset role;
    raise exception 'FAIL 4: a session moved an imaging record''s category';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- 3. a "Not sure" upload sorted as an ECG
  v_out := public.record_document_classification(v_doc2, 'cardiology.ecg', 0.95, 'ai', 'AI-024:test', true, null);
  -- 4. refusals before routing it
  foreach v_out in array array['wrong_bucket', 'other_folder'] loop
    begin
      perform public.route_clinical_document(v_doc2,
        case v_out when 'wrong_bucket' then v_pat::text || '/cde5-scan-copy.pdf' else v_admin::text || '/elsewhere.pdf' end);
      raise exception 'FAIL 4: routing accepted a bad file (%)', v_out;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      if sqlerrm <> 'clinical_document_file_missing' then raise exception 'FAIL 4: % refused for the wrong reason: %', v_out, sqlerrm; end if;
    end;
  end loop;
  begin
    perform public.route_clinical_document(v_doc, v_pat::text || '/cde5-scan-copy.pdf');
    raise exception 'FAIL 4: a routed document was routed again';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if has_function_privilege('authenticated', 'public.route_clinical_document(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL 4: a client can route a document';
  end if;
  v_ecg := public.route_clinical_document(v_doc2, v_pat::text || '/cde5-ecg-copy.pdf');
  select * into v_cd from public.clinical_documents where id = v_doc2;
  if v_cd.routed_table <> 'ecg_report_documents' or v_cd.routed_id <> v_ecg or v_cd.status <> 'doctor_review_required'
     or (select clinician_alert_id from public.ecg_report_documents where id = v_ecg) is null then
    raise exception 'FAIL 3: the sorted ECG was not routed into the ECG store: %', to_jsonb(v_cd);
  end if;

  -- 5. SABOTAGE: without the ECG adoption branch, routing a sorted ECG is refused as a duplicate of its own waiting upload
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_doc := public.submit_unsorted_document(v_pat::text || '/cde5-ecg.pdf', 'trace2.pdf', 'application/pdf', 1000, repeat('5', 64), null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform public.record_document_classification(v_doc, 'cardiology.ecg', 0.95, 'ai', 'AI-024:test', true, null);
  select pg_get_functiondef('private.cde_open_intake(uuid, uuid, text, uuid, text, text, text, uuid)'::regprocedure) into v_def;
  if position('or (k.pipeline = ''ecg'' and p_routed_table = ''ecg_report_documents'')' in v_def) = 0 then
    raise exception 'SETUP: the ECG adoption branch text was not found';
  end if;
  execute replace(v_def, 'or (k.pipeline = ''ecg'' and p_routed_table = ''ecg_report_documents'')', '');
  v_err := null;
  begin
    perform public.route_clinical_document(v_doc, v_pat::text || '/cde5-ecg-copy.pdf');
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is distinct from 'clinical_document_duplicate' then
    raise exception 'FAIL 5 (sabotage): without the ECG adoption the routing was not refused as a duplicate (%)', v_err;
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
