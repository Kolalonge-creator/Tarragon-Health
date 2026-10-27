-- S76 proof: scribe signed diffs, problem reports, CMO count reads, the unapproved document prompt
-- (migration *_s76_scribe_signed_diffs_problem_reports_document_prompt.sql). INV-11.
--
--   1. record_scribe_signed_diff writes version 1 then 2 for the note's own clinician; the signed text is read from the note, not the caller;
--      refuses a draft hash with no review record, a wrong shape, another clinician, a patient, anon, a finalized note; direct insert refused;
--      append-only; clinician-own read, CMO read, other clinician reads none.
--   2. report_scribe_draft_problem: fixed taxonomy enforced by CHECK; refuses a patient and a consent of another note; append-only.
--   3. scribe_diff_edit_rates and scribe_problem_counts: CMO only, counts only.
--   4. The document prompt is inserted unapproved and inactive; scribe_document_prompt returns null until a simulated (rolled back)
--      approval, then returns it. Nothing is approved for real.
--   5. SABOTAGE: the review-record link removed from record_scribe_signed_diff, and the CMO check removed from scribe_diff_edit_rates.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's76-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S76 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S76 ' || p_label, 'MDCN', 'S76-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
create function pg_temp.sections(p_state text default 'unchanged') returns jsonb language sql as
$$ select jsonb_build_object('history', jsonb_build_object('state', p_state, 'flagged_empty', false),
  'examination', jsonb_build_object('state', 'empty_kept', 'flagged_empty', true),
  'assessment', jsonb_build_object('state', 'edited', 'flagged_empty', false),
  'plan', jsonb_build_object('state', 'unchanged', 'flagged_empty', false),
  'followUp', jsonb_build_object('state', 'added', 'flagged_empty', true),
  'patientSummary', jsonb_build_object('state', 'unchanged', 'flagged_empty', false)) $$;
create function pg_temp.review_as(p_uid uuid, p_note uuid, p_consent uuid, p_sections jsonb) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.record_scribe_review(%L, %L, 'claude-sonnet-5-5', 'v1', %L, 'typed', %L::jsonb)::text$q$,
     p_note, p_consent, repeat('a', 64), p_sections::text)) $$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_cmo uuid; v_pat uuid; v_pat2 uuid;
        v_note uuid; v_note2 uuid; v_cons uuid; v_vc uuid; v_enc uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());

  -- a video consultation and an in-progress encounter for the clinician, the note hung off the consultation
  set local session_replication_role = replica;
  insert into public.video_consultations (organisation_id, patient_id, context, initiated_by)
  values (v_org, v_pat, 'general_checkin'::public.video_consultation_context, v_doc) returning id into v_vc;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, video_consultation_id, policy_version, is_test)
  values (v_org, v_pat, v_doc, 'video', 'in_progress', now(), now(), v_vc, 2, true) returning id into v_enc;
  set local session_replication_role = origin;
  perform pg_temp.setf('enc', v_enc);

  -- a draft note by the clinician, and an active clinician-side consent row bound to it
  perform pg_temp.act(v_doc);
  v_note := public.create_encounter_note(v_pat, 'video_consult', 'Review of home readings', null, null, null, null, null, null, v_vc);
  v_note2 := public.create_encounter_note(v_pat, 'video_consult', 'A second note', null, null, null, null, null, null, null);
  perform pg_temp.back();
  set local session_replication_role = replica;
  insert into public.scribe_consents (organisation_id, patient_id, encounter_note_id, clinician_staff_id, clinician_profile_id, granted, language)
  select v_org, v_pat, v_note, cs.id, v_doc, true, 'en-NG' from public.clinical_staff cs where cs.profile_id = v_doc returning id into v_cons;
  set local session_replication_role = origin;
  perform pg_temp.setf('note', v_note); perform pg_temp.setf('note2', v_note2); perform pg_temp.setf('cons', v_cons);
end $$;

