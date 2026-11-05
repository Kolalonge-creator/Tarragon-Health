-- Proof: CDE-10 (migration *_cde10_apply_narrative_urgent_rules.sql). The CMO-signed narrative urgent-finding rules act on reports.
-- Decision CDE-09; design docs/plans/clinical-document-engine-2026-11-04.md §21.
--
--   1. Parity: every shared case in apps/web/src/lib/clinical-documents/narrative-rules.cases.json (the same list the Jest test runs
--      against narrative-rules.ts; a Jest test checks this copy is identical) gives the same matches from the database matcher.
--   2. Only the signed value acts: no sign-off -> nothing; a confirmation of exactly this value -> the rules act; a newer 'changes
--      requested', or a confirmation of a different fingerprint, -> nothing again.
--   3. ECG confirmed by a clinician with QTc 0.512 s (512 ms): the ECG's own review alert is RAISED to emergency (severity 4, SLA from
--      escalation_slas, not later than 720 minutes), the owner gets the values-free abnormal_result_clinician_alert, the finding is
--      recorded once (a second identical reading does not add another).
--   4. AI-016 impression: "No pneumothorax." raises nothing; "Large right pneumothorax." raises the document's review alert.
--   5. Never lower: a pathology carcinoma (urgent_escalation tier) on an alert already at emergency leaves it at emergency
--      ('already_at_or_above'). Never merged: a finding on another document does not touch an unrelated open alert. Never fights an
--      override: an AI finding on a document whose alert a clinician overrode opens a new alert and leaves the override (no session,
--      as the AI service writes).
--   6. Pathology filed for another patient opens a new urgent_escalation alert (24-hour SLA), category kept from the report. With
--      duplicate suppression switched on for abnormal_result (off live), a second finding for that patient is still not suppressed.
--   7. Access: anon and authenticated cannot execute the functions or read the rule sets; the patient cannot read the findings; the
--      tied doctor can.
--   8. SABOTAGE (automatic): with the fingerprint check removed from private.narrative_rules_in_force, a confirmation of a different
--      value makes the rules act (so 2 proves the check).
--   Sabotage by hand (checked 2026-11-05): raising the existing alert replaced by always inserting a new one -> FAIL 3 (the review alert
--   stays at routine review); the never-lower comparison loosened -> FAIL 5 (lowered); the negation check removed -> FAIL 1; the
--   unsuppress step removed -> FAIL 6.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cde10_apply_narrative_urgent_rules.sql

begin;

