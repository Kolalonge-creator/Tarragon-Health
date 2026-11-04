-- Proof: clinical document engine, step 5b (migration *_cde7_pathology_cervical_mammography.sql). A doctor files a pathology or
-- cervical screening result AS PRINTED from a kept document; mammography fields as printed on a filed imaging report.
-- Design: docs/plans/clinical-document-engine-2026-11-04.md §18.
--
--   1. A tied clinician files a cervical cytology result from a document sorted as cervical screening: the record carries
--      reproductive_health, the fields as printed (empty strings dropped), and the document is reviewed with the doctor's note.
--      Filing it again is refused.
--   2. Refused: a kind that does not match the document (histopathology from a cervical document), a result without its result
--      field (a histopathology report with no diagnosis line), no note, a patient filing, a document of another pipeline.
--   3. The patient cannot read the structured record; the tied clinician can.
--   4. Mammography: BI-RADS and density as printed are kept on a breast study; a value outside the printed scale, or BI-RADS on a
--      chest X-ray, is refused.
--   5. SABOTAGE (automatic): with the field-per-kind check removed, a histopathology record with no diagnosis line is accepted (so
--      2 proves the check).
--   Sabotage by hand (checked 2026-11-04): the kind-matches-document check removed from file_pathology_report -> FAIL 2; the
--   record given labs_results instead of the document's category -> FAIL 1.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde6_pathology_cervical_mammography.sql

