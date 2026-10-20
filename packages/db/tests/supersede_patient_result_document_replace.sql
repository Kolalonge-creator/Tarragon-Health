-- Proof: a patient's replacement of a result document SUPERSEDES it (migration *_supersede_patient_result_document_replace.sql).
-- One rolled-back transaction. Proves with simulated sessions:
--   A. the patient's own unreviewed upload is replaced by a NEW document: old row kept with its file, both pointers set, the new document has
--      its own review alert at the HIGHER of the two priorities, the old alert is resolved with a note, an open consult request follows
--      the new file, one audit row is written;
--   B. refusals: another patient, an already replaced document, a reviewed document, a path outside the caller's folder, anon;
--   C. the in-place paths are closed: a patient UPDATE of file_path does nothing, a patient cannot stamp superseded_by_document_id on her
--      own document (which would drop it from the review queue); CONTROL: org staff can still supersede one document with another;
--   D. READS: the replaced, never-reviewed document is hidden from the patient and from the tied clinician but still exists for the owner;
--      CONTROL: a reviewed superseded document stays visible to staff; the replacement stays visible to the patient.
-- SABOTAGE (each must flip): the old alert is not resolved, the supersede link/stamp pin removed, the file_path pin removed, the hide policy dropped.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rpl-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'Rpl ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'Rpl ' || p_label, true, now(), 'senior_medical_officer');
  end if;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

-- fixtures
do $$
declare
  v_org uuid; v_p uuid; v_p2 uuid; v_c uuid; v_prog uuid; v_old uuid; v_old_alert uuid; v_high public.alert_level; v_req uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'patient two', 'patient');
  v_c := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('p', v_p); perform pg_temp.setf('p2', v_p2); perform pg_temp.setf('c', v_c);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_p, v_c, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- review access for the patient (a legacy active programme purchase, as other proofs do), so the upload raises a review alert
  select id into v_prog from public.chronic_condition_programmes limit 1;
  set local session_replication_role = replica;
  insert into public.programme_purchases (organisation_id, patient_id, programme_id, status, price_kobo, duration_weeks, starts_at, ends_at, purchased_at)
  values (v_org, v_p, v_prog, 'active', 100, 12, current_date - 10, current_date + 40, now() - interval '10 days');
  set local session_replication_role = origin;

  -- the patient's unreviewed upload (the owner inserts it; the real BEFORE INSERT trigger opens the alert)
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source, uploaded_by, note)
  values (v_org, v_p, v_p::text || '/original.pdf', 'original.pdf', 'application/pdf', 1000, 'patient', v_p, 'first try')
  returning id, clinician_alert_id into v_old, v_old_alert;
  perform pg_temp.setf('old', v_old);
  if v_old_alert is null then raise exception 'fixture FAIL: the upload opened no review alert, so the handover cannot be proved'; end if;
  perform pg_temp.setf('old_alert', v_old_alert);

  -- the first file looked critical: the old alert was raised to the highest level
  v_high := (enum_range(null::public.alert_level))[array_length(enum_range(null::public.alert_level), 1)];
  update public.clinician_alerts set level = v_high where id = v_old_alert;

  -- a paid consult request claimed against the old document
  set local session_replication_role = replica;
  insert into public.lab_result_consult_requests (organisation_id, patient_id, status, lab_result_document_id)
  values (v_org, v_p, 'document_uploaded', v_old) returning id into v_req;
  set local session_replication_role = origin;
  perform pg_temp.setf('req', v_req);
end $$;

-- A. the replacement
do $$
declare
  v_p uuid := pg_temp.f('p'); v_old uuid := pg_temp.f('old'); v_new text; v_na uuid; v_high public.alert_level;