do $$
declare
  -- CASES-BEGIN
  v_cases jsonb := '[{"name":"BI-RADS 4A raises, 1 does not","fields":{"birads":["1","4A"]},"expected":[{"rule":"birads","matched":"4A"}]},{"name":"BI-RADS 0 raises","fields":{"birads":["0"]},"expected":[{"rule":"birads","matched":"0"}]},{"name":"BI-RADS 2 and 3 do not raise","fields":{"birads":["2","3",null]},"expected":[]},{"name":"HSIL raises","fields":{"cervicalCytology":"High-grade squamous intraepithelial lesion (HSIL)"},"expected":[{"rule":"cervical_cytology","matched":"HSIL"}]},{"name":"NILM does not raise","fields":{"cervicalCytology":"Negative for intraepithelial lesion or malignancy (NILM)"},"expected":[]},{"name":"HPV 18 raises","fields":{"hpvGenotypes":"HPV 18 detected"},"expected":[{"rule":"hpv_genotype","matched":"18"}]},{"name":"Other HPV types do not raise","fields":{"hpvGenotypes":"Other high-risk types (31, 33)"},"expected":[]},{"name":"Carcinoma in a diagnosis raises","fields":{"pathologyDiagnosis":"Invasive ductal carcinoma, grade 2"},"expected":[{"rule":"pathology","matched":"carcinoma"}]},{"name":"No evidence of malignancy does not raise","fields":{"pathologyDiagnosis":"Benign. No evidence of malignancy."},"expected":[]},{"name":"Negative for malignancy does not raise","fields":{"pathologyDiagnosis":"Negative for malignancy"},"expected":[]},{"name":"ST elevation raises","fields":{"ecgInterpretation":"Sinus rhythm. ST elevation in V1-V4."},"expected":[{"rule":"ecg","matched":"st elevation"}]},{"name":"QTc 499 and a normal ECG do not raise","fields":{"ecgInterpretation":"Sinus rhythm. Normal ECG.","ecgQtcMs":499},"expected":[]},{"name":"QTc 512 raises","fields":{"ecgQtcMs":512},"expected":[{"rule":"ecg_qtc","matched":"QTc 512 ms"}]},{"name":"QTc 500 exactly raises","fields":{"ecgQtcMs":500},"expected":[{"rule":"ecg_qtc","matched":"QTc 500 ms"}]},{"name":"Pneumothorax raises","fields":{"imagingImpression":"Large right pneumothorax."},"expected":[{"rule":"imaging","matched":"pneumothorax"}]},{"name":"No pneumothorax, no free air","fields":{"imagingImpression":"No pneumothorax. No free air."},"expected":[]},{"name":"Pulmonary embolism excluded","fields":{"imagingImpression":"Pulmonary embolism excluded."},"expected":[]},{"name":"A negation elsewhere does not hide carcinoma","fields":{"pathologyDiagnosis":"Lesion is not benign; carcinoma present"},"expected":[{"rule":"pathology","matched":"carcinoma"}]},{"name":"A long-range negation does not hide carcinoma","fields":{"pathologyDiagnosis":"No change since the previous biopsy, which showed carcinoma"},"expected":[{"rule":"pathology","matched":"carcinoma"}]},{"name":"Another clause''s negation does not hide pneumothorax","fields":{"imagingImpression":"No effusion. Right pneumothorax."},"expected":[{"rule":"imaging","matched":"pneumothorax"}]},{"name":"No change in the known carcinoma still raises","fields":{"pathologyDiagnosis":"No change in the known carcinoma"},"expected":[{"rule":"pathology","matched":"carcinoma"}]},{"name":"No residual carcinoma does not raise","fields":{"pathologyDiagnosis":"No residual carcinoma"},"expected":[]},{"name":"A term inside a longer word does not raise","fields":{"imagingImpression":"Hydropneumothoraxes not seen; carcinomatosis query"},"expected":[]},{"name":"Several rules at once, in rule order","fields":{"birads":["5"],"pathologyDiagnosis":"Metastatic adenocarcinoma","imagingImpression":"Suspicious for malignancy"},"expected":[{"rule":"birads","matched":"5"},{"rule":"pathology","matched":"adenocarcinoma"},{"rule":"imaging","matched":"suspicious for malignancy"}]}]'::jsonb;
  -- CASES-END
  v_rules jsonb;
  v_hash text;
  c jsonb;
  v_org uuid;
  v_admin uuid;
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_ecg uuid;
  v_img uuid;
  v_doc uuid;
  v_path uuid;
  v_alert uuid;
  v_a public.clinician_alerts;
  v_n integer;
  v_ok boolean;
