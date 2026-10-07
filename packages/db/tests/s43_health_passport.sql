-- S43 proof: the Health Passport record, share links, emergency card fields, biomarker trends and the vaccination schedule gate
-- (migrations *_s43_record_foundations.sql, *_s43_share_links_and_emergency_card_fields.sql, *_s43_biomarker_trends_and_vaccination_schedule.sql).
-- One rolled-back transaction. Proves:
--   1. Timeline: every item carries a trust tier; manual vitals are patient, a device reading is device, a document awaiting a reading is ocr_unconfirmed,
--      a confirmed reading is ocr_confirmed; a client cannot choose a tier.
--   2. Photo capture: the reading columns cannot be written by a client or a forged update; the reader (service role) records suggestions only; the capture guard
--      fails closed; the patient confirms per field (edits flagged, raw text dropped); another patient cannot confirm; a REJECTED suggestion leaves no text, no
--      values and nothing in any other table (acceptance: "OCR suggestion rejected leaves no record"); nothing outside the S43 functions reads the suggestions.
--   3. History: a patient writer cannot claim a clinician source or a verification; an edit un-verifies; removal is a tombstone; staff have no direct read and read
--      through an audited function that refuses an untied clinician and writes audit rows (INV-10, INV-12); a clinician records and verifies only with a tie.
--   4. Symptom journal: a timeline row, the journal read (own only).
--   5. Share links: default expiry from config; token stored hashed; EXPIRED returns gone/expired AND logs the attempt (acceptance: 410 and logs); revoked, view cap,
--      PIN required, wrong PIN, lockout; mental health and reproductive sections cannot be chosen; the released-only lab filter (a held, withdrawn or sensitive
--      positive result never appears); anon can open but cannot create or revoke; the bus event fires.
--   6. Emergency card: patient-chosen fields are stripped by the wrapper; the renamed full function cannot be called by a client.
--   7. Biomarker trends: released results only, the lab's own range, mixed units flagged, the care team's target labelled, a stranger refused.
--   8. Vaccination: the immunisations view, the v2 draft is unsigned (HPV two doses, typhoid excluded), reminders are paused until a signed schedule with a config exists.
--   9. Execute grants: no new function is callable by anon unless it is meant to be.
--  10. SABOTAGE: the OCR column guard dropped, the expiry check bypassed, the reminder gate bypassed; each must flip the matching check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a signed-in user; returns 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's43-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S43 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S43 ' || p_label, 'MDCN', 'S43-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, p_admin, true)
  returning id into s;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_doc uuid; v_doc2 uuid;
  v_d1 uuid; v_d2 uuid; v_d3 uuid; v_n integer; v_j jsonb; v_t text; v_s uuid; v_s2 uuid; v_tok text;
  v_proc uuid; v_fh uuid; v_fh2 uuid; v_sym uuid; v_card text; v_vac uuid; v_cat uuid; v_staff uuid; v_cnt_before integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');  perform pg_temp.setf('pat', v_pat);
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient'); perform pg_temp.setf('pat2', v_pat2);
  v_doc := pg_temp.mkdoc(v_org, 'tied', v_admin);    perform pg_temp.setf('doc', v_doc);
  v_doc2 := pg_temp.mkdoc(v_org, 'untied', v_admin); perform pg_temp.setf('doc2', v_doc2);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());
  perform pg_temp.setf('org', v_org);

  -- ===== 1. timeline trust tiers ================================================================================================
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v_org, v_pat, 'blood_pressure', 120, 80, 'manual', now());
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v_org, v_pat, 'blood_pressure', 118, 78, 'device', now());
  perform pg_temp.ck('1a manual vitals are tier patient', 'patient',
    (select trust_tier from public.patient_timeline where patient_id = v_pat and source_table = 'vitals_readings' and metadata ->> 'source' = 'manual'));
  perform pg_temp.ck('1b device vitals are tier device', 'device',
    (select trust_tier from public.patient_timeline where patient_id = v_pat and source_table = 'vitals_readings' and metadata ->> 'source' = 'device'));
  perform pg_temp.ck('1c no timeline row lacks a tier', '0', (select count(*)::text from public.patient_timeline where trust_tier is null));
  -- a writer cannot choose a tier: the trigger derives it whatever is inserted
  insert into public.patient_timeline (organisation_id, patient_id, event_type, source_table, title, trust_tier, metadata)
  values (v_org, v_pat, 'care_plan_updated', 'care_plans', 'forged', 'clinician', '{}'::jsonb);
  perform pg_temp.ck('1d a forged clinician tier with no real actor is system', 'system',
    (select trust_tier from public.patient_timeline where patient_id = v_pat and title = 'forged'));

  -- ===== 2. photo capture =======================================================================================================
  -- patient inserts a document waiting for a reading (own row, RLS insert)
  perform pg_temp.act(v_pat);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state)
  values (v_org, v_pat, 'previous_hospital_record', v_pat || '/s43-a.jpg', 'patient', 'pending') returning id into v_d1;
  perform pg_temp.back();
  perform pg_temp.setf('d1', v_d1);
  perform pg_temp.ck('2a the upload row is the photo itself, tier patient (what is read from it gets its own rows)', 'patient',
    (select trust_tier from public.patient_timeline where source_id = v_d1 and source_table = 'patient_documents' and title = 'Document added to your record'));
  perform pg_temp.ck('2b the upload emitted document.uploaded', '1',
    (select count(*)::text from public.domain_events where event_type = 'document.uploaded' and aggregate_id = v_d1));
  perform pg_temp.ck('2c a patient cannot insert a document with suggested values', 'true',
    (pg_temp.try_as(v_pat, format($q$insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state, extracted)
      values (%L, %L, 'other', %L, 'patient', 'pending', '{"fields":[]}')$q$, v_org, v_pat, v_pat || '/x.jpg')) like '%suggested values cannot be inserted%')::text);
  perform pg_temp.ck('2d a patient cannot insert a document already confirmed', 'true',
    (pg_temp.try_as(v_pat, format($q$insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state)
      values (%L, %L, 'other', %L, 'patient', 'confirmed')$q$, v_org, v_pat, v_pat || '/y.jpg')) like '%may only start%')::text);
  -- a forged direct update of the reading columns: the patient has no update policy (0 rows), the owner meets the guard trigger
  perform pg_temp.try_as(v_pat, format($q$update public.patient_documents set ocr_state = 'confirmed' where id = %L$q$, v_d1));
  perform pg_temp.ck('2f the forged update changed nothing', 'pending', (select ocr_state from public.patient_documents where id = v_d1));
  perform pg_temp.ck('2g even the table owner cannot write the reading columns outside the functions', 'true',
    (pg_temp.try_sql_owner(format($q$update public.patient_documents set ocr_state = 'suggested' where id = %L$q$, v_d1)) like '%only through the capture functions%')::text);
  -- the reader: only the service role; the guard fails closed
  perform pg_temp.ck('2h a signed-in patient cannot call the reader write', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.record_document_suggestion(%L, 'x', '{"fields":[]}', 'm', false)$q$, v_d1)) like 'permission denied%')::text);
  perform pg_temp.ck('2i anon cannot call the reader write', 'true',
    (pg_temp.q_anon(format($q$select public.record_document_suggestion(%L, 'x', '{"fields":[]}', 'm', false)$q$, v_d1)) like '%permission denied%')::text);
  update public.profiles set is_test = false where id = v_pat;
  perform pg_temp.ck('2j the guard off and a real patient: the reader write is refused (INV-14)', 'true',
    (pg_temp.try_service(format($q$select public.record_document_suggestion(%L, 'raw text', '{"fields":[{"key":"hb","label":"Haemoglobin","value":"12.1","unit":"g/dL","confidence":"high"}]}', 'm', false)$q$, v_d1)) like '%not open%')::text);
  update public.profiles set is_test = true where id = v_pat;
  perform pg_temp.ck('2k a test patient may exercise it: the reader records suggestions', 'true',
    (pg_temp.try_service(format($q$select public.record_document_suggestion(%L, 'raw text', '{"fields":[{"key":"hb","label":"Haemoglobin","value":"12.1","unit":"g/dL","confidence":"high","state":"confirmed"},{"key":"wbc","label":"White cells","value":"6.0","unit":"x10^9/L","confidence":"zzz"},{"key":"","value":"junk"}]}', 'model-x', false)$q$, v_d1)) like '%suggested%')::text);
  perform pg_temp.ck('2l the state is suggested', 'suggested', (select ocr_state from public.patient_documents where id = v_d1));
  perform pg_temp.ck('2m an empty key is dropped and every field starts as suggested (a claimed "confirmed" is overwritten)', '2:2',
    (select jsonb_array_length(extracted -> 'fields') || ':' || count(*) filter (where f ->> 'state' = 'suggested') from public.patient_documents d, jsonb_array_elements(d.extracted -> 'fields') f where d.id = v_d1 group by d.extracted));
  perform pg_temp.ck('2n an unknown confidence becomes low', 'low', (select f ->> 'confidence' from public.patient_documents d, jsonb_array_elements(d.extracted -> 'fields') f where d.id = v_d1 and f ->> 'key' = 'wbc'));
  perform pg_temp.ck('2oa suggestions get one honest unconfirmed row', 'ocr_unconfirmed:1',
    (select trust_tier from public.patient_timeline where source_id = v_d1 and title = 'Details read from your photo') || ':'
    || (select count(*)::text from public.patient_timeline where source_id = v_d1 and title = 'Details read from your photo'));
  perform pg_temp.ck('2o document.ocr_suggested emitted', '1', (select count(*)::text from public.domain_events where event_type = 'document.ocr_suggested' and aggregate_id = v_d1));
  perform pg_temp.ck('2p a second reading is refused (not pending)', 'true',
    (pg_temp.try_service(format($q$select public.record_document_suggestion(%L, 'again', '{"fields":[]}', 'm', false)$q$, v_d1)) like '%not waiting%')::text);
  perform pg_temp.ck('2q another patient cannot confirm it', 'true',
    (pg_temp.try_as(v_pat2, format($q$select public.confirm_document_extraction(%L, '[{"key":"hb","accept":true}]')$q$, v_d1)) like '%document not found%')::text);
  perform pg_temp.ck('2r anon cannot confirm', 'true',
    (pg_temp.q_anon(format($q$select public.confirm_document_extraction(%L, '[]')$q$, v_d1)) like '%permission denied%')::text);
  perform pg_temp.ck('2s confirming nothing is refused', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.confirm_document_extraction(%L, '[{"key":"hb","accept":false}]')$q$, v_d1)) like '%confirm at least one%')::text);
  perform pg_temp.ck('2t a key that is not in the suggestion is ignored (nothing kept, so refused)', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.confirm_document_extraction(%L, '[{"key":"nope","accept":true,"value":"1"}]')$q$, v_d1)) like '%confirm at least one%')::text);
  perform pg_temp.ck('2u confirm one field with an edit', 'confirmed',
    (pg_temp.q_as(v_pat, format($q$select public.confirm_document_extraction(%L, '[{"key":"hb","accept":true,"value":"12.4"},{"key":"wbc","accept":false}]') ->> 'state'$q$, v_d1))));
  perform pg_temp.ck('2v the raw text is gone after confirm', 'true', (select (ocr_text is null)::text from public.patient_documents where id = v_d1));
  perform pg_temp.ck('2w one field kept, edited, confirmed', '1:12.4:true:confirmed',
    (select jsonb_array_length(extracted -> 'fields') || ':' || (extracted -> 'fields' -> 0 ->> 'value') || ':' || (extracted -> 'fields' -> 0 ->> 'edited') || ':' || (extracted -> 'fields' -> 0 ->> 'state') from public.patient_documents where id = v_d1));
  perform pg_temp.ck('2x the dropped field is not stored anywhere on the row', 'false',
    (select (extracted::text like '%White cells%')::text from public.patient_documents where id = v_d1));
  perform pg_temp.ck('2y a confirmed row has a confirmed timeline entry at tier ocr_confirmed', 'ocr_confirmed',
    (select trust_tier from public.patient_timeline where source_id = v_d1 and title = 'Details confirmed from your photo'));
  perform pg_temp.ck('2z the confirm is audited', '1', (select count(*)::text from public.audit_log where action = 'document.ocr_confirmed' and entity_id = v_d1));

  -- the rejection path: the acceptance test
  perform pg_temp.act(v_pat);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state)
  values (v_org, v_pat, 'prescription', v_pat || '/s43-b.jpg', 'patient', 'pending') returning id into v_d2;
  perform pg_temp.back();
  perform pg_temp.setf('d2', v_d2);
  perform pg_temp.try_service(format($q$select public.record_document_suggestion(%L, 'Metformin 500mg twice daily', '{"fields":[{"key":"drug","label":"Medicine","value":"Metformin 500mg","confidence":"high"}]}', 'm', false)$q$, v_d2));
  select count(*) into v_cnt_before from public.medications where patient_id = v_pat;
  perform pg_temp.ck('2aa the suggestion is waiting', 'suggested', (select ocr_state from public.patient_documents where id = v_d2));
  perform pg_temp.ck('2ab reject', 'rejected', pg_temp.q_as(v_pat, format($q$select public.reject_document_extraction(%L) ->> 'state'$q$, v_d2)));
  perform pg_temp.ck('2ac a rejected reading leaves no text and no values (acceptance)', 'true:true',
    (select (ocr_text is null)::text || ':' || (extracted is null)::text from public.patient_documents where id = v_d2));
  perform pg_temp.ck('2ad the original photo is kept', 'true', (select (file_path = v_pat || '/s43-b.jpg')::text from public.patient_documents where id = v_d2));
  perform pg_temp.ck('2ae nothing reached medications, vitals, labs or alerts', '0:0:0:0',
    (select (select count(*) from public.medications where patient_id = v_pat) - v_cnt_before
       || ':' || (select count(*) from public.clinician_alerts where patient_id = v_pat)
       || ':' || (select count(*) from public.lab_analyte_readings where patient_id = v_pat)
       || ':' || (select count(*) from public.vitals_readings where patient_id = v_pat and source::text not in ('manual', 'device'))));
  perform pg_temp.ck('2afa rejecting a suggestion adds a row saying nothing was kept, tier patient', 'patient',
    (select trust_tier from public.patient_timeline where source_id = v_d2 and title = 'Details from your photo not kept'));
  perform pg_temp.ck('2af no confirmed timeline entry exists for the rejected document', '0',
    (select count(*)::text from public.patient_timeline where source_id = v_d2 and title = 'Details confirmed from your photo'));
  perform pg_temp.ck('2ag rejecting twice is refused', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.reject_document_extraction(%L)$q$, v_d2)) like '%nothing waiting%')::text);
  perform pg_temp.ck('2ah the rejection is audited', '1', (select count(*)::text from public.audit_log where action = 'document.ocr_rejected' and entity_id = v_d2));
  -- the reader failing leaves nothing either
  perform pg_temp.act(v_pat);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state)
  values (v_org, v_pat, 'other', v_pat || '/s43-c.jpg', 'patient', 'pending') returning id into v_d3;
  perform pg_temp.back();
  perform pg_temp.try_service(format($q$select public.record_document_suggestion(%L, null, null, 'm', true)$q$, v_d3));
  perform pg_temp.ck('2ai a failed reading holds nothing', 'failed:true:true',
    (select ocr_state || ':' || (ocr_text is null)::text || ':' || (extracted is null)::text from public.patient_documents where id = v_d3));
  -- a photo whose reading cannot run (guard closed for a real patient) can still be marked failed, so it never waits forever
  perform pg_temp.act(v_pat);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state)
  values (v_org, v_pat, 'other', v_pat || '/s43-d.jpg', 'patient', 'pending') returning id into v_s2;
  perform pg_temp.back();
  update public.profiles set is_test = false where id = v_pat;
  perform pg_temp.try_service(format($q$select public.record_document_suggestion(%L, null, null, 'm', true)$q$, v_s2));
  perform pg_temp.ck('2aia failing a reading needs no open guard, so a photo never waits forever (a real patient, guard closed)', 'failed',
    (select ocr_state from public.patient_documents where id = v_s2));
  update public.profiles set is_test = true where id = v_pat;
  -- nothing else reads the suggestions: no function outside this module touches the reading columns of patient_documents
  perform pg_temp.ck('2aj only the S43 functions read ocr_text or extracted of patient_documents', '',
    coalesce((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosrc ~* 'patient_documents' and p.prosrc ~* '(ocr_text|\.extracted|extracted\s*(,|->|=|is))'
         and p.proname not in ('record_document_suggestion', 'confirm_document_extraction', 'reject_document_extraction', 'enforce_patient_document_ocr_columns')), ''));

  -- ===== 3. history =============================================================================================================
  perform pg_temp.act(v_pat);
  insert into public.procedures (organisation_id, patient_id, name, performed_on, source, verified_by_clinician, verified_by, verified_at, recorded_by, is_test)
  values (v_org, v_pat, 'Appendicectomy', current_date - 900, 'clinician', true, v_doc, now(), v_doc, true) returning id into v_proc;
  perform pg_temp.back();
  perform pg_temp.setf('proc', v_proc);
  perform pg_temp.ck('3a a patient writer cannot claim a clinician source or a verification', 'patient:false:true',
    (select source::text || ':' || verified_by_clinician::text || ':' || (recorded_by = v_pat)::text from public.procedures where id = v_proc));
  perform pg_temp.ck('3b the timeline row is tier patient', 'patient', (select trust_tier from public.patient_timeline where source_id = v_proc));
  perform pg_temp.ck('3c a patient cannot verify their own row by update', 'false',
    pg_temp.q_as(v_pat, format($q$with u as (update public.procedures set verified_by_clinician = true, verified_by = %L, verified_at = now() where id = %L returning verified_by_clinician) select verified_by_clinician::text from u$q$, v_pat, v_proc)));
  perform pg_temp.ck('3d a patient cannot delete a procedure', 'true',
    (pg_temp.try_as(v_pat, format($q$delete from public.procedures where id = %L$q$, v_proc)) like 'permission denied%')::text);
  perform pg_temp.ck('3e a clinician with a tie but NO direct read policy sees no rows', '0',
    pg_temp.q_as(v_doc, format($q$select count(*)::text from public.procedures where patient_id = %L$q$, v_pat)));
  perform pg_temp.ck('3f the other patient sees none', '0', pg_temp.q_as(v_pat2, format($q$select count(*)::text from public.procedures where patient_id = %L$q$, v_pat)));
  perform pg_temp.ck('3g anon sees none', 'ERR:permission denied for table procedures', pg_temp.q_anon($q$select count(*)::text from public.procedures$q$));
  -- verification by a tied clinician; refused for the untied
  perform pg_temp.ck('3h an untied clinician cannot verify (denied, and the denial is kept)', 'denied',
    pg_temp.q_as(v_doc2, format($q$select public.verify_history_item('procedure', %L, 'S43 proof: untied attempt') ->> 'status'$q$, v_proc)));
  perform pg_temp.ck('3i the refusal is audited as denied', '1',
    (select count(*)::text from public.audit_log where action = 'staff.chart_read' and actor_id = v_doc2 and result = 'denied' and subject_patient_id = v_pat));
  perform pg_temp.ck('3j a patient cannot verify through the function', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.verify_history_item('procedure', %L, 'S43 proof: patient attempt')$q$, v_proc)) like '%for clinicians%')::text);
  perform pg_temp.ck('3k a tied clinician verifies', 'ok:true', pg_temp.q_as(v_doc, format($q$select (public.verify_history_item('procedure', %L, 'S43 proof: tied clinician check') ->> 'status') || ':' || (public.verify_history_item('procedure', %L, 'S43 proof: tied clinician check again') ->> 'verified')$q$, v_proc, v_proc)));
  perform pg_temp.ck('3l the row is verified by that clinician', 'true:true',
    (select verified_by_clinician::text || ':' || (verified_by = v_doc)::text from public.procedures where id = v_proc));
  perform pg_temp.act(v_pat);
  update public.procedures set name = 'Appendicectomy (open)' where id = v_proc;
  perform pg_temp.back();
  perform pg_temp.ck('3m editing the text un-verifies it', 'false', (select verified_by_clinician::text from public.procedures where id = v_proc));
  perform pg_temp.ck('3n a reason shorter than ten characters is refused', 'true',
    (pg_temp.try_as(v_doc, format($q$select public.verify_history_item('procedure', %L, 'short')$q$, v_proc)) like '%at least 10%')::text);
  -- clinician-recorded procedure needs the tie
  perform pg_temp.ck('3o an untied clinician cannot record a procedure', 'denied',
    pg_temp.q_as(v_doc2, format($q$select public.clinician_record_procedure(%L, 'Hernia repair', null, null, 'S43 proof: untied record') ->> 'status'$q$, v_pat)));
  select (pg_temp.q_as(v_doc, format($q$select public.clinician_record_procedure(%L, 'Hernia repair', current_date - 400, 'Lagos hospital', 'S43 proof: tied record') ->> 'id'$q$, v_pat)))::uuid into v_s;
  perform pg_temp.ck('3p a tied clinician records one: source clinician, verified', 'clinician:true',
    (select source::text || ':' || verified_by_clinician::text from public.procedures where id = v_s));
  perform pg_temp.ck('3q its timeline row carries a real actor so the tier is clinician', 'clinician', (select trust_tier from public.patient_timeline where source_id = v_s));
  -- tombstone
  perform pg_temp.ck('3r the patient removes a clinician-sourced item', 'true', pg_temp.q_as(v_pat, format($q$select (public.remove_history_item('procedure', %L, 'entered by mistake') ->> 'removed')$q$, v_s)));
  perform pg_temp.ck('3s the patient no longer sees it', '0', pg_temp.q_as(v_pat, format($q$select count(*)::text from public.procedures where id = %L$q$, v_s)));
  perform pg_temp.ck('3t the row still exists as a tombstone', 'true', (select (removed_at is not null and removal_reason = 'entered by mistake')::text from public.procedures where id = v_s));
  -- the audited staff read
  v_j := pg_temp.q_as(v_doc, format($q$select public.read_patient_history_audited(%L, 'S43 proof: tied history review')::text$q$, v_pat))::jsonb;
  perform pg_temp.ck('3u the tied clinician reads both procedures, with the tombstone visible to staff', 'ok:2',
    (v_j ->> 'status') || ':' || jsonb_array_length(v_j -> 'procedures'));
  perform pg_temp.ck('3v the staff read wrote an audit row', 'true',
    (select (count(*) >= 1)::text from public.audit_log where action = 'staff.chart_read' and actor_id = v_doc and result = 'success' and event -> 'sections' ? 'procedures'));
  v_j := pg_temp.q_as(v_doc2, format($q$select public.read_patient_history_audited(%L, 'S43 proof: untied history attempt')::text$q$, v_pat))::jsonb;
  perform pg_temp.ck('3w an untied clinician is denied', 'denied', v_j ->> 'status');
  perform pg_temp.ck('3x a patient cannot use the staff read', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.read_patient_history_audited(%L, 'S43 proof: patient attempt')$q$, v_pat)) like '%not authorised%')::text);
  perform pg_temp.ck('3y anon cannot', 'true', (pg_temp.q_anon(format($q$select public.read_patient_history_audited(%L, 'S43 proof: anon attempt')$q$, v_pat)) like '%permission denied%')::text);
  -- family history
  perform pg_temp.act(v_pat);
  insert into public.family_history (organisation_id, patient_id, condition_name, relationship, source, recorded_by)
  values (v_org, v_pat, 'Type 2 diabetes', 'mother', 'clinician', v_doc) returning id into v_fh;
  insert into public.family_history (organisation_id, patient_id, condition_name, relationship) values (v_org, v_pat, 'Hypertension', 'father') returning id into v_fh2;
  perform pg_temp.back();
  perform pg_temp.ck('3z a patient writer cannot claim source clinician on family history', 'patient', (select source from public.family_history where id = v_fh));
  perform pg_temp.q_as(v_doc, format($q$select public.verify_history_item('family_history', %L, 'S43 proof: verify family history')$q$, v_fh));
  perform pg_temp.ck('3aa a patient cannot hard-delete a row a clinician verified', '0',
    pg_temp.q_as(v_pat, format($q$with d as (delete from public.family_history where id = %L returning 1) select count(*)::text from d$q$, v_fh)));
  perform pg_temp.ck('3ab a patient can hard-delete their own unverified row', '1',
    pg_temp.q_as(v_pat, format($q$with d as (delete from public.family_history where id = %L returning 1) select count(*)::text from d$q$, v_fh2)));
  -- (a direct staff insert into family_history is closed by S05f's policy, so there is no staff insert path to prove here)
  perform pg_temp.ck('3af an enormous confirm list is refused before any work', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.confirm_document_extraction(%L, (select jsonb_agg(jsonb_build_object('key', 'k' || g, 'accept', true)) from generate_series(1, 90) g))$q$, v_d1)) like '%too many fields%')::text);
  perform pg_temp.q_as(v_pat, format($q$select public.remove_history_item('family_history', %L)$q$, v_fh));
  perform pg_temp.ck('3ac a removed family history row is hidden from the patient and kept for staff', '0:1',
    pg_temp.q_as(v_pat, format($q$select count(*)::text from public.family_history where id = %L$q$, v_fh)) || ':' || (select count(*)::text from public.family_history where id = v_fh and removed_at is not null));
  perform pg_temp.ck('3ad no policy on procedures or family_history admits staff to read directly', '0',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('procedures', 'family_history') and cmd in ('SELECT', 'ALL') and qual ilike '%is_org_staff%'));

  -- ===== 4. symptom journal =====================================================================================================
  insert into public.symptoms (organisation_id, patient_id, symptom_type, description, severity, source)
  values (v_org, v_pat, 'fatigue', 'S43 proof fatigue', 2, 'patient') returning id into v_sym;
  perform pg_temp.ck('4a a symptom reaches the timeline at tier patient', 'patient', (select trust_tier from public.patient_timeline where source_id = v_sym and event_type = 'symptom_logged'));
  perform pg_temp.ck('4b the journal lists it for its owner', '1', pg_temp.q_as(v_pat, 'select count(*)::text from public.patient_symptom_journal()'));
  perform pg_temp.ck('4c and for no one else', '0', pg_temp.q_as(v_pat2, 'select count(*)::text from public.patient_symptom_journal()'));
  perform pg_temp.ck('4d anon cannot', 'true', (pg_temp.q_anon('select count(*) from public.patient_symptom_journal()') like '%permission denied%')::text);

  -- ===== 5. share links =========================================================================================================
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals','allergies','lab_results','procedures'])::text$q$)::jsonb;
  v_tok := v_j ->> 'token'; v_s := (v_j ->> 'id')::uuid; perform pg_temp.setf('share', v_s);
  perform pg_temp.ck('5a the default expiry is the configured 72 hours', '72',
    (select round(extract(epoch from (expires_at - created_at)) / 3600)::text from public.record_shares where id = v_s));
  perform pg_temp.ck('5b the token is held only as a hash', 'true:true',
    (select (token is null)::text || ':' || (token_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex'))::text from public.record_shares where id = v_s));
  perform pg_temp.ck('5c the two argument call still works (the deployed client)', 'true',
    (pg_temp.try_as(v_pat, $q$select public.create_record_share(array['vitals'], 24)$q$) = 'ok')::text);
  perform pg_temp.ck('5d mental health cannot be chosen', 'true',
    (pg_temp.try_as(v_pat, $q$select public.create_record_share(array['vitals','mental_health'])$q$) like '%invalid section%')::text);
  perform pg_temp.ck('5e reproductive health cannot be chosen', 'true',
    (pg_temp.try_as(v_pat, $q$select public.create_record_share(array['reproductive'])$q$) like '%invalid section%')::text);
  perform pg_temp.ck('5f the table refuses them too (a direct insert)', 'true',
    (pg_temp.try_sql_owner(format($q$insert into public.record_shares (organisation_id, patient_id, token_hash, sections, expires_at) values (%L, %L, %L, array['mental_health'], now() + interval '1 hour')$q$, v_org, v_pat, repeat('a', 64))) like '%record_shares_sections_valid%')::text);
  perform pg_temp.ck('5g an expiry beyond the ceiling is refused', 'true',
    (pg_temp.try_as(v_pat, $q$select public.create_record_share(array['vitals'], 721)$q$) like '%between 1 and 720%')::text);
  perform pg_temp.ck('5h a PIN must be digits', 'true',
    (pg_temp.try_as(v_pat, $q$select public.create_record_share(array['vitals'], 24, 'abcd')$q$) like '%digits%')::text);
  perform pg_temp.ck('5i anon cannot create or revoke', 'true',
    (pg_temp.q_anon($q$select public.create_record_share(array['vitals'])$q$) like '%permission denied%' and pg_temp.q_anon(format($q$select public.revoke_record_share(%L)$q$, v_s)) like '%permission denied%')::text);
  perform pg_temp.ck('5j anon cannot read the share table', 'true', (pg_temp.q_anon('select count(*) from public.record_shares') like '%permission denied%')::text);
  -- data for the lab filter
  set local session_replication_role = replica;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status, reference_range_low, reference_range_high, laboratory)
  values (v_org, v_pat, 'hba1c', 6.1, '%', now() - interval '3 years', 'final', 4.0, 5.6, 'Lab A'),
         (v_org, v_pat, 'hba1c', 6.9, '%', now() - interval '2 years', 'final', 4.0, 5.6, 'Lab A'),
         (v_org, v_pat, 'hba1c', 52, 'mmol/mol', now() - interval '1 year', 'final', 20, 38, 'Lab B'),
         (v_org, v_pat, 'hba1c', 99, '%', now(), 'preliminary', 4.0, 5.6, 'Lab B'),
         (v_org, v_pat2, 'hba1c', 7.7, '%', now(), 'final', 4.0, 5.6, 'Other');
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, released_at, release_reason)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'released', now() - interval '10 days', 'RES-001') returning id into v_cat;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, flag, ref_low, ref_high, sensitive_positive)
  values (v_cat, v_org, v_pat, 'LDL', 3.1, null, 'mmol/L', 'high', 0, 2.6, false),
         (v_cat, v_org, v_pat, 'HIV', null, 'positive', 'n/a', 'positive', null, null, true);
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'awaiting_review') returning id into v_s2;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive)
  values (v_s2, v_org, v_pat, 'LDL', 9.9, 'mmol/L', 'high', false);
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, released_at, release_reason, withdrawn_at, withdrawn_by, withdrawn_reason)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'released', now(), 'RES-001', now(), v_admin, 'wrong patient') returning id into v_s2;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive)
  values (v_s2, v_org, v_pat, 'LDL', 8.8, 'mmol/L', 'high', false);
  -- a released result that a later one replaced (a correction): the old one must not appear in a share or a trend
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, released_at, release_reason, superseded_by)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'released', now() - interval '20 days', 'RES-001', v_cat) returning id into v_s2;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive)
  values (v_s2, v_org, v_pat, 'LDL', 7.7, 'mmol/L', 'high', false);
  set local session_replication_role = origin;
  insert into public.procedures (organisation_id, patient_id, name, approximate_year, is_test) values (v_org, v_pat, 'Tonsillectomy', 2005, true);

  v_j := public.record_share_open(v_tok);
  perform pg_temp.ck('5k a clean opening returns ok with the record', 'ok', v_j ->> 'status');
  perform pg_temp.ck('5l the lab section no longer raises and shows final legacy readings and one released item', '4', jsonb_array_length(v_j -> 'record' -> 'lab_results')::text);
  perform pg_temp.ck('5m a held, a withdrawn, a replaced and a sensitive positive item are absent, a preliminary reading is absent', '0',
    (select count(*)::text from jsonb_array_elements(v_j -> 'record' -> 'lab_results') x where x ->> 'code' in ('HIV') or (x ->> 'value')::numeric in (9.9, 8.8, 99, 7.7)));
  perform pg_temp.ck('5n the procedures section is present', '2', jsonb_array_length(v_j -> 'record' -> 'procedures')::text);
  perform pg_temp.ck('5o a tombstoned procedure is absent', '0', (select count(*)::text from jsonb_array_elements(v_j -> 'record' -> 'procedures') x where x ->> 'name' = 'Hernia repair'));
  perform pg_temp.ck('5p the opening is logged and counted', '1:viewed:1',
    (select view_count::text from public.record_shares where id = pg_temp.f('share')) || ':' || (select outcome from public.record_share_lookups where share_id = pg_temp.f('share') limit 1)
    || ':' || (select count(*)::text from public.domain_events where event_type = 'share_link.accessed' and aggregate_id = pg_temp.f('share')));
  perform pg_temp.ck('5q the bus payload carries ids only', 'true',
    (select (payload ? 'share_id' and not (payload::text ~* 'blood|glucose|result|hiv')) ::text from public.domain_events where event_type = 'share_link.accessed' and aggregate_id = pg_temp.f('share') limit 1));
  perform pg_temp.ck('5r anon can open a link', 'ok', pg_temp.q_anon(format($q$select (public.record_share_open(%L) ->> 'status')$q$, v_tok)));
  perform pg_temp.ck('5s an unknown token is not_found and logs no attempt row', 'not_found',
    (public.record_share_open(repeat('b', 64)) ->> 'status'));
  -- PREVIEW: what a plain GET does (a link-preview bot or mail scanner must not spend a view or read a record)
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals'], 24, null, 1)::text$q$)::jsonb;
  v_t := public.record_share_open(v_j ->> 'token', null, false)::text;
  perform pg_temp.ck('5pa a preview of a live link says ready and returns no record', 'ready:false',
    (v_t::jsonb ->> 'status') || ':' || (v_t::jsonb ? 'record')::text);
  perform pg_temp.ck('5pb a preview spends no view and logs no opening', '0:0',
    (select view_count::text from public.record_shares where id = (v_j ->> 'id')::uuid) || ':'
    || (select count(*)::text from public.record_share_lookups where share_id = (v_j ->> 'id')::uuid and outcome = 'viewed'));
  perform public.record_share_open(v_j ->> 'token', null, false); perform public.record_share_open(v_j ->> 'token', null, false);
  perform pg_temp.ck('5pc many previews still leave the one allowed view for a person', 'ok',
    public.record_share_open(v_j ->> 'token') ->> 'status');
  perform pg_temp.ck('5pd and that one deliberate opening then closes the link', 'gone:view_cap',
    (public.record_share_open(v_j ->> 'token') ->> 'status') || ':' || (public.record_share_open(v_j ->> 'token') ->> 'reason'));
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals'], 24, '5555')::text$q$)::jsonb;
  perform pg_temp.ck('5pe a preview of a PIN link asks for the PIN and shows nothing', 'pin_required',
    public.record_share_open(v_j ->> 'token', '5555', false) ->> 'status');
  perform pg_temp.ck('5pf a preview never checks or counts a PIN', '0',
    (select pin_failed_attempts::text from public.record_shares where id = (v_j ->> 'id')::uuid));
  perform pg_temp.ck('5t the old function name still works for a clean opening and returns the bare record', 'true',
    ((public.record_share_by_token(v_tok) ? 'full_name'))::text);

  -- EXPIRED: the acceptance test
  update public.record_shares set expires_at = now() - interval '1 minute' where id = pg_temp.f('share');
  v_j := public.record_share_open(v_tok);
  perform pg_temp.ck('5u an expired link is gone (the route answers 410)', 'gone:expired', (v_j ->> 'status') || ':' || (v_j ->> 'reason'));
  perform pg_temp.ck('5v the expired attempt is logged against the link', '1',
    (select count(*)::text from public.record_share_lookups where share_id = pg_temp.f('share') and outcome = 'expired'));
  v_t := public.record_share_open(v_tok, null, false)::text;
  perform pg_temp.ck('5va a PREVIEW of an expired link is gone too, and is logged', 'gone:2',
    (v_t::jsonb ->> 'status') || ':' || (select count(*)::text from public.record_share_lookups where share_id = pg_temp.f('share') and outcome = 'expired'));
  perform pg_temp.ck('5w an expired link returns no record', 'false', (v_j ? 'record')::text);
  perform pg_temp.ck('5x the patient sees both attempts (the person and the preview)', '2',
    pg_temp.q_as(v_pat, format($q$select count(*)::text from public.record_share_lookups where share_id = %L and outcome = 'expired'$q$, pg_temp.f('share'))));
  perform pg_temp.ck('5y the other patient does not', '0',
    pg_temp.q_as(v_pat2, format($q$select count(*)::text from public.record_share_lookups where share_id = %L$q$, pg_temp.f('share'))));
  -- revoked
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals'], 24)::text$q$)::jsonb;
  perform pg_temp.q_as(v_pat, format($q$select public.revoke_record_share(%L)$q$, (v_j ->> 'id')::uuid));
  v_t := public.record_share_open(v_j ->> 'token')::text;
  perform pg_temp.ck('5z a revoked link is gone immediately and the attempt is logged', 'gone:revoked:1',
    (v_t::jsonb ->> 'status') || ':' || (v_t::jsonb ->> 'reason') || ':'
    || (select count(*)::text from public.record_share_lookups where share_id = (v_j ->> 'id')::uuid and outcome = 'revoked'));
  perform pg_temp.ck('5aa another patient cannot revoke it', 'true',
    (pg_temp.try_as(v_pat2, format($q$select public.revoke_record_share(%L)$q$, pg_temp.f('share'))) like '%not found or already revoked%')::text);
  -- view cap
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals'], 24, null, 2)::text$q$)::jsonb;
  perform public.record_share_open(v_j ->> 'token'); perform public.record_share_open(v_j ->> 'token');
  perform pg_temp.ck('5ab the view cap closes the link after the last view', 'gone:view_cap',
    (public.record_share_open(v_j ->> 'token') ->> 'status') || ':' || (public.record_share_open(v_j ->> 'token') ->> 'reason'));
  perform pg_temp.ck('5ac exactly the capped number of views were counted', '2', (select view_count::text from public.record_shares where id = (v_j ->> 'id')::uuid));
  -- PIN
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals'], 24, '4821')::text$q$)::jsonb;
  v_tok := v_j ->> 'token'; v_s := (v_j ->> 'id')::uuid;
  perform pg_temp.ck('5ad the PIN is stored hashed, never plain', 'true',
    (select (pin_hash is not null and pin_hash <> '4821' and pin_hash like '$2%')::text from public.record_shares where id = v_s));
  perform pg_temp.ck('5ae no PIN: pin_required, and nothing is shown or counted', 'pin_required:false:0',
    (public.record_share_open(v_tok) ->> 'status') || ':' || (public.record_share_open(v_tok) ? 'record')::text || ':' || (select view_count::text from public.record_shares where id = v_s));
  perform pg_temp.ck('5af a wrong PIN says how many tries are left', 'pin_wrong:3', (public.record_share_open(v_tok, '0000') ->> 'status') || ':' || (public.record_share_open(v_tok, '1111') ->> 'attempts_left'));
  perform pg_temp.ck('5ag the right PIN opens it', 'ok', public.record_share_open(v_tok, '4821') ->> 'status');
  perform pg_temp.ck('5ah a right PIN resets the counter', '0', (select pin_failed_attempts::text from public.record_shares where id = v_s));
  for i in 1..5 loop perform public.record_share_open(v_tok, '9999'); end loop;
  perform pg_temp.ck('5ai five wrong PINs lock the link', 'locked', public.record_share_open(v_tok, '4821') ->> 'status');
  perform pg_temp.ck('5aj the lockout and the wrong tries are logged', 'true',
    (select (count(*) filter (where outcome = 'pin_wrong') >= 5 and count(*) filter (where outcome = 'locked') >= 1)::text from public.record_share_lookups where share_id = v_s));

  -- ===== 6. emergency card ======================================================================================================
  v_card := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.emergency_cards (patient_id, organisation_id, token, expires_at) values (v_pat, v_org, v_card, now() + interval '30 days');
  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source) values (v_org, v_pat, 'S43 penicillin', 'hives', 'severe', 'patient');
  v_j := public.emergency_card_by_token(v_card);
  -- S47 (emergency card defaults): with no choice made the DEFAULTS apply, not everything. On: allergies, medicines, blood group and genotype, contacts.
  -- Off until chosen: conditions or diagnoses, anything reproductive or mental health. Hidden fields are listed so every surface can say "not shared".
  perform pg_temp.ck('6a with no choice made the defaults apply: allergies present, three details not shared', 'true:conditions,mental_health,reproductive',
    (jsonb_array_length(v_j -> 'allergies') >= 1)::text || ':' || (select string_agg(h, ',' order by h) from jsonb_array_elements_text(v_j -> 'hidden_fields') h));
  perform pg_temp.ck('6a2 ...and blood, medicines and the contact are not hidden by default', 'false,false,false,false',
    (v_j -> 'hidden_fields' ? 'blood')::text || ',' || (v_j -> 'hidden_fields' ? 'medications')::text || ',' || (v_j -> 'hidden_fields' ? 'emergency_contact')::text || ',' || (v_j -> 'hidden_fields' ? 'allergies')::text);
  perform pg_temp.ck('6a3 ...conditions read empty (not shared), never "none recorded"', '0',
    jsonb_array_length(v_j -> 'conditions')::text);
  perform pg_temp.ck('6a4 the column defaults match: conditions, reproductive and mental health off; blood, allergies, medicines, contact on', 'false,false,false|true,true,true,true',
    (select string_agg(column_default, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'emergency_card_fields' and column_name in ('show_conditions', 'show_reproductive', 'show_mental_health'))
    || '|' || (select string_agg(column_default, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'emergency_card_fields' and column_name in ('show_blood', 'show_allergies', 'show_medications', 'show_emergency_contact')));
  perform pg_temp.ck('6a5 the classifier calls pregnancy reproductive, depression mental health, hypertension neither', 'reproductive,mental_health,none',
    coalesce(private.emergency_card_sensitive_condition('pregnancy'), 'none') || ',' || coalesce(private.emergency_card_sensitive_condition('major depression'), 'none') || ',' || coalesce(private.emergency_card_sensitive_condition('hypertension'), 'none'));
  perform pg_temp.act(v_pat);
  insert into public.emergency_card_fields (patient_id, organisation_id, show_date_of_birth, show_sex, show_patient_number, show_allergies, show_medications, show_conditions, show_blood, show_emergency_contact)
  values (v_pat, v_org, false, false, false, true, false, false, false, true);
  perform pg_temp.back();
  v_t := pg_temp.q_anon(format($q$select public.emergency_card_by_token(%L)::text$q$, v_card));
  if v_t like 'ERR:%' then raise exception 'anon card read failed: %', v_t; end if;
  v_j := v_t::jsonb;
  perform pg_temp.ck('6b the chosen fields stay', 'true', (jsonb_array_length(v_j -> 'allergies') >= 1)::text);
  perform pg_temp.ck('6c the others are gone: no date of birth, sex, patient number', 'false:false:false', (v_j ? 'date_of_birth')::text || ':' || (v_j ? 'sex')::text || ':' || (v_j ? 'patient_number')::text);
  perform pg_temp.ck('6d medicines, conditions and blood are empty', '0:0:null', jsonb_array_length(v_j -> 'medications')::text || ':' || jsonb_array_length(v_j -> 'conditions')::text || ':' || coalesce((v_j -> 'blood')::text, 'null'));
  perform pg_temp.ck('6e the card says which fields were not shared', 'true', (v_j -> 'hidden_fields' ? 'blood' and v_j -> 'hidden_fields' ? 'medications')::text);
  perform pg_temp.ck('6f the renamed full function is not callable by anon', 'true',
    (pg_temp.q_anon(format($q$select public.emergency_card_full_by_token(%L)$q$, v_card)) like '%permission denied%')::text);
  perform pg_temp.ck('6g nor by a signed-in user', 'true',
    (pg_temp.try_as(v_pat2, format($q$select public.emergency_card_full_by_token(%L)$q$, v_card)) like '%permission denied%')::text);
  perform pg_temp.ck('6h another patient cannot read or edit these choices', '0:0',
    pg_temp.q_as(v_pat2, format($q$select count(*)::text from public.emergency_card_fields where patient_id = %L$q$, v_pat)) || ':'
    || pg_temp.q_as(v_pat2, format($q$with u as (update public.emergency_card_fields set show_blood = true where patient_id = %L returning 1) select count(*)::text from u$q$, v_pat)));
  perform pg_temp.ck('6i lock-screen presence is off until chosen', 'false', (select lock_screen_opt_in::text from public.emergency_card_fields where patient_id = v_pat));

  -- ===== 7. biomarker trends ====================================================================================================
  insert into public.care_plans (organisation_id, patient_id, condition, status, target_ranges) values (v_org, v_pat, 'diabetes', 'active', '{"hba1c": {"max": 7}}'::jsonb);
  v_j := pg_temp.q_as(v_pat, $q$select public.patient_biomarker_trend('HbA1c')::text$q$)::jsonb;
  perform pg_temp.ck('7a three released readings across years, the preliminary one excluded', '3', jsonb_array_length(v_j -> 'points')::text);
  perform pg_temp.ck('7b ordered oldest first', 'true', ((v_j -> 'points' -> 0 ->> 'value')::numeric = 6.1)::text);
  perform pg_temp.ck('7c each point keeps the lab''s own range', 'true', ((v_j -> 'points' -> 0 ->> 'ref_low')::numeric = 4.0 and (v_j -> 'points' -> 0 ->> 'ref_high')::numeric = 5.6)::text);
  perform pg_temp.ck('7d the third point is in its own unit with its own range', 'mmol/mol:20', (v_j -> 'points' -> 2 ->> 'unit') || ':' || ((v_j -> 'points' -> 2 ->> 'ref_low')::numeric)::integer);
  perform pg_temp.ck('7e mixed units are flagged, not converted', 'true', (v_j ->> 'unit_mixed'));
  perform pg_temp.ck('7f the care team''s target is carried and labelled as the care team''s', 'care_team:7', (v_j -> 'target' ->> 'set_by') || ':' || (v_j -> 'target' ->> 'max'));
  perform pg_temp.ck('7h the other patient''s reading is not in the series', 'false', (v_j::text like '%7.7%')::text);
  perform pg_temp.ck('7i a stranger is refused', 'true', (pg_temp.try_as(v_pat2, format($q$select public.patient_biomarker_trend('hba1c', %L)$q$, v_pat)) like '%not authorised%')::text);
  perform pg_temp.ck('7j anon is refused', 'true', (pg_temp.q_anon($q$select public.patient_biomarker_trend('hba1c')$q$) like '%permission denied%')::text);
  perform pg_temp.ck('7k a released result item joins the series; held, withdrawn and sensitive items do not', '1',
    (pg_temp.q_as(v_pat, $q$select jsonb_array_length(public.patient_biomarker_trend('LDL') -> 'points')::text$q$)));
  perform pg_temp.ck('7l the sensitive positive analyte has no trend', '0', (pg_temp.q_as(v_pat, $q$select jsonb_array_length(public.patient_biomarker_trend('HIV') -> 'points')::text$q$)));
  perform pg_temp.ck('7m the list names the analytes the person has', 'true',
    (pg_temp.q_as(v_pat, $q$select (public.patient_biomarker_list()::text like '%hba1c%' and public.patient_biomarker_list()::text like '%ldl%')::text$q$)));

  perform pg_temp.ck('7n the list carries the lab''s own range for the latest result (the doctor summary reads it)', 'true:true',
    pg_temp.q_as(v_pat, $q$select ((x ->> 'latest_ref_low')::numeric = 20 and (x ->> 'latest_ref_high')::numeric = 38)::text || ':' || (x ->> 'latest_unit' = 'mmol/mol')::text
       from jsonb_array_elements(public.patient_biomarker_list()) x where x ->> 'code' = 'hba1c'$q$));
  perform pg_temp.ck('7o the list never carries the sensitive positive analyte', '0',
    pg_temp.q_as(v_pat, $q$select count(*)::text from jsonb_array_elements(public.patient_biomarker_list()) x where lower(x ->> 'code') = 'hiv'$q$));

  -- ===== 8. vaccination =========================================================================================================
  select id into v_cat from public.vaccination_catalog where is_active order by code limit 1;
  insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered, provider, batch_lot_number)
  values (v_org, v_pat, v_cat, 1, current_date - 30, 'S43 clinic', 'LOT-1') returning id into v_vac;
  perform pg_temp.ck('8a the immunisations view maps the spec names', 'S43 clinic:LOT-1:patient',
    (select given_where || ':' || batch || ':' || source from public.immunisations where id = v_vac));
  perform pg_temp.ck('8b immunisation.recorded was emitted', '1', (select count(*)::text from public.domain_events where event_type = 'immunisation.recorded' and aggregate_id = v_vac));
  perform pg_temp.ck('8c the other patient cannot see it through the view', '0', pg_temp.q_as(v_pat2, format($q$select count(*)::text from public.immunisations where id = %L$q$, v_vac)));
  perform pg_temp.ck('8d anon cannot read the view', 'true', (pg_temp.q_anon('select count(*) from public.immunisations') like '%permission denied%')::text);
  perform pg_temp.ck('8e version 2 exists as an UNSIGNED draft', 'false:true',
    (select is_active::text || ':' || (approved_by is null)::text from public.vaccination_schedule_signoffs where version = 2));
  perform pg_temp.ck('8f the draft has HPV as two doses and typhoid excluded', '2:typhoid',
    (select (select (d ->> 'dose_count') from jsonb_array_elements(schedule_config -> 'doses') d where d ->> 'vaccine' = 'HPV') || ':' || (schedule_config -> 'excluded' -> 0 ->> 'code')
       from public.vaccination_schedule_signoffs where version = 2));
  perform pg_temp.ck('8g typhoid is not among the scheduled doses', '0',
    (select count(*)::text from public.vaccination_schedule_signoffs s, jsonb_array_elements(s.schedule_config -> 'doses') d where s.version = 2 and d ->> 'catalog_code' = 'typhoid'));
  perform pg_temp.ck('8h version 2 cannot be made active without being signed', 'true',
    (pg_temp.try_sql_owner($q$update public.vaccination_schedule_signoffs set is_active = true where version = 2$q$) like '%active_requires_signature%')::text);
  perform pg_temp.ck('8i a version 2 or later cannot be active without a config', 'true',
    (pg_temp.try_sql_owner(format($q$insert into public.vaccination_schedule_signoffs (version, approved_by, approved_at, is_active) values (9, (select id from public.clinical_staff where profile_id = %L), now(), true)$q$, v_doc)) like '%v2_active_needs_config%')::text);
  perform pg_temp.ck('8j no signed schedule: the status says so', 'false', (public.vaccination_schedule_status() ->> 'signed'));
  -- reminders: a dose due tomorrow
  insert into public.vaccination_schedules (organisation_id, patient_id, vaccination_catalog_id, due_date, status) values (v_org, v_pat, v_cat, current_date + 3, 'pending');
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template like 'vaccination_%';
  perform private.queue_vaccination_reminders();
  perform pg_temp.ck('8k NO reminder is queued while the schedule is unsigned', '0', ((select count(*) from public.notifications where recipient_id = v_pat and template like 'vaccination_%') - v_n)::text);
  perform pg_temp.ck('8l the reminder stage was left untouched', 'null', coalesce((select reminder_stage::text from public.vaccination_schedules where patient_id = v_pat limit 1), 'null'));
  -- a signed v2 (the proof signs it as a fixture; the real signing is the CMO's)
  select id into v_staff from public.clinical_staff where profile_id = v_doc;
  update public.vaccination_schedule_signoffs set is_active = false where is_active;
  update public.vaccination_schedule_signoffs set approved_by = v_staff, approved_at = now(), is_active = true where version = 2;
  perform pg_temp.ck('8m a signed schedule with a config is reported signed', 'true', (public.vaccination_schedule_status() ->> 'signed'));
  perform private.queue_vaccination_reminders();
  perform pg_temp.ck('8n reminders resume once a signed schedule exists', 'true', ((select count(*) from public.notifications where recipient_id = v_pat and template like 'vaccination_%') - v_n > 0)::text);
  update public.vaccination_schedule_signoffs set is_active = false where version = 2;
  update public.vaccination_schedule_signoffs set approved_by = null, approved_at = null where version = 2;

  -- ===== 9. execute grants ======================================================================================================
  perform pg_temp.ck('9a no new clinical or patient function is callable by anon', '',
    coalesce((select string_agg(fn, ',') from unnest(array[
      'public.record_document_suggestion(uuid, text, jsonb, text, boolean)', 'public.confirm_document_extraction(uuid, jsonb)', 'public.reject_document_extraction(uuid)',
      'public.remove_history_item(text, uuid, text)', 'public.clinician_record_procedure(uuid, text, date, text, text)', 'public.verify_history_item(text, uuid, text)',
      'public.read_patient_history_audited(uuid, text)', 'public.patient_symptom_journal(integer)', 'public.create_record_share(text[], integer, text, integer)',
      'public.revoke_record_share(uuid)', 'public.patient_biomarker_list(uuid)', 'public.patient_biomarker_trend(text, uuid, date)', 'public.vaccination_schedule_status()',
      'public.emergency_card_full_by_token(text)']) fn where has_function_privilege('anon', fn::regprocedure, 'EXECUTE')), ''));
  perform pg_temp.ck('9b the share door and the card wrapper are the anon-callable ones', 'true:true:true',
    has_function_privilege('anon', 'public.record_share_open(text, text, boolean)', 'EXECUTE')::text || ':' || has_function_privilege('anon', 'public.record_share_by_token(text)', 'EXECUTE')::text
    || ':' || has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE')::text);
  perform pg_temp.ck('9c RLS is on for every new table', '0',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('procedures', 'emergency_card_fields', 'record_share_config') and not c.relrowsecurity));

  -- ===== 10. sabotage ===========================================================================================================
  -- A. drop the reading-column guard: a forged update must then succeed (so check 2g would fail)
  drop trigger patient_documents_ocr_columns_guard on public.patient_documents;
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state)
  values (v_org, v_pat, 'other', v_pat || '/s43-sab.jpg', 'patient', 'pending') returning id into v_s2;
  insert into results values ('sabotaged', '2g forged ocr_state write without the guard', 'refused',
    case when pg_temp.try_sql_owner(format($q$update public.patient_documents set ocr_state = 'suggested' where id = %L$q$, v_s2)) = 'ok' then 'accepted' else 'refused' end);
  -- B. an expired link read as live (the expiry condition defeated): the "expired" check would read ok instead of gone
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals'], 24)::text$q$)::jsonb;
  update public.record_shares set expires_at = now() - interval '1 minute' where id = (v_j ->> 'id')::uuid;
  perform pg_temp.ck('5ua control: a fresh expired link is gone', 'gone', public.record_share_open(v_j ->> 'token') ->> 'status');
  update public.record_shares set expires_at = now() + interval '1 day' where id = (v_j ->> 'id')::uuid;
  insert into results values ('sabotaged', '5u an expired link', 'gone', public.record_share_open(v_j ->> 'token') ->> 'status');
  -- C. bypass the reminder gate: calling the inner function queues reminders with no signed schedule
  update public.vaccination_schedules set reminder_stage = null where patient_id = v_pat;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template like 'vaccination_%';
  perform private.queue_vaccination_reminders_when_signed();
  -- D. a preview that commits (a GET that behaves like a deliberate opening) spends a view: the 5pb check would fail
  v_j := pg_temp.q_as(v_pat, $q$select public.create_record_share(array['vitals'], 24, null, 5)::text$q$)::jsonb;
  perform public.record_share_open(v_j ->> 'token', null, true);
  insert into results values ('sabotaged', '5pb a preview spends no view', '0',
    (select view_count::text from public.record_shares where id = (v_j ->> 'id')::uuid));
  -- E (S47): the wrapper made to show everything when no choice exists (the old behaviour). The "defaults apply" check must then flip.
  create or replace function public.emergency_card_by_token(p_token text) returns jsonb language sql security definer set search_path = '' as
    $f$ select public.emergency_card_full_by_token(p_token) $f$;
  insert into results values ('sabotaged', '6a with no choice made the defaults apply: allergies present, three details not shared', 'true:conditions,mental_health,reproductive',
    'true:' || coalesce((select string_agg(h, ',' order by h) from jsonb_array_elements_text(coalesce(public.emergency_card_by_token(v_card) -> 'hidden_fields', '[]'::jsonb)) h), 'nothing'));
  insert into results values ('sabotaged', '8k reminders while unsigned', '0',
    ((select count(*) from public.notifications where recipient_id = v_pat and template like 'vaccination_%') - v_n)::text);
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FLIPPED' end as result
from results where phase = 'sabotaged'
union all
select 'real', count(*)::text || ' checks', 'all pass', 'all pass', 'PASS' from results where phase = 'real';


do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S43 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n  ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks', v_caught; end if;
end $$;


rollback;