-- 0b. (fixtures above)
-- 1. Signed diff -------------------------------------------------------------------------------------------------------
create function pg_temp.diff_json(p_added int default 2) returns jsonb language sql as
$$ select jsonb_build_object(
  'history', jsonb_build_object('draft_words', 3, 'signed_words', 3, 'words_added', 0, 'words_removed', 0, 'ops', jsonb_build_array(jsonb_build_object('op', 'eq', 'n', 3))),
  'examination', jsonb_build_object('draft_words', 0, 'signed_words', 0, 'words_added', 0, 'words_removed', 0, 'ops', '[]'::jsonb),
  'assessment', jsonb_build_object('draft_words', 2, 'signed_words', 2, 'words_added', 0, 'words_removed', 0, 'ops', jsonb_build_array(jsonb_build_object('op', 'eq', 'n', 2))),
  'plan', jsonb_build_object('draft_words', 3, 'signed_words', 3 + p_added, 'words_added', p_added, 'words_removed', 0, 'ops', jsonb_build_array(jsonb_build_object('op', 'eq', 'n', 3), jsonb_build_object('op', 'ins', 'text', 'x y'))),
  'followUp', jsonb_build_object('draft_words', 0, 'signed_words', 0, 'words_added', 0, 'words_removed', 0, 'ops', '[]'::jsonb),
  'patientSummary', jsonb_build_object('draft_words', 0, 'signed_words', 0, 'words_added', 0, 'words_removed', 0, 'ops', '[]'::jsonb)) $$;
create function pg_temp.ai_draft() returns jsonb language sql as
$$ select jsonb_build_object('history', 'Headache for two days', 'examination', '', 'assessment', 'Tension headache', 'plan', 'Rest and fluids', 'followUp', '', 'patientSummary', '') $$;
create function pg_temp.diff_as(p_uid uuid, p_note uuid, p_consent uuid, p_draft_hash text, p_diff jsonb) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.record_scribe_signed_diff(%L, %L, %L, 'claude-sonnet-5-5', 'v1', %L, 'typed', %L::jsonb, %L::jsonb)::text$q$,
     p_note, p_consent, repeat('c', 64), p_draft_hash, pg_temp.ai_draft()::text, p_diff::text)) $$;