begin
  v_high := (enum_range(null::public.alert_level))[array_length(enum_range(null::public.alert_level), 1)];
  v_new := pg_temp.as_user(v_p, format('select public.replace_my_result_document(%L, %L, ''new.pdf'', ''application/pdf'', 2000, ''second try'')::text', v_old, v_p::text || '/new.pdf'));
  perform pg_temp.ck('real', 'A1 the replace returns a new document id', 'true', (v_new is not null and v_new not like 'ERR%')::text);
  if v_new like 'ERR%' then raise exception 'replace failed: %', v_new; end if;
  perform pg_temp.setf('new', v_new::uuid);

  perform pg_temp.ck('real', 'A2 the old row still exists with its original file', v_p::text || '/original.pdf', (select file_path from public.lab_result_documents where id = v_old));
  perform pg_temp.ck('real', 'A3 the old row points at the new one', 'true', (select (superseded_by_document_id = v_new::uuid and superseded_at is not null)::text from public.lab_result_documents where id = v_old));
  perform pg_temp.ck('real', 'A4 the new row points back and carries the new file', 'true', (select (supersedes_document_id = v_old and file_path = v_p::text || '/new.pdf' and source = 'patient' and reviewed_at is null)::text from public.lab_result_documents where id = v_new::uuid));
  perform pg_temp.ck('real', 'A5 the note was replaced when a new one was given', 'second try', (select note from public.lab_result_documents where id = v_new::uuid));

  select clinician_alert_id into v_na from public.lab_result_documents where id = v_new::uuid;
  perform pg_temp.setf('new_alert', v_na);
  perform pg_temp.ck('real', 'A6 the new document has its own review alert', 'true', (v_na is not null and v_na <> pg_temp.f('old_alert'))::text);
  perform pg_temp.ck('real', 'A7 the new alert keeps the HIGHER priority (a critical review cannot be lowered by replacing the file)', v_high::text, (select level::text from public.clinician_alerts where id = v_na));
  perform pg_temp.ck('real', 'A8 the new alert is open', 'open', (select status::text from public.clinician_alerts where id = v_na));
  perform pg_temp.ck('real', 'A9 the old alert is resolved with a note naming the replacement', 'true', (select (status = 'resolved' and detail like '%replaced the uploaded file%')::text from public.clinician_alerts where id = pg_temp.f('old_alert')));
  perform pg_temp.ck('real', 'A10 the new alert carries the earlier detail trail', 'true', (select (detail like '%Earlier alert detail%')::text from public.clinician_alerts where id = v_na));
  perform pg_temp.ck('real', 'A11 exactly one open review alert remains for the patient documents', '1', (select count(*)::text from public.clinician_alerts where id in (pg_temp.f('old_alert'), v_na) and status <> 'resolved'));
  perform pg_temp.ck('real', 'A12 the paid consult request follows the new file', v_new, (select lab_result_document_id::text from public.lab_result_consult_requests where id = pg_temp.f('req')));
  perform pg_temp.ck('real', 'A13 one audit row is written, with the patient as subject', '1',
    (select count(*)::text from public.audit_log where action = 'lab_result_document.superseded' and entity_id = v_new::uuid and subject_patient_id = v_p));
  perform pg_temp.ck('real', 'A14 no stored file row is deleted: two documents exist for the patient', '2', (select count(*)::text from public.lab_result_documents where patient_id = v_p));
  perform pg_temp.ck('real', 'A15 the new alert is not flagged as a duplicate of the old one', 'true', (select (duplicate_of is null and not suppressed)::text from public.clinician_alerts where id = v_na));
  perform pg_temp.ck('real', 'A16 the new alert severity follows the carried-over level', (case v_high::text when 'emergency' then '4' when 'urgent_escalation' then '3' when 'clinician_review' then '2' else '1' end),
    (select severity::text from public.clinician_alerts where id = v_na));
  perform pg_temp.ck('real', 'A17 the old alert is resolved with a documented handover action', 'true',
    (select (resolution_outcome = 'no_action_needed' and resolution_action like 'Handed over:%')::text from public.clinician_alerts where id = pg_temp.f('old_alert')));
  perform pg_temp.ck('real', 'A18 the review-prompt trigger skips handover resolutions', 'true',
    (position('Handed over:' in pg_get_functiondef('private.reputation_review_on_clinician_alert_resolved()'::regprocedure)) > 0)::text);
  perform pg_temp.ck('real', 'A19 the work counts skip a replaced unreviewed document (no phantom item)', 'true',
    (position('superseded_by_document_id' in pg_get_functiondef('public.org_open_work_counts()'::regprocedure)) > 0
     and position('superseded_by_document_id' in pg_get_functiondef('public.clinical_worklist()'::regprocedure)) > 0)::text);
end $$;

-- D. reads
do $$
declare v_p uuid := pg_temp.f('p'); v_c uuid := pg_temp.f('c'); v_old uuid := pg_temp.f('old'); v_new uuid := pg_temp.f('new');
begin
  perform pg_temp.ck('real', 'D1 the patient no longer sees the replaced unreviewed document', '0', pg_temp.as_user(v_p, format('select count(*) from public.lab_result_documents where id = %L', v_old)));
  perform pg_temp.ck('real', 'D2 the tied clinician no longer sees it', '0', pg_temp.as_user(v_c, format('select count(*) from public.lab_result_documents where id = %L', v_old)));
  perform pg_temp.ck('real', 'D3 CONTROL: the replacement is visible to the patient', '1', pg_temp.as_user(v_p, format('select count(*) from public.lab_result_documents where id = %L', v_new)));
  perform pg_temp.ck('real', 'D4 CONTROL: the replacement is visible to the tied clinician', '1', pg_temp.as_user(v_c, format('select count(*) from public.lab_result_documents where id = %L', v_new)));
  perform pg_temp.ck('real', 'D5 the original row is retained for the owner', '1', (select count(*)::text from public.lab_result_documents where id = v_old));
