-- Proof: clinical document engine, step 6 (migration *_cde8_record_items_and_worklist.sql). One read model for every uploaded
-- document, and the shared queue for uploads waiting for a doctor. Design: docs/plans/clinical-document-engine-2026-11-04.md §19.
--
--   1. A patient sees their own documents of every kind through clinical_record_items (a lab upload, an ECG, a sorted letter, an
--      unsorted upload), each with the bucket and path of its file. Another patient sees none of them; anon cannot read the view.
--   2. A care-team lab upload not yet reviewed is hidden from the patient here exactly as in its own table.
--   3. important_finding: the tied clinician sees true for a document whose review alert is urgent; the patient sees false for the
--      same document (it never reveals a finding before a doctor has dealt with it).
--   4. clinical_worklist lists an ECG and a kept letter waiting for a doctor under 'uploaded_documents', and does not list a lab
--      document there (it is in 'lab_results') or a reviewed one.
--   5. SABOTAGE (automatic): with security_invoker switched off, another patient reads the first patient's documents through the
--      view (so 1 proves the setting).
--   Sabotage by hand (checked 2026-11-04): the staff-only condition removed from important_finding -> FAIL 1/3 (the patient saw
--   the urgent flag); the lab exclusion removed from the 'uploaded_documents' queue -> FAIL 4.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde7_record_items_and_worklist.sql

begin;