begin;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_pat uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_staff uuid;
  v_cerv uuid;
  v_hist uuid;
  v_ecg uuid;
  v_rep uuid;
  v_order uuid;
  v_study uuid;
  v_r public.pathology_reports;
  v_n integer;
  v_err text;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  if v_admin is null then raise exception 'SETUP: seed admin missing'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'cde6-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde6-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', sex = 'female', is_test = true where id = v_pat;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE6 Doctor', is_test = true where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doctor, 'CDE6 Doctor', 'MDCN', 'CDE6-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin, true)
  returning id into v_staff;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;
  insert into storage.objects (bucket_id, name, owner_id) values
    ('lab-result-documents', v_pat::text || '/cde6-cerv.pdf', v_pat::text),
    ('lab-result-documents', v_pat::text || '/cde6-hist.pdf', v_pat::text),
    ('lab-result-documents', v_pat::text || '/cde6-letter.pdf', v_pat::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_cerv := public.submit_unsorted_document(v_pat::text || '/cde6-cerv.pdf', 'smear.pdf', 'application/pdf', 1000, repeat('6', 64), null);
  v_hist := public.submit_unsorted_document(v_pat::text || '/cde6-hist.pdf', 'biopsy.pdf', 'application/pdf', 1000, repeat('7', 64), null);
  v_ecg := public.submit_unsorted_document(v_pat::text || '/cde6-letter.pdf', 'letter.pdf', 'application/pdf', 1000, repeat('8', 64), null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform public.record_document_classification(v_cerv, 'screening.cervical', 0.95, 'ai', 'AI-024:test', true, null);
  perform public.record_document_classification(v_hist, 'lab.histopathology', 0.95, 'ai', 'AI-024:test', true, null);
  perform public.record_document_classification(v_ecg, 'reports.discharge', 0.95, 'ai', 'AI-024:test', true, null);

  -- 2. refusals (as the tied clinician unless said otherwise)
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  foreach v_err in array array['kind_mismatch', 'no_diagnosis', 'no_note', 'other_pipeline'] loop
    begin
      set local role authenticated;
      perform public.file_pathology_report(
        case v_err when 'other_pipeline' then v_ecg when 'no_diagnosis' then v_hist else v_cerv end,
        case v_err when 'kind_mismatch' then '{"report_kind":"histopathology","diagnosis_as_printed":"x"}'::jsonb
                   when 'no_diagnosis' then '{"report_kind":"histopathology","diagnosis_as_printed":"  ","specimen":"Skin"}'::jsonb
                   when 'other_pipeline' then '{"report_kind":"histopathology","diagnosis_as_printed":"x"}'::jsonb
                   else '{"report_kind":"cervical_cytology","cytology_category_as_printed":"NILM"}'::jsonb end,
        case v_err when 'no_note' then ' ' else 'Filed' end);
      reset role;
      raise exception 'FAIL 2: a filing was accepted (%)', v_err;
    exception when others then
      reset role;
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.file_pathology_report(v_cerv, '{"report_kind":"cervical_cytology","cytology_category_as_printed":"NILM"}', 'Mine');
    reset role;
    raise exception 'FAIL 2: a patient filed a pathology record';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 1. the tied clinician files the cervical result
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_rep := public.file_pathology_report(v_cerv,
    '{"report_kind":"cervical_cytology","cytology_category_as_printed":"High-grade squamous intraepithelial lesion (HSIL)",
      "hpv_genotypes_as_printed":"","recommendation_as_printed":"Refer for colposcopy","laboratory_name":"Synlab Ikeja","reported_on":"2026-11-01"}',
    'HSIL as printed. Urgent colposcopy referral made; patient called.');
  select count(*) into v_n from public.pathology_reports where id = v_rep;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 3: the tied clinician cannot read the record they filed'; end if;
  select * into v_r from public.pathology_reports where id = v_rep;
  if v_r.access_category <> 'reproductive_health' or v_r.report_kind <> 'cervical_cytology' or v_r.filed_by <> v_doctor
     or v_r.cytology_category_as_printed <> 'High-grade squamous intraepithelial lesion (HSIL)' or v_r.hpv_genotypes_as_printed is not null
     or v_r.recommendation_as_printed <> 'Refer for colposcopy' or v_r.reported_on <> date '2026-11-01' then
    raise exception 'FAIL 1: the filed record is wrong: %', to_jsonb(v_r);
  end if;
  if (select status from public.clinical_documents where id = v_cerv) <> 'reviewed'
     or (select reviewed_by from public.clinical_documents where id = v_cerv) <> v_doctor then
    raise exception 'FAIL 1: filing did not record the review of the document';
  end if;
  set local role authenticated;
  begin
    perform public.file_pathology_report(v_cerv, '{"report_kind":"hpv","hpv_result_as_printed":"positive"}', 'Again');
    reset role;
    raise exception 'FAIL 1: a reviewed document was filed again';
  exception when others then
    reset role;
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.pathology_reports where patient_id = v_pat;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n <> 0 then raise exception 'FAIL 3: the patient can read the structured pathology record'; end if;

  -- 4. mammography fields as printed
  insert into public.imaging_providers (name) values ('CDE6 Imaging') returning id into v_study;
  insert into public.imaging_studies (provider_id, modality, code, name) values (v_study, 'mammography', 'CDE6-MG', 'Mammogram')
  returning id into v_study;
  set local session_replication_role = replica; -- an order needs its own clinical prerequisites; a fixture only
  insert into public.imaging_orders (organisation_id, patient_id, ordering_clinician_id, study_id, indication)
  values (v_org, v_pat, v_staff, v_study, 'CDE6 fixture') returning id into v_order;
  set local session_replication_role = origin;
  insert into public.imaging_reports (organisation_id, patient_id, imaging_order_id, modality, body_region, study_date, findings,
      impression, report_status, is_abnormal, urgency, ai_assisted, source, breast_density_as_printed, birads_left_as_printed,
      birads_right_as_printed, birads_overall_as_printed)
  values (v_org, v_pat, v_order, 'mammography', 'both breasts', current_date, 'No suspicious mass.', 'BI-RADS 1.', 'final', false,
      'routine', false, 'clinician', 'B', '1', '4A', '4A')
  returning id into v_rep;
  if (select birads_right_as_printed from public.imaging_reports where id = v_rep) <> '4A' then
    raise exception 'FAIL 4: BI-RADS as printed was not kept';
  end if;
  foreach v_err in array array['bad_value', 'xray'] loop
    begin
      insert into public.imaging_reports (organisation_id, patient_id, imaging_order_id, modality, body_region, study_date, findings,
          impression, report_status, is_abnormal, urgency, ai_assisted, source, birads_overall_as_printed)
      values (v_org, v_pat, v_order, (case v_err when 'xray' then 'xray' else 'mammography' end)::public.imaging_modality, 'chest', current_date, 'x', 'x',
          'final', false, 'routine', false, 'clinician', case v_err when 'bad_value' then '7' else '2' end);
      raise exception 'FAIL 4: a BI-RADS value was accepted (%)', v_err;
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      if sqlstate <> '23514' then raise exception 'FAIL 4: % refused for the wrong reason: %', v_err, sqlerrm; end if;
    end;
  end loop;

  -- 5. SABOTAGE: without the field-per-kind check, a histopathology record with no diagnosis line is accepted
  alter table public.pathology_reports drop constraint pathology_reports_kind_fields;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_err := null;
  begin
    perform public.file_pathology_report(v_hist, '{"report_kind":"histopathology","specimen":"Skin"}', 'No diagnosis line');
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_err is not null then
    raise exception 'FAIL 5 (sabotage): the filing was refused without the check (%), so 2 does not prove it', v_err;
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