end $$;

-- B. refusals
do $$
declare
  v_p uuid := pg_temp.f('p'); v_p2 uuid := pg_temp.f('p2'); v_old uuid := pg_temp.f('old'); v_new uuid := pg_temp.f('new');
begin
  perform pg_temp.ck('real', 'B1 another patient cannot replace it', 'ERR 42501',
    pg_temp.as_user(v_p2, format('select public.replace_my_result_document(%L, %L, ''x.pdf'', ''application/pdf'', 10)::text', v_new, v_p2::text || '/x.pdf')));
  perform pg_temp.ck('real', 'B2 an already replaced document cannot be replaced again', 'ERR 55000',
    pg_temp.as_user(v_p, format('select public.replace_my_result_document(%L, %L, ''x.pdf'', ''application/pdf'', 10)::text', v_old, v_p::text || '/x.pdf')));
  perform pg_temp.ck('real', 'B3 a path outside the caller folder is refused', 'ERR 22023',
    pg_temp.as_user(v_p, format('select public.replace_my_result_document(%L, %L, ''x.pdf'', ''application/pdf'', 10)::text', v_new, v_p2::text || '/x.pdf')));
  perform pg_temp.ck('real', 'B4 the same stored path is refused', 'ERR 22023',
    pg_temp.as_user(v_p, format('select public.replace_my_result_document(%L, %L, ''x.pdf'', ''application/pdf'', 10)::text', v_new, v_p::text || '/new.pdf')));
  perform pg_temp.ck('real', 'B5 anon cannot execute it', 'ERR 42501',
    pg_temp.as_anon(format('select public.replace_my_result_document(%L, %L, ''x.pdf'', ''application/pdf'', 10)::text', v_new, v_p::text || '/y.pdf')));
  -- a reviewed document is refused
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = pg_temp.f('c') where id = v_new;
  perform pg_temp.ck('real', 'B6 a reviewed document cannot be replaced', 'ERR 55000',
    pg_temp.as_user(v_p, format('select public.replace_my_result_document(%L, %L, ''x.pdf'', ''application/pdf'', 10)::text', v_new, v_p::text || '/z.pdf')));
end $$;

-- C. the in-place paths are closed; the staff supersede still works
do $$
declare
  v_p uuid := pg_temp.f('p'); v_org uuid := pg_temp.f('org'); v_c uuid := pg_temp.f('c');
  v_d1 uuid; v_d2 uuid; v_a uuid; v_b uuid; r text;
begin
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source, uploaded_by) values (v_org, v_p, v_p::text || '/d1.pdf', 'patient', v_p) returning id into v_d1;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source, uploaded_by) values (v_org, v_p, v_p::text || '/d2.pdf', 'patient', v_p) returning id into v_d2;
  perform pg_temp.setf('d1', v_d1); perform pg_temp.setf('d2', v_d2);

  r := pg_temp.as_user(v_p, format('update public.lab_result_documents set file_path = %L where id = %L returning 1::text', v_p::text || '/hack.pdf', v_d1));
  perform pg_temp.ck('real', 'C1 a patient UPDATE of file_path does not move it', v_p::text || '/d1.pdf', (select file_path from public.lab_result_documents where id = v_d1));
  r := pg_temp.as_user(v_p, format('update public.lab_result_documents set superseded_by_document_id = %L, superseded_at = now() where id = %L returning 1::text', v_d2, v_d1));
  perform pg_temp.ck('real', 'C2 a patient cannot mark her own unreviewed document as replaced', 'true', (select (superseded_by_document_id is null and superseded_at is null)::text from public.lab_result_documents where id = v_d1));
  r := pg_temp.as_user(v_p, format('update public.lab_result_documents set note = ''edited note'' where id = %L returning 1::text', v_d1));
  perform pg_temp.ck('real', 'C3 CONTROL: the patient can still edit her note', 'edited note', (select note from public.lab_result_documents where id = v_d1));

  -- the second route to the same hole: a patient naming one of her documents as superseding another
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source, uploaded_by) values (v_org, v_p, v_p::text || '/e1.pdf', 'patient', v_p) returning id into v_a;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source, uploaded_by) values (v_org, v_p, v_p::text || '/e2.pdf', 'patient', v_p) returning id into v_b;
  perform pg_temp.setf('e1', v_a); perform pg_temp.setf('e2', v_b);
  r := pg_temp.as_user(v_p, format('update public.lab_result_documents set supersedes_document_id = %L where id = %L returning 1::text', v_a, v_b));
  perform pg_temp.ck('real', 'C5 a patient cannot link one of her documents as superseding another (it would hide the first)', 'true',
    (select ((select superseded_by_document_id from public.lab_result_documents where id = v_a) is null and (select supersedes_document_id from public.lab_result_documents where id = v_b) is null)::text));

  -- staff supersede one document with another (module 57.14), as before
  r := pg_temp.as_user(v_c, format('update public.lab_result_documents set supersedes_document_id = %L where id = %L returning 1::text', v_d1, v_d2));
  perform pg_temp.ck('real', 'C4 CONTROL: org staff can still supersede a document with a later one', v_d2::text, (select superseded_by_document_id::text from public.lab_result_documents where id = v_d1));

  -- d1 was never reviewed, so it is now hidden from staff; once reviewed it must be visible again (a doctor relied on it)
  perform pg_temp.ck('real', 'C6 a staff-superseded document that was never reviewed is hidden from the tied clinician', '0', pg_temp.as_user(v_c, format('select count(*) from public.lab_result_documents where id = %L', v_d1)));
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_c where id = v_d1;
  perform pg_temp.ck('real', 'C7 CONTROL: a reviewed superseded document stays visible to the tied clinician', '1', pg_temp.as_user(v_c, format('select count(*) from public.lab_result_documents where id = %L', v_d1)));