do $$
declare
  v_org uuid;
  v_prog uuid;
  v_admin uuid;
  v_pat uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_lab uuid;
  v_team uuid;
  v_ecg uuid;
  v_letter uuid;
  v_unsorted uuid;
  v_alert uuid;
  v_n integer;
  v_rows jsonb;
  v_flag boolean;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_prog from public.chronic_condition_programmes limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  if v_admin is null or v_prog is null then raise exception 'SETUP: seed admin or programme missing'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'cde7-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_other, 'cde7-other@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde7-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'CDE7 Patient', is_test = true where id in (v_pat, v_other);
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE7 Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'CDE7 Doctor', 'MDCN', 'CDE7-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;
  set local session_replication_role = replica; -- the programme activation trigger needs a signed protocol; a fixture only
  insert into public.programme_purchases (organisation_id, patient_id, programme_id, status, price_kobo, duration_weeks, starts_at, ends_at, purchased_at)
  values (v_org, v_pat, v_prog, 'active', 100, 12, current_date - 10, current_date + 40, now() - interval '10 days');
  set local session_replication_role = origin;
  insert into storage.objects (bucket_id, name, owner_id) values
    ('lab-result-documents', v_pat::text || '/cde7-letter.pdf', v_pat::text),
    ('lab-result-documents', v_pat::text || '/cde7-unsorted.pdf', v_pat::text);

  -- the patient's own uploads of several kinds
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, mime_type, source, content_sha256)
  values (v_org, v_pat, v_pat::text || '/cde7-lab.pdf', 'application/pdf', 'patient', repeat('a', 64)) returning id into v_lab;
  insert into public.ecg_report_documents (organisation_id, patient_id, file_path, mime_type, source, content_sha256)
  values (v_org, v_pat, v_pat::text || '/cde7-ecg.pdf', 'application/pdf', 'patient', repeat('b', 64)) returning id into v_ecg;
  v_letter := public.submit_unsorted_document(v_pat::text || '/cde7-letter.pdf', 'letter.pdf', 'application/pdf', 100, repeat('c', 64), null);
  v_unsorted := public.submit_unsorted_document(v_pat::text || '/cde7-unsorted.pdf', 'scan.pdf', 'application/pdf', 100, repeat('d', 64), null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform public.record_document_classification(v_letter, 'reports.discharge', 0.95, 'ai', 'AI-024:test', true, null);
  -- a care-team lab upload, not yet reviewed
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, mime_type, source, uploaded_by, content_sha256)
  values (v_org, v_pat, v_pat::text || '/cde7-team.pdf', 'application/pdf', 'clinician', v_doctor, repeat('e', 64)) returning id into v_team;
  -- the ECG's review alert is raised to urgent by a doctor
  select clinician_alert_id into v_alert from public.ecg_report_documents where id = v_ecg;
  update public.clinician_alerts set level = 'urgent_escalation' where id = v_alert;

  -- 1, 2, 3: the patient's view
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select jsonb_agg(jsonb_build_object('pipeline', pipeline, 'routed_table', routed_table, 'bucket', file_bucket, 'path', file_path,
                                      'important', important_finding) order by uploaded_at)
    into v_rows from public.clinical_record_items where patient_id = v_pat;
  reset role;
  if jsonb_array_length(coalesce(v_rows, '[]')) <> 4 then
    raise exception 'FAIL 1/2: the patient sees % documents, expected their own 4 (and not the unreviewed care-team upload): %',
      jsonb_array_length(coalesce(v_rows, '[]')), v_rows;
  end if;
  if not (v_rows @> jsonb_build_array(
        jsonb_build_object('pipeline', 'lab', 'bucket', 'lab-result-documents', 'path', v_pat::text || '/cde7-lab.pdf'),
        jsonb_build_object('pipeline', 'ecg', 'bucket', 'ecg-reports', 'path', v_pat::text || '/cde7-ecg.pdf', 'important', false),
        jsonb_build_object('pipeline', 'narrative', 'bucket', 'lab-result-documents', 'path', v_pat::text || '/cde7-letter.pdf'),
        jsonb_build_object('pipeline', 'unsorted', 'path', v_pat::text || '/cde7-unsorted.pdf'))) then
    raise exception 'FAIL 1/3: the patient''s rows are wrong (file, bucket, or an urgent flag shown to the patient): %', v_rows;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_record_items where patient_id = v_pat;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 1: another patient sees % of the documents', v_n; end if;
  if has_table_privilege('anon', 'public.clinical_record_items', 'SELECT') then raise exception 'FAIL 1: anon can read the view'; end if;

  -- 3: the tied clinician sees the urgent flag
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select important_finding into v_flag from public.clinical_record_items where routed_table = 'ecg_report_documents' and routed_id = v_ecg;
  -- 4: the shared queue
  select jsonb_agg(jsonb_build_object('kind', kind, 'item', item_id)) into v_rows from public.clinical_worklist() where patient_id = v_pat;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_flag is distinct from true then raise exception 'FAIL 3: the tied clinician does not see the urgent flag (%)', v_flag; end if;
  if not (v_rows @> jsonb_build_array(
        jsonb_build_object('kind', 'uploaded_documents', 'item', (select id from public.clinical_documents where routed_table = 'ecg_report_documents' and routed_id = v_ecg)),
        jsonb_build_object('kind', 'uploaded_documents', 'item', v_letter))) then
    raise exception 'FAIL 4: the ECG or the kept letter is not in the uploaded-documents queue: %', v_rows;
  end if;
  if exists (select 1 from jsonb_array_elements(v_rows) e
              where e ->> 'kind' = 'uploaded_documents'
                and (e ->> 'item')::uuid in (select id from public.clinical_documents where routed_table = 'lab_result_documents')) then
    raise exception 'FAIL 4: a lab document is counted in the uploaded-documents queue as well';
  end if;
  update public.ecg_report_documents set reviewed_at = now() where id = v_ecg;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_worklist()
   where kind = 'uploaded_documents' and item_id = (select id from public.clinical_documents where routed_table = 'ecg_report_documents' and routed_id = v_ecg);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 4: a reviewed ECG is still in the queue'; end if;

  -- 5. SABOTAGE: without security_invoker the view runs as its owner and another patient reads everything
  alter view public.clinical_record_items set (security_invoker = false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_record_items where patient_id = v_pat;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n = 0 then raise exception 'FAIL 5 (sabotage): the view stayed closed without security_invoker, so 1 does not prove it'; end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
