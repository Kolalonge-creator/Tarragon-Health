-- Proof: clinical document engine, step 4 (migration *_cde5_document_classifier.sql). "I'm not sure what this is" uploads and
-- the document classifier (AI-024). Design: docs/plans/clinical-document-engine-2026-11-04.md §7, §8, §16.
--
--   1. A patient uploads a document without a type: an intake row with no kind and no routing, 'classifying', under the most
--      protective access category, visible to that patient only. Refused: a file outside the patient's own folder, a file not in
--      storage, a file in their folder that someone else stored (a held care-team upload), the same file twice, a care coordinator
--      using the patient route.
--   2. An unsure classification (below the threshold, the app passes apply = false) asks the patient: 'needs_type_confirmation',
--      the suggestion kept, nothing routed, one classify job recorded and NOT counted as a reader attempt.
--   3. A failed classification never routes, even if the caller passes a kind with apply = true: the patient is asked.
--   4. The patient answers "lab result": a lab_result_documents row for the same stored file (source patient), and the SAME
--      intake row becomes the routed one (adopted; no second intake row, no duplicate refusal). A routed document cannot be
--      re-answered; a grouping node with no pipeline is refused; another patient cannot answer.
--   5. A confident classification of a non-lab kind (ECG) is applied: for a patient with no plan the document is kept and says it
--      is not reviewed (no alert); for a patient with an active programme a clinician review alert opens at once. The access
--      category becomes the kind's.
--   6. AI-024 is registered disabled with no evaluation run; the classifier record is service-role only.
--   6b. Once sorted the answer is final (the patient cannot re-answer a kept ECG). A tied clinician records the review of the kept
--      ECG (status reviewed, note, audited); the patient cannot; a routed document cannot be reviewed here; a note is required.
--   6c. The ops exception queue lists a question left unanswered for 3 days, and not a fresh one.
--   7. SABOTAGE (automatic): with the adoption branch removed from private.cde_open_intake, answering "lab result" is refused as a
--      duplicate of the waiting upload (so 4 proves the adoption).
--   Sabotage by hand (checked 2026-11-04): the p_error guard removed from record_document_classification -> FAIL 3; the
--   step = 'extract' filter removed from cde_refresh -> FAIL 4 (the classify job counted as a reader attempt once routed).
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde4_document_classifier.sql

begin;