end $$;

-- SABOTAGE 1: the old alert is not resolved by the replace (a duplicate open review would remain)
do $$
declare
  v_def text; v_p uuid := pg_temp.f('p'); v_org uuid := pg_temp.f('org'); v_doc uuid; v_alert uuid; v_new text; v_status text;
begin
  select pg_get_functiondef('public.replace_my_result_document(uuid,text,text,text,bigint,text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'set status = ''resolved'',', 'set status = status,');
  execute v_def;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source, uploaded_by) values (v_org, v_p, v_p::text || '/s1.pdf', 'patient', v_p) returning id, clinician_alert_id into v_doc, v_alert;
  v_new := pg_temp.as_user(v_p, format('select public.replace_my_result_document(%L, %L, ''s1b.pdf'', ''application/pdf'', 10)::text', v_doc, v_p::text || '/s1b.pdf'));
  select status::text into v_status from public.clinician_alerts where id = v_alert;
  insert into results values ('sabotaged', 'SABOTAGE 1: without the resolve step the old alert is resolved', 'resolved', v_status);
end $$;

-- SABOTAGE 2: the supersede link/stamp pin removed from the trigger; a patient can then hide her own document by naming it as superseded
do $$
declare v_def text; v_p uuid := pg_temp.f('p'); v_a uuid := pg_temp.f('e1'); v_b uuid := pg_temp.f('e2'); r text;
begin
  select pg_get_functiondef('private.enforce_lab_result_document_update()'::regprocedure) into v_def;
  v_def := replace(v_def, 'and not private.is_org_staff(old.organisation_id) then', 'and false then');
  execute v_def;
  r := pg_temp.as_user(v_p, format('update public.lab_result_documents set supersedes_document_id = %L where id = %L returning 1::text', v_a, v_b));
  insert into results values ('sabotaged', 'SABOTAGE 2: without the pin a patient stamps her own document as replaced', 'true',
    (select (superseded_by_document_id is null)::text from public.lab_result_documents where id = v_a));
end $$;

-- SABOTAGE 3: the file_path pin removed; the patient can swap the file in place again
do $$
declare v_def text; v_p uuid := pg_temp.f('p'); v_org uuid := pg_temp.f('org'); v_d uuid; r text;
begin
  select pg_get_functiondef('private.enforce_lab_result_document_update()'::regprocedure) into v_def;
  v_def := replace(v_def, E'  new.file_path := old.file_path;\n  -- The supersede link and stamp', E'  -- The supersede link and stamp');
  execute v_def;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, source, uploaded_by) values (v_org, v_p, v_p::text || '/s3.pdf', 'patient', v_p) returning id into v_d;
  r := pg_temp.as_user(v_p, format('update public.lab_result_documents set file_path = %L where id = %L returning 1::text', v_p::text || '/s3-hack.pdf', v_d));
  insert into results values ('sabotaged', 'SABOTAGE 3: without the pin the patient moves file_path in place', v_p::text || '/s3.pdf', (select file_path from public.lab_result_documents where id = v_d));
end $$;

-- SABOTAGE 4: the hide policy dropped; the patient sees the replaced document again
do $$
begin
  drop policy lab_result_documents_hide_replaced on public.lab_result_documents;
  insert into results values ('sabotaged', 'SABOTAGE 4: without the hide policy the patient does not see the replaced document', '0',
    pg_temp.as_user(pg_temp.f('p'), format('select count(*) from public.lab_result_documents where id = %L', pg_temp.f('old'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'supersede replace proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