do $$
declare r text; v_signed jsonb;
begin
  -- the review record the diff must link to (draft hash 'a' x 64, as the helper above writes)
  perform pg_temp.review_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.sections());
  perform pg_temp.act(pg_temp.f('doc'));
  perform public.update_encounter_note_draft(pg_temp.f('note'), '{"history":"Headache for two days","assessment":"Tension headache","plan":"Rest and fluids and review"}'::jsonb);
  perform pg_temp.back();

  r := pg_temp.diff_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), repeat('a', 64), pg_temp.diff_json());
  insert into results values ('real', 'the note''s clinician records a signed diff', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'it is version 1', '1', (select version::text from public.scribe_signed_diffs where note_id = pg_temp.f('note')));
  select signed_text into v_signed from public.scribe_signed_diffs where note_id = pg_temp.f('note');
  insert into results values ('real', 'the signed text is read from the note, not the caller', 'Rest and fluids and review', v_signed ->> 'plan');
  insert into results values ('real', 'word counts are summed from the diff', '8|2|0',
    (select draft_words::text || '|' || words_added::text || '|' || words_removed::text from public.scribe_signed_diffs where note_id = pg_temp.f('note')));
  r := pg_temp.diff_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), repeat('a', 64), pg_temp.diff_json(1));
  insert into results values ('real', 'a second record is version 2', '2', (select max(version)::text from public.scribe_signed_diffs where note_id = pg_temp.f('note')));
  insert into results values ('real', 'a draft hash with no review record is refused', 'ERR:42501',
    pg_temp.diff_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), repeat('f', 64), pg_temp.diff_json()));
  insert into results values ('real', 'a wrong diff shape is refused', 'ERR:22023',
    pg_temp.diff_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), repeat('a', 64), '{"history":{}}'::jsonb));
  insert into results values ('real', 'a consent for another note is refused', 'ERR:42501',
    pg_temp.diff_as(pg_temp.f('doc'), pg_temp.f('note2'), pg_temp.f('cons'), repeat('a', 64), pg_temp.diff_json()));
  insert into results values ('real', 'a clinician with no tie to the note is refused', 'ERR:42501',
    pg_temp.diff_as(pg_temp.f('other'), pg_temp.f('note'), pg_temp.f('cons'), repeat('a', 64), pg_temp.diff_json()));
  insert into results values ('real', 'a patient is refused', 'ERR:42501',
    pg_temp.diff_as(pg_temp.f('pat'), pg_temp.f('note'), pg_temp.f('cons'), repeat('a', 64), pg_temp.diff_json()));
  insert into results values ('real', 'anon cannot execute', '42501',
    pg_temp.try_anon(format($q$select public.record_scribe_signed_diff(%L, %L, %L, 'm', 'v', %L, 'typed', '{}', '{}')$q$, pg_temp.f('note'), pg_temp.f('cons'), repeat('c', 64), repeat('a', 64))));
  insert into results values ('real', 'direct insert is refused', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('doc'), format($q$insert into public.scribe_signed_diffs (organisation_id, note_id, version, scribe_consent_id, clinician_profile_id, transcript_hash, model_id, prompt_version, draft_hash, source, ai_draft, signed_text, diff, draft_words, words_added, words_removed) values (%L, %L, 9, %L, %L, %L, 'm', 'v', %L, 'typed', %L::jsonb, %L::jsonb, %L::jsonb, 0, 0, 0)$q$,
      pg_temp.f('org'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.f('doc'), repeat('c', 64), repeat('a', 64), pg_temp.ai_draft()::text, pg_temp.ai_draft()::text, pg_temp.diff_json()::text)));
  begin update public.scribe_signed_diffs set model_id = 'x'; r := 'changed'; exception when others then r := sqlstate; end;
  insert into results values ('real', 'the table is append-only even for the owner', '42501', r);
  begin delete from public.scribe_signed_diffs; r := 'deleted'; exception when others then r := sqlstate; end;
  insert into results values ('real', 'and rows cannot be deleted', '42501', r);
  insert into results values ('real', 'the clinician reads their own rows', '2',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.scribe_signed_diffs where note_id = %L$q$, pg_temp.f('note'))));
  insert into results values ('real', 'another clinician reads none', '0',
    pg_temp.q_as(pg_temp.f('other'), format($q$select count(*)::text from public.scribe_signed_diffs where note_id = %L$q$, pg_temp.f('note'))));
  insert into results values ('real', 'the CMO reads them for audit', '2',
    pg_temp.q_as(pg_temp.f('cmo'), format($q$select count(*)::text from public.scribe_signed_diffs where note_id = %L$q$, pg_temp.f('note'))));
  insert into results values ('real', 'a patient reads none', '0',
    pg_temp.q_as(pg_temp.f('pat'), format($q$select count(*)::text from public.scribe_signed_diffs where note_id = %L$q$, pg_temp.f('note'))));
  -- after signing, no more diffs
  perform pg_temp.act(pg_temp.f('doc'));
  perform public.finalize_encounter_note(pg_temp.f('note'), 'reassurance', true);
  perform pg_temp.back();
  insert into results values ('real', 'a diff cannot be added to a finalized note', 'ERR:42501',
    pg_temp.diff_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), repeat('a', 64), pg_temp.diff_json()));
end $$;