do $$
declare
  v_org uuid;
  v_prog uuid;
  v_pat uuid := gen_random_uuid();
  v_paid uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_admin uuid;
  v_q jsonb;
  v_doc uuid;
  v_doc2 uuid;
  v_doc3 uuid;
  v_doc4 uuid;
  v_cd public.clinical_documents;
  v_lab public.lab_result_documents;
  v_out text;
  v_n integer;
  v_err text;
  v_def text;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_prog from public.chronic_condition_programmes limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  if v_org is null or v_prog is null or v_admin is null then raise exception 'SETUP: seed organisation, programme or admin missing'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'cde4-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_paid, 'cde4-paid@example.invalid', 'x', now(), '{}', '{}'),
         (v_other, 'cde4-other@example.invalid', 'x', now(), '{}', '{}'),
         (v_coord, 'cde4-coord@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde4-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', is_test = true where id in (v_pat, v_paid, v_other);
  update public.profiles set organisation_id = v_org, role = 'care_coordinator', is_test = true where id = v_coord;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE4 Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'CDE4 Doctor', 'MDCN', 'CDE4-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_paid, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;
  set local session_replication_role = replica; -- the programme activation trigger needs a signed protocol; a fixture only
  insert into public.programme_purchases (organisation_id, patient_id, programme_id, status, price_kobo, duration_weeks, starts_at, ends_at, purchased_at)
  values (v_org, v_paid, v_prog, 'active', 100, 12, current_date - 10, current_date + 40, now() - interval '10 days');
  set local session_replication_role = origin;

  insert into storage.objects (bucket_id, name, owner_id) values
    ('lab-result-documents', v_pat::text || '/cde4-a.pdf', v_pat::text),
    ('lab-result-documents', v_pat::text || '/cde4-b.jpg', v_pat::text),
    ('lab-result-documents', v_pat::text || '/cde4-c.pdf', v_pat::text),
    ('lab-result-documents', v_paid::text || '/cde4-d.pdf', v_paid::text),
    ('lab-result-documents', v_other::text || '/cde4-x.pdf', v_other::text),
    -- a care-team upload in the patient's folder, stored by the server (no owner): held until a clinician reviews it
    ('lab-result-documents', v_pat::text || '/cde4-team.pdf', null);

  -- 1. upload without a type
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_doc := public.submit_unsorted_document(v_pat::text || '/cde4-a.pdf', 'scan.pdf', 'application/pdf', 1000, repeat('a', 64), 'From the hospital');
  v_doc2 := public.submit_unsorted_document(v_pat::text || '/cde4-b.jpg', 'IMG_2041.jpg', 'image/jpeg', 2000, repeat('b', 64), null);
  v_doc3 := public.submit_unsorted_document(v_pat::text || '/cde4-c.pdf', 'letter.pdf', 'application/pdf', 3000, repeat('c', 64), null);
  select count(*) into v_n from public.clinical_documents where id in (v_doc, v_doc2, v_doc3);
  reset role;
  if v_n <> 3 then raise exception 'FAIL 1: the patient cannot see their own unsorted uploads (% of 3)', v_n; end if;
  select * into v_cd from public.clinical_documents where id = v_doc;
  if v_cd.kind_code is not null or v_cd.kind_source is not null or v_cd.routed_table is not null or v_cd.status <> 'classifying'
     or v_cd.access_category <> 'reproductive_health' or not v_cd.visible_to_patient or v_cd.upload_channel <> 'patient_app'
     or v_cd.file_path <> v_pat::text || '/cde4-a.pdf' or v_cd.patient_note <> 'From the hospital' then
    raise exception 'FAIL 1: the unsorted intake row is wrong: %', to_jsonb(v_cd);
  end if;
  -- refusals
  foreach v_out in array array['other_folder', 'missing', 'not_owned', 'duplicate'] loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.submit_unsorted_document(
        case v_out when 'other_folder' then v_other::text || '/cde4-x.pdf' when 'missing' then v_pat::text || '/nope.pdf'
                   when 'not_owned' then v_pat::text || '/cde4-team.pdf' else v_pat::text || '/cde4-a.pdf' end,
        'f.pdf', 'application/pdf', 10, case v_out when 'duplicate' then repeat('a', 64) else repeat('e', 64) end, null);
      reset role;
      raise exception 'FAIL 1: an upload was accepted (%)', v_out;
    exception when others then
      reset role;
      if sqlerrm like 'FAIL%' then raise; end if;
      if (v_out = 'duplicate' and sqlerrm <> 'clinical_document_duplicate')
         or (v_out <> 'duplicate' and sqlerrm <> 'clinical_document_file_missing') then
        raise exception 'FAIL 1: % refused for the wrong reason: %', v_out, sqlerrm;
      end if;
    end;
  end loop;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.submit_unsorted_document(v_coord::text || '/x.pdf', 'x.pdf', 'application/pdf', 10, repeat('f', 64), null);
    reset role;
    raise exception 'FAIL 1: a care coordinator used the patient upload route';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_documents where id = v_doc;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 1: another patient can see the upload'; end if;
  perform set_config('request.jwt.claims', null, true);

  -- 2. unsure: ask the patient (server, as the classifier run would)
  v_out := public.record_document_classification(v_doc, 'imaging.ultrasound', 0.40, 'ai', 'AI-024:claude-sonnet-5', false, null);
  select * into v_cd from public.clinical_documents where id = v_doc;
  if v_out is not null or v_cd.status <> 'needs_type_confirmation' or v_cd.routed_table is not null or v_cd.kind_code is not null
     or v_cd.suggested_kind_code <> 'imaging.ultrasound' or v_cd.kind_confidence <> 0.40 or v_cd.extraction_attempts <> 0
     or (select count(*) from public.clinical_document_jobs where document_id = v_doc and step = 'classify') <> 1 then
    raise exception 'FAIL 2: an unsure classification did not simply ask the patient: %', to_jsonb(v_cd);
  end if;

  -- 3. a failure never routes, whatever the caller passes
  v_out := public.record_document_classification(v_doc2, 'lab.haematology', 0.99, 'ai', 'AI-024:claude-sonnet-5', true, 'timeout');
  select * into v_cd from public.clinical_documents where id = v_doc2;
  if v_out is not null or v_cd.status <> 'needs_type_confirmation' or v_cd.routed_table is not null or v_cd.kind_code is not null
     or not exists (select 1 from public.clinical_document_jobs where document_id = v_doc2 and step = 'classify' and outcome = 'failed') then
    raise exception 'FAIL 3: a failed classification moved the document: %', to_jsonb(v_cd);
  end if;

  -- 4. the patient answers "lab result": routed into the lab path, same intake row
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.confirm_clinical_document_kind(v_doc, 'lab.haematology');
    reset role;
    raise exception 'FAIL 4: another patient answered the question';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.confirm_clinical_document_kind(v_doc, 'cardiology');
    reset role;
    raise exception 'FAIL 4: a grouping node with no pipeline was accepted';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'clinical_document_kind_not_specific' then raise exception 'FAIL 4: wrong refusal for a grouping node: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.confirm_clinical_document_kind(v_doc, 'lab.haematology');
  reset role;
  select * into v_cd from public.clinical_documents where id = v_doc;
  select * into v_lab from public.lab_result_documents where id = v_cd.routed_id;
  if v_out <> 'lab' or v_cd.routed_table <> 'lab_result_documents' or v_lab.id is null or v_lab.file_path <> v_pat::text || '/cde4-a.pdf'
     or v_lab.source::text <> 'patient' or v_lab.uploaded_by <> v_pat or v_lab.content_sha256 <> repeat('a', 64)
     or v_cd.kind_code <> 'lab.haematology' or v_cd.kind_source <> 'confirmed' or v_cd.kind_confirmed_by <> v_pat
     or v_cd.access_category <> 'labs_results' or v_cd.status <> 'processing' or not v_cd.visible_to_patient
     -- the classify job from 2 is not a reader attempt (cde_refresh counts 'extract' jobs only)
     or v_cd.extraction_attempts <> 0 or v_cd.failed_attempts <> 0 then
    raise exception 'FAIL 4: the answer did not route the document into the lab path: % / %', to_jsonb(v_cd), to_jsonb(v_lab);
  end if;
  if (select count(*) from public.clinical_documents where patient_id = v_pat and content_sha256 = repeat('a', 64)) <> 1 then
    raise exception 'FAIL 4: a second intake row was opened instead of adopting the waiting one';
  end if;
  if not exists (select 1 from public.audit_log where entity_id = v_doc and action = 'clinical_document.kind_confirmed') then
    raise exception 'FAIL 4: the answer was not audited';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.confirm_clinical_document_kind(v_doc, 'reports.other');
    reset role;
    raise exception 'FAIL 4: a routed document was re-answered';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- 5. a confident non-lab classification: kept (no plan) or reviewed (active programme)
  v_out := public.record_document_classification(v_doc3, 'cardiology.ecg', 0.95, 'ai', 'AI-024:claude-sonnet-5', true, null);
  select * into v_cd from public.clinical_documents where id = v_doc3;
  if v_out <> 'ecg' or v_cd.kind_code <> 'cardiology.ecg' or v_cd.kind_source <> 'ai' or v_cd.routed_table is not null
     or v_cd.status <> 'uploaded' or v_cd.clinician_alert_id is not null or v_cd.access_category <> 'labs_results'
     or v_cd.status_reason not like 'Kept on your record%' then
    raise exception 'FAIL 5: a non-lab document for a patient with no plan is wrong: %', to_jsonb(v_cd);
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_paid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_doc4 := public.submit_unsorted_document(v_paid::text || '/cde4-d.pdf', 'ecg.pdf', 'application/pdf', 1000, repeat('d', 64), null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  v_out := public.record_document_classification(v_doc4, 'cardiology.ecg', 0.95, 'ai', 'AI-024:claude-sonnet-5', true, null);
  select * into v_cd from public.clinical_documents where id = v_doc4;
  if v_cd.status <> 'doctor_review_required' or v_cd.clinician_alert_id is null
     or (select status from public.clinician_alerts where id = v_cd.clinician_alert_id) <> 'open' then
    raise exception 'FAIL 5: a non-lab document for a patient with a programme opened no review: %', to_jsonb(v_cd);
  end if;

  -- 6. registration and grants
  if (select is_enabled from public.ai_systems where system_code = 'AI-024') or
     exists (select 1 from public.ai_evaluation_runs r join public.ai_systems s on s.id = r.ai_system_id where s.system_code = 'AI-024') then
    raise exception 'FAIL 6: AI-024 is enabled or has a seeded evaluation run';
  end if;
  if has_function_privilege('authenticated', 'public.record_document_classification(uuid, text, numeric, text, text, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.submit_unsorted_document(text, text, text, bigint, text, text)', 'EXECUTE') then
    raise exception 'FAIL 6: step 4 function grants are wrong';
  end if;

  -- 6b. the answer is final once sorted; a tied clinician records the review of the kept ECG
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.confirm_clinical_document_kind(v_doc3, 'reports.other');
    reset role;
    raise exception 'FAIL 6b: a sorted document was re-answered';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_paid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.review_clinical_document(v_doc4, 'I am the patient');
    reset role;
    raise exception 'FAIL 6b: a patient recorded a review';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.clinical_documents where id = v_doc4;
  if v_n <> 1 then reset role; raise exception 'FAIL 6b: the tied clinician cannot see the kept document'; end if;
  begin
    perform public.review_clinical_document(v_doc4, '   ');
    reset role;
    raise exception 'FAIL 6b: a review without a note was accepted';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.review_clinical_document(v_doc4, 'Sinus rhythm, no concern.');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  select * into v_cd from public.clinical_documents where id = v_doc4;
  if v_cd.status <> 'reviewed' or v_cd.reviewed_by <> v_doctor or v_cd.review_note <> 'Sinus rhythm, no concern.'
     or not exists (select 1 from public.audit_log where entity_id = v_doc4 and action = 'clinical_document.reviewed') then
    raise exception 'FAIL 6b: the review was not recorded: %', to_jsonb(v_cd);
  end if;
  -- a document routed into the lab path is reviewed there, not here: the doctor is tied to the patient for this check
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.review_clinical_document(v_doc, 'x');
    reset role;
    raise exception 'FAIL 6b: a routed document was reviewed here';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm <> 'clinical_document_not_reviewable_here' then raise exception 'FAIL 6b: wrong refusal for a routed document: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- 6c. an unanswered question older than 3 days is on the ops exception queue; a fresh one is not
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_q := public.ops_exception_queue('documents', 200);
  reset role;
  if exists (select 1 from jsonb_array_elements(v_q) e where (e ->> 'entity_id')::uuid = v_doc2) then
    raise exception 'FAIL 6c: a fresh question is already on the ops queue';
  end if;
  update public.clinical_documents set status_changed_at = now() - interval '4 days' where id = v_doc2;
  set local role authenticated;
  v_q := public.ops_exception_queue('documents', 200);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if not exists (select 1 from jsonb_array_elements(v_q) e where (e ->> 'entity_id')::uuid = v_doc2 and e ->> 'domain' = 'documents') then
    raise exception 'FAIL 6c: an unanswered question is not on the ops exception queue';
  end if;

  -- 7. SABOTAGE: without the adoption branch, the answer is refused as a duplicate of the waiting upload
  v_doc := v_doc2; -- still waiting for its type
  select pg_get_functiondef('private.cde_open_intake(uuid, uuid, text, uuid, text, text, text, uuid)'::regprocedure) into v_def;
  if position('and cd.routed_table is null and k.pipeline = ''lab''' in v_def) = 0 then
    raise exception 'SETUP: the adoption branch text was not found';
  end if;
  execute replace(v_def, 'and cd.routed_table is null and k.pipeline = ''lab''', 'and false and cd.routed_table is null');
  v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.confirm_clinical_document_kind(v_doc, 'lab.biochemistry');
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_err is distinct from 'clinical_document_duplicate' then
    raise exception 'FAIL 7 (sabotage): without adoption the answer was not refused as a duplicate (%), so 4 does not prove it', v_err;
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