begin
  select value, value_hash into v_rules, v_hash from public.narrative_urgent_rule_sets where version = 1;

  -- 1. parity
  for c in select * from jsonb_array_elements(v_cases) loop
    if private.match_narrative_rules(c->'fields', v_rules) <> c->'expected' then
      raise exception 'FAIL 1: case "%" gave %, expected %', c->>'name', private.match_narrative_rules(c->'fields', v_rules), c->'expected';
    end if;
  end loop;

  select id into v_org from public.organisations limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  if v_admin is null then raise exception 'SETUP: seed admin missing'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'cde10-patient@example.invalid', 'x', now(), '{}', '{}'),
         (v_pat2, 'cde10-patient2@example.invalid', 'x', now(), '{}', '{}'),
         (v_doctor, 'cde10-doctor@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', sex = 'female' where id in (v_pat, v_pat2);
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'CDE10 Doctor' where id = v_doctor;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v_doctor, 'CDE10 Doctor', 'MDCN', 'CDE10-001', true, 'active', now(), v_admin,
      'senior_medical_officer', 'contracted', 2, true, v_admin);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doctor, now()), (v_org, v_pat2, v_doctor, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- 2. the signature gate
  delete from public.proposed_config_signoffs where config_key = 'documents.narrative_urgent_rules';
  if private.narrative_rules_in_force() is not null then raise exception 'FAIL 2: rules act with no sign-off'; end if;
  insert into public.ecg_report_documents (organisation_id, patient_id, file_path, source)
  values (v_org, v_pat, v_pat::text || '/cde10.pdf', 'clinician') returning id into v_ecg;
  if private.apply_narrative_urgent_rules(v_org, v_pat, 'ecg_report_documents', v_ecg, '{"ecgQtcMs":600}', 'doctor', 'labs_results', null) is not null then
    raise exception 'FAIL 2: an unsigned rule set raised an alert';
  end if;
  insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, signed_by)
  values ('documents.narrative_urgent_rules', 1, v_hash, 'CMO', 'confirmed', v_admin);
  if private.narrative_rules_in_force() is null then raise exception 'FAIL 2: a confirmed sign-off of this value does not act'; end if;

  -- 3. ECG QTc, confirmed by a clinician, in seconds
  insert into public.ecg_parameter_readings (organisation_id, patient_id, ecg_report_document_id, code, value, unit, taken_at, confirmed_by, confirmed_at)
  values (v_org, v_pat, v_ecg, 'qtc_interval', 0.512, 's', now(), v_doctor, now());
  select a.* into v_a from public.clinician_alerts a join public.ecg_report_documents d on d.clinician_alert_id = a.id where d.id = v_ecg;
  if v_a.level <> 'emergency' or v_a.severity <> 4 or v_a.escalation_level <> 4 then
    raise exception 'FAIL 3: the ECG review alert was not raised to emergency (level %, severity %)', v_a.level, v_a.severity;
  end if;
  if v_a.sla_due_at > now() + private.escalation_sla_minutes('screening_abnormal_result', 'emergency') * interval '1 minute' + interval '1 minute' then
    raise exception 'FAIL 3: SLA not taken from escalation_slas';
  end if;
  if v_a.detail not like '%QTc 512 ms%' then raise exception 'FAIL 3: finding not written on the alert'; end if;
  select count(*) into v_n from public.narrative_urgent_findings where source_id = v_ecg and alert_action = 'raised' and tier = 'emergency';
  if v_n <> 1 then raise exception 'FAIL 3: expected one raised finding, got %', v_n; end if;
  select count(*) into v_n from public.clinician_alerts where patient_id = v_pat;
  if v_n <> 1 then raise exception 'FAIL 3: a second alert was opened instead of raising the review alert (% alerts)', v_n; end if;
  if v_a.responsible_clinician_id is not null and not exists (
       select 1 from public.notifications where recipient_id = (select profile_id from public.clinical_staff where id = v_a.responsible_clinician_id)
         and template = 'abnormal_result_clinician_alert'
         and source_id = v_a.id) then
    raise exception 'FAIL 3: the owner was not notified';
  end if;
  insert into public.ecg_parameter_readings (organisation_id, patient_id, ecg_report_document_id, code, value, unit, taken_at, confirmed_by, confirmed_at)
  values (v_org, v_pat, v_ecg, 'qtc_interval', 512, 'ms', now(), v_doctor, now());
  select count(*) into v_n from public.narrative_urgent_findings where source_id = v_ecg;
  if v_n <> 1 then raise exception 'FAIL 3: the same finding was recorded twice'; end if;

  -- 4. AI-016 impression on an imaging document
  insert into public.imaging_report_documents (organisation_id, patient_id, file_path, source)
  values (v_org, v_pat2, v_pat2::text || '/cde10-img.pdf', 'clinician') returning id into v_img;
  update public.imaging_report_documents set ai_impression_text = 'No pneumothorax. No free air.' where id = v_img;
  if exists (select 1 from public.narrative_urgent_findings where source_id = v_img) then raise exception 'FAIL 4: a negated finding raised'; end if;
  update public.imaging_report_documents set ai_impression_text = 'Large right pneumothorax.' where id = v_img;
  select a.* into v_a from public.clinician_alerts a join public.imaging_report_documents d on d.clinician_alert_id = a.id where d.id = v_img;
  if v_a.id is null then
    select a.* into v_a from public.clinician_alerts a join public.narrative_urgent_findings f on f.clinician_alert_id = a.id where f.source_id = v_img;
  end if;
  if v_a.level <> 'emergency' or v_a.detail not like '%AI reading%pneumothorax%' or v_a.title not like 'Priority 1: urgent finding (%' then
    raise exception 'FAIL 4: the AI impression did not raise an emergency review (level %)', v_a.level;
  end if;

  -- 5. never lower: patient 1 already has an emergency alert
  select clinician_alert_id into v_alert from public.ecg_report_documents where id = v_ecg;
  perform private.apply_narrative_urgent_rules(v_org, v_pat, 'ecg_report_documents', v_ecg,
    '{"pathologyDiagnosis":"Invasive ductal carcinoma"}', 'doctor', 'labs_results', v_alert);
  select * into v_a from public.clinician_alerts where id = v_alert;
  if v_a.level <> 'emergency' then raise exception 'FAIL 5: an urgent_escalation match lowered an emergency alert to %', v_a.level; end if;
  if not exists (select 1 from public.narrative_urgent_findings where patient_id = v_pat and alert_action = 'already_at_or_above'
                   and clinician_alert_id = v_alert) then
    raise exception 'FAIL 5: the pathology finding was not attached to the open emergency alert';
  end if;
  -- never merged into another document's open alert
  perform private.apply_narrative_urgent_rules(v_org, v_pat, 'pathology_reports', gen_random_uuid(),
    '{"pathologyDiagnosis":"Metastatic melanoma"}', 'doctor', 'labs_results', null);
  select count(*) into v_n from public.clinician_alerts where patient_id = v_pat and not suppressed and status = 'open';
  if v_n <> 2 or (select detail from public.clinician_alerts where id = v_alert) like '%melanoma%' then
    raise exception 'FAIL 5: a finding on another document was merged into an unrelated alert (% open alerts)', v_n;
  end if;
  -- an overridden document alert is left alone; the AI finding opens a new alert, with no session (as the AI service writes)
  declare v_img2 uuid; v_ov public.clinician_alerts; begin
    insert into public.imaging_report_documents (organisation_id, patient_id, file_path, source)
    values (v_org, v_pat, v_pat::text || '/cde10-img2.pdf', 'clinician') returning id into v_img2;
    perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
    update public.clinician_alerts set override_level = 'routine', override_reason = 'proof: reviewed, nothing to do'
     where id = (select clinician_alert_id from public.imaging_report_documents where id = v_img2);
    perform set_config('request.jwt.claims', null, true);
    update public.imaging_report_documents set ai_impression_text = 'Aortic dissection.' where id = v_img2;
    select a.* into v_ov from public.clinician_alerts a join public.imaging_report_documents d on d.clinician_alert_id = a.id where d.id = v_img2;
    if v_ov.override_level <> 'routine' or v_ov.level <> 'clinician_review' then
      raise exception 'FAIL 5: an overridden alert was changed (override %, level %)', v_ov.override_level, v_ov.level;
    end if;
    if not exists (select 1 from public.narrative_urgent_findings f join public.clinician_alerts a on a.id = f.clinician_alert_id
                   where f.source_id = v_img2 and f.alert_action = 'opened' and a.level = 'emergency' and not a.suppressed) then
      raise exception 'FAIL 5: the AI finding on an overridden document did not open its own unsuppressed alert';
    end if;
  end;

  -- 6. pathology filed for a patient with no open alert opens one at the 24-hour tier
  update public.clinician_alerts set status = 'resolved', resolved_at = now(), resolution_action = 'cde10 proof', resolution_outcome = 'true_positive'
   where patient_id = v_pat2;
  insert into storage.objects (bucket_id, name, owner_id) values ('lab-result-documents', v_pat2::text || '/cde10-hist.pdf', v_pat2::text);
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_doc := public.submit_unsorted_document(v_pat2::text || '/cde10-hist.pdf', 'biopsy.pdf', 'application/pdf', 1000, repeat('a', 64), null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform public.record_document_classification(v_doc, 'lab.histopathology', 0.95, 'ai', 'AI-024:test', true, null);
  insert into public.pathology_reports (organisation_id, patient_id, clinical_document_id, report_kind, access_category, filed_by, diagnosis_as_printed)
  values (v_org, v_pat2, v_doc, 'histopathology', 'labs_results', v_doctor, 'Invasive ductal carcinoma, grade 2') returning id into v_path;
  select a.* into v_a from public.clinician_alerts a join public.narrative_urgent_findings f on f.clinician_alert_id = a.id
   where f.source_id = v_path;
  if v_a.id is null or v_a.level <> 'urgent_escalation' or v_a.suppressed or v_a.status <> 'open' then
    raise exception 'FAIL 6: pathology did not open an unsuppressed urgent_escalation alert (%, %)', v_a.level, v_a.suppressed;
  end if;
  if v_a.sla_due_at > now() + private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation') * interval '1 minute' + interval '1 minute' then
    raise exception 'FAIL 6: SLA not the 24-hour tier';
  end if;
  if (select alert_action from public.narrative_urgent_findings where source_id = v_path) <> 'opened' then raise exception 'FAIL 6: not opened'; end if;
  -- even with duplicate suppression switched on for abnormal_result (it is off live), a new urgent finding is never hidden
  update public.alert_rules set config = (
    select jsonb_agg(case when e->>'type_code' = 'abnormal_result'
                          then e || '{"auto_suppress_duplicates": true, "suppress_window_minutes": "1440"}'::jsonb else e end)
    from jsonb_array_elements(config) e)
  where is_active;
  v_alert := private.apply_narrative_urgent_rules(v_org, v_pat2, 'pathology_reports', gen_random_uuid(),
    '{"pathologyDiagnosis":"Diffuse large B-cell lymphoma"}', 'doctor', 'labs_results', null);
  if (select suppressed from public.clinician_alerts where id = v_alert) then
    raise exception 'FAIL 6: an urgent finding was left suppressed as a duplicate';
  end if;

  -- 7. access
  if has_function_privilege('anon', 'private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.narrative_rules_in_force()', 'EXECUTE') then
    raise exception 'FAIL 7: a browser session can execute the narrative functions';
  end if;
  if has_table_privilege('authenticated', 'public.narrative_urgent_rule_sets', 'SELECT') then raise exception 'FAIL 7: rule sets readable'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.narrative_urgent_findings;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 7: the patient can read % findings', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_doctor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.narrative_urgent_findings where patient_id = v_pat2;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_n < 1 then raise exception 'FAIL 7: the tied doctor cannot read the findings (control)'; end if;

  -- 2 (continued). a newer request for changes, or a confirmation of another value, stops the rules
  insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, note, signed_by)
  values ('documents.narrative_urgent_rules', 1, v_hash, 'CMO', 'changes_requested', 'change the QTc line', v_admin);
  if private.narrative_rules_in_force() is not null then raise exception 'FAIL 2: rules still act after a request for changes'; end if;
  insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, signed_by)
  values ('documents.narrative_urgent_rules', 1, repeat('0', 64), 'CMO', 'confirmed', v_admin);
  if private.narrative_rules_in_force() is not null then raise exception 'FAIL 2: a confirmation of a different value made the rules act'; end if;

  -- 8. sabotage: without the fingerprint check the wrong-value confirmation would act
  execute $sab$
    create or replace function private.narrative_rules_in_force() returns jsonb language sql stable security definer set search_path = '' as $f$
      select r.value || jsonb_build_object('_version', r.version) from public.narrative_urgent_rule_sets r
      where (select s.decision = 'confirmed' from public.proposed_config_signoffs s
             where s.config_key = 'documents.narrative_urgent_rules' and s.config_version = r.version order by s.id desc limit 1)
      order by r.version desc limit 1 $f$ $sab$;
  v_ok := private.narrative_rules_in_force() is not null;
  if not v_ok then raise exception 'FAIL 8: sabotage not detected (the check in 2 proves nothing)'; end if;

  raise notice 'cde10_apply_narrative_urgent_rules: all checks passed';
end $$;

rollback;