-- 2. Problem reports -------------------------------------------------------------------------------------------------------
create function pg_temp.report_as(p_uid uuid, p_note uuid, p_consent uuid, p_kind text, p_section text, p_cat text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.report_scribe_draft_problem(%L, %L, %L, %L, %L, 'a few words')::text$q$, p_note, p_consent, p_kind, p_section, p_cat)) $$;
do $$
begin
  insert into results values ('real', 'a clinician reports a problem (note, plan, wrong medicine)', 'true',
    (pg_temp.report_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), 'note', 'plan', 'wrong_medicine_or_dose') !~ '^ERR')::text);
  insert into results values ('real', 'a report with no section and no consent is accepted', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format($q$select public.report_scribe_draft_problem(%L, null, 'letter', null, 'omission')::text$q$, pg_temp.f('note'))) !~ '^ERR')::text);
  insert into results values ('real', 'a category outside the taxonomy is refused', 'ERR:23514',
    pg_temp.report_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), 'note', 'plan', 'rude'));
  insert into results values ('real', 'a draft kind outside the list is refused', 'ERR:23514',
    pg_temp.report_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), 'poem', 'plan', 'other'));
  insert into results values ('real', 'a section outside the list is refused', 'ERR:23514',
    pg_temp.report_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), 'note', 'heart', 'other'));
  insert into results values ('real', 'a consent of another note is refused', 'ERR:42501',
    pg_temp.report_as(pg_temp.f('doc'), pg_temp.f('note2'), pg_temp.f('cons'), 'note', null, 'other'));
  insert into results values ('real', 'a patient cannot report', 'ERR:42501',
    pg_temp.report_as(pg_temp.f('pat'), pg_temp.f('note'), pg_temp.f('cons'), 'note', null, 'other'));
  insert into results values ('real', 'anon cannot execute', '42501',
    pg_temp.try_anon(format($q$select public.report_scribe_draft_problem(%L, null, 'note', null, 'other')$q$, pg_temp.f('note'))));
  insert into results values ('real', 'the reporter reads own reports', '2',
    pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.scribe_draft_reports'));
  insert into results values ('real', 'another clinician reads none', '0',
    pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.scribe_draft_reports'));
  insert into results values ('real', 'direct insert is refused', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('doc'), format($q$insert into public.scribe_draft_reports (organisation_id, note_id, clinician_profile_id, draft_kind, category) values (%L, %L, %L, 'note', 'other')$q$, pg_temp.f('org'), pg_temp.f('note'), pg_temp.f('doc'))));
end $$;
do $$
declare r text;
begin
  begin update public.scribe_draft_reports set category = 'other'; r := 'changed'; exception when others then r := sqlstate; end;
  insert into results values ('real', 'reports are append-only', '42501', r);
end $$;

-- 3. CMO count reads ---------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; p jsonb;
begin
  -- the rows above are test rows; make them counted rows. The append-only trigger is a row trigger, so it is switched off for this
  -- fixture step only (replica role), which is the owner acting outside the application path.
  set local session_replication_role = replica;
  update public.scribe_signed_diffs set is_test = false;
  update public.scribe_draft_reports set is_test = false;
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select public.scribe_diff_edit_rates()::text')::jsonb;
  insert into results values ('real', 'CMO: two counted signed drafts', '2', r ->> 'drafts');
  insert into results values ('real', 'CMO: plan words added across drafts', '3', r -> 'sections' -> 'plan' ->> 'words_added');
  insert into results values ('real', 'CMO: plan drafts changed', '2', r -> 'sections' -> 'plan' ->> 'drafts_changed');
  insert into results values ('real', 'CMO: history never changed', '0', r -> 'sections' -> 'history' ->> 'drafts_changed');
  insert into results values ('real', 'the rate output holds no text', 'false', (r::text ~ 'Rest and fluids')::text);
  p := pg_temp.q_as(pg_temp.f('cmo'), 'select public.scribe_problem_counts()::text')::jsonb;
  insert into results values ('real', 'CMO: two reports counted', '2', p ->> 'total');
  insert into results values ('real', 'CMO: one wrong medicine report', '1', p -> 'by_category' ->> 'wrong_medicine_or_dose');
  insert into results values ('real', 'CMO: by kind note and letter', '1|1', (p -> 'by_kind' ->> 'note') || '|' || (p -> 'by_kind' ->> 'letter'));
  insert into results values ('real', 'the report counts hold no comment text', 'false', (p::text ~ 'a few words')::text);
  insert into results values ('real', 'a clinician cannot read the diff rates', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), 'select public.scribe_diff_edit_rates()::text'));
  insert into results values ('real', 'a clinician cannot read the problem counts', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), 'select public.scribe_problem_counts()::text'));
  insert into results values ('real', 'a patient cannot read the diff rates', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select public.scribe_diff_edit_rates()::text'));
end $$;

-- 4. The document prompt: unapproved until a human approves --------------------------------------------------------------------
do $$
declare v_id uuid; v_sys uuid;
begin
  select id into v_sys from public.ai_systems where system_code = 'AI-017';
  select id into v_id from public.ai_prompt_versions where ai_system_id = v_sys and output_constraints ->> 'prompt_version' = 'scribe-documents-v1';
  insert into results values ('real', 'the document prompt exists', 'true', (v_id is not null)::text);
  insert into results values ('real', 'it is unapproved and inactive', 'false|null|null|null',
    (select is_active::text || '|' || coalesce(approved_at::text, 'null') || '|' || coalesce(approved_by::text, 'null') || '|' || coalesce(activated_by::text, 'null') from public.ai_prompt_versions where id = v_id));
  insert into results values ('real', 'the edge function reader gets nothing while it is unapproved', 'null',
    coalesce(pg_temp.q_as(pg_temp.f('doc'), 'select public.scribe_document_prompt()::text'), 'null'));
  insert into results values ('real', 'a patient cannot call the reader', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select public.scribe_document_prompt()::text'));
  insert into results values ('real', 'anon cannot execute the reader', '42501', pg_temp.try_anon('select public.scribe_document_prompt()'));
  -- the gate opens once a human approves. Simulated here as the owner, inside this rolled-back proof only; nothing is approved for real.
  update public.ai_prompt_versions set approved_at = now(), activated_by = pg_temp.f('doc'), activated_at = now(), is_active = true where id = v_id;
  insert into results values ('real', 'after a simulated, rolled back approval the reader returns the kinds', 'true',
    pg_temp.q_as(pg_temp.f('doc'), 'select (public.scribe_document_prompt() -> ''output_constraints'' -> ''kinds'' ? ''letter'')::text'));
end $$;

-- 5. SABOTAGE -------------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; r text; v_cons uuid;
begin
  -- the link to the review record removed from record_scribe_signed_diff: a draft hash nobody recorded is then accepted
  v_orig := pg_get_functiondef('public.record_scribe_signed_diff(uuid,uuid,text,text,text,text,text,jsonb,jsonb)'::regprocedure);
  v_def := replace(v_orig, 'if not exists (select 1 from public.scribe_review_events r where r.note_id = p_note and r.draft_hash = p_draft_hash) then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  set local session_replication_role = replica;
  insert into public.scribe_consents (organisation_id, patient_id, encounter_note_id, clinician_staff_id, clinician_profile_id, granted, language)
  select pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('note2'), cs.id, pg_temp.f('doc'), true, 'en-NG' from public.clinical_staff cs where cs.profile_id = pg_temp.f('doc')
  returning id into v_cons;
  set local session_replication_role = origin;
  r := pg_temp.diff_as(pg_temp.f('doc'), pg_temp.f('note2'), v_cons, repeat('f', 64), pg_temp.diff_json());
  insert into results values ('sabotaged', 'a draft hash with no review record is refused', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);

  -- the CMO check removed from scribe_diff_edit_rates
  v_orig := pg_get_functiondef('public.scribe_diff_edit_rates(timestamptz,timestamptz)'::regprocedure);
  v_def := replace(v_orig, 'if not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('doc'), 'select public.scribe_diff_edit_rates()::text');
  insert into results values ('sabotaged', 'a clinician cannot read the diff rates', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
