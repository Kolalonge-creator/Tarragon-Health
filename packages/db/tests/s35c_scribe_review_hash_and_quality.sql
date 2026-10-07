-- S35c proof: scribe review record, signed-content hash, patient consent state for the clinician screen, CMO quality reads
-- (migration *_s35c_scribe_review_record_hash_and_quality.sql). INV-02, INV-10, INV-11.
--
--   1. record_scribe_review writes one row for the note's own clinician with an active consent; refuses a short shape, a wrong
--      consent, a finalized note, another clinician, a patient and anon; the table is append-only and not directly insertable.
--   2. Finalizing stamps signed_content_hash; note_content_matches_hash is true, becomes false if the stored text is changed behind
--      the trigger, and is null for a note with no hash.
--   3. scribe_consent_state reads the PATIENT's answer: no_consultation, not_asked, given, declined.
--   4. scribe_edit_rates and scribe_audit_sample: CMO only; counts add up; the sample holds only AI-drafted, signed, non-test notes and no text.
--   5. SABOTAGE: the hash trigger dropped (the signed note then has no hash), and the CMO check removed from scribe_edit_rates.
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
  values (v, 's35c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S35c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'S35c ' || p_label, 'MDCN', 'S35c-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
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

-- 1. The review record ------------------------------------------------------------------------------------------------
do $$
declare r text; v_rows int;
begin
  r := pg_temp.review_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.sections());
  insert into results values ('real', 'the note''s clinician records a review', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'one row exists', '1', (select count(*)::text from public.scribe_review_events where note_id = pg_temp.f('note')));
  insert into results values ('real', 'a wrong section shape is refused', 'ERR:22023',
    pg_temp.review_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), '{"history":{"state":"unchanged","flagged_empty":false}}'::jsonb));
  insert into results values ('real', 'an unknown state is refused', 'ERR:22023',
    pg_temp.review_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.sections('rewritten')));
  insert into results values ('real', 'a consent for another note is refused', 'ERR:42501',
    pg_temp.review_as(pg_temp.f('doc'), pg_temp.f('note2'), pg_temp.f('cons'), pg_temp.sections()));
  insert into results values ('real', 'a clinician with no tie to the note is refused', 'ERR:42501',
    pg_temp.review_as(pg_temp.f('other'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.sections()));
  -- private.may_work_on_note lets a caller with no clinical_staff row through (a NULL makes its refusal skip); these functions
  -- therefore check for an active clinician themselves, and this check is what keeps a patient out of them
  insert into results values ('real', 'a patient is refused', 'ERR:42501',
    pg_temp.review_as(pg_temp.f('pat'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.sections()));
  insert into results values ('real', 'anon cannot execute', '42501',
    pg_temp.try_anon(format($q$select public.record_scribe_review(%L, %L, 'm', 'v', %L, 'typed', '{}')$q$, pg_temp.f('note'), pg_temp.f('cons'), repeat('a', 64))));
  insert into results values ('real', 'direct insert is refused', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('doc'), format($q$insert into public.scribe_review_events (organisation_id, note_id, scribe_consent_id, clinician_profile_id, model_id, prompt_version, draft_hash, source, sections) values (%L, %L, %L, %L, 'm', 'v', %L, 'typed', '{}')$q$,
      pg_temp.f('org'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.f('doc'), repeat('a', 64))));
  begin update public.scribe_review_events set model_id = 'x'; r := 'changed'; exception when others then r := sqlstate; end;
  insert into results values ('real', 'the table is append-only even for the owner', '42501', r);
  begin delete from public.scribe_review_events; r := 'deleted'; exception when others then r := sqlstate; end;
  insert into results values ('real', 'and rows cannot be deleted', '42501', r);
  insert into results values ('real', 'the clinician reads their own row', '1',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select count(*)::text from public.scribe_review_events where note_id = %L$q$, pg_temp.f('note'))));
  insert into results values ('real', 'another clinician reads none', '0',
    pg_temp.q_as(pg_temp.f('other'), format($q$select count(*)::text from public.scribe_review_events where note_id = %L$q$, pg_temp.f('note'))));
end $$;

-- 2. Hash of what was signed ----------------------------------------------------------------------------------------------
do $$
declare r text; v_hash text;
begin
  perform pg_temp.act(pg_temp.f('doc'));
  perform public.update_encounter_note_draft(pg_temp.f('note'), '{"history":"Headache for two days","assessment":"Tension headache","plan":"Rest and fluids"}'::jsonb);
  insert into results values ('real', 'a draft has no hash', 'null', coalesce((select signed_content_hash from public.clinical_encounter_notes where id = pg_temp.f('note')), 'null'));
  perform public.finalize_encounter_note(pg_temp.f('note'), 'reassurance', true);
  perform pg_temp.back();
  select signed_content_hash into v_hash from public.clinical_encounter_notes where id = pg_temp.f('note');
  insert into results values ('real', 'finalizing stamps a 64 character hash', 'true', (v_hash ~ '^[0-9a-f]{64}$')::text);
  insert into results values ('real', 'the hash matches the stored text', 'true',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select public.note_content_matches_hash(%L)::text$q$, pg_temp.f('note'))));
  -- change the stored text behind the trigger (as the owner, triggers off): the check must notice
  set local session_replication_role = replica;
  update public.clinical_encounter_notes set plan = 'Rest, fluids and a different plan' where id = pg_temp.f('note');
  set local session_replication_role = origin;
  insert into results values ('real', 'altered text no longer matches the hash', 'false',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select public.note_content_matches_hash(%L)::text$q$, pg_temp.f('note'))));
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select coalesce(public.note_content_matches_hash(%L)::text, 'null')$q$, pg_temp.f('note2')));
  insert into results values ('real', 'a note with no hash answers null, not true', 'null', r);
  insert into results values ('real', 'a finalized note still cannot be edited', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select public.update_encounter_note_draft(%L, '{"plan":"x"}')::text$q$, pg_temp.f('note'))));
  insert into results values ('real', 'a review cannot be added to a finalized note', 'ERR:42501',
    pg_temp.review_as(pg_temp.f('doc'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.sections()));
end $$;

-- 3. The patient's consent answer ----------------------------------------------------------------------------------------
do $$
declare v_enc uuid := pg_temp.f('enc');
begin
  insert into results values ('real', 'a note with no consultation: no_consultation', 'no_consultation',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select (public.scribe_consent_state(%L))->>'state'$q$, pg_temp.f('note2'))));
  insert into results values ('real', 'consultation, no answer yet: not_asked', 'not_asked',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select (public.scribe_consent_state(%L))->>'state'$q$, pg_temp.f('note'))));
  insert into public.consultation_scribe_consents (organisation_id, encounter_id, patient_id, granted, answered_at, method, is_test)
  values (pg_temp.f('org'), v_enc, pg_temp.f('pat'), true, now(), 'in_app', true);
  insert into results values ('real', 'the patient allowed it: given', 'given',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select (public.scribe_consent_state(%L))->>'state'$q$, pg_temp.f('note'))));
  update public.consultation_scribe_consents set granted = false where encounter_id = v_enc;
  insert into results values ('real', 'the patient withdrew: declined', 'declined',
    pg_temp.q_as(pg_temp.f('doc'), format($q$select (public.scribe_consent_state(%L))->>'state'$q$, pg_temp.f('note'))));
  insert into results values ('real', 'another clinician cannot read it', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('other'), format($q$select (public.scribe_consent_state(%L))->>'state'$q$, pg_temp.f('note'))));
  insert into results values ('real', 'a patient cannot read it', 'ERR:42501',
    pg_temp.q_as(pg_temp.f('pat'), format($q$select (public.scribe_consent_state(%L))->>'state'$q$, pg_temp.f('note'))));
end $$;

-- 4. CMO quality reads ---------------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  -- the review row above is a test row; make a counted (non-test) copy in the same shape, as the owner
  set local session_replication_role = replica;
  insert into public.scribe_review_events (organisation_id, note_id, scribe_consent_id, clinician_profile_id, model_id, prompt_version, draft_hash, source, sections, is_test)
  values (pg_temp.f('org'), pg_temp.f('note'), pg_temp.f('cons'), pg_temp.f('doc'), 'm', 'v1', repeat('b', 64), 'typed', pg_temp.sections(), false);
  update public.clinical_encounter_notes set ai_drafted = true, is_test = false where id = pg_temp.f('note');
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select public.scribe_edit_rates()::text')::jsonb;
  insert into results values ('real', 'CMO: one counted review', '1', r ->> 'reviews');
  insert into results values ('real', 'CMO: examination kept empty and flagged once', '1|1',
    (r -> 'sections' -> 'examination' ->> 'empty_kept') || '|' || (r -> 'sections' -> 'examination' ->> 'flagged_empty'));
  insert into results values ('real', 'CMO: assessment edited once', '1', r -> 'sections' -> 'assessment' ->> 'edited');
  insert into results values ('real', 'a clinician cannot read the rates', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), 'select public.scribe_edit_rates()::text'));
  insert into results values ('real', 'a patient cannot read the rates', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select public.scribe_edit_rates()::text'));
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select public.scribe_audit_sample(5)::text')::jsonb;
  insert into results values ('real', 'sample: the AI-drafted signed note', '1', jsonb_array_length(r)::text);
  insert into results values ('real', 'sample holds ids and dates, no text', 'false',
    (r -> 0 ? 'plan' or r -> 0 ? 'history' or r -> 0 ? 'assessment')::text);
  insert into results values ('real', 'sample size is bounded', 'ERR:22023', pg_temp.q_as(pg_temp.f('cmo'), 'select public.scribe_audit_sample(500)::text'));
  insert into results values ('real', 'a clinician cannot draw a sample', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), 'select public.scribe_audit_sample(5)::text'));
end $$;

-- 5. SABOTAGE -------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_orig text; r text; v_note uuid;
begin
  -- the hash trigger dropped: a newly signed note then has no hash
  drop trigger clinical_encounter_notes_stamp_hash on public.clinical_encounter_notes;
  perform pg_temp.act(pg_temp.f('doc'));
  v_note := public.create_encounter_note(pg_temp.f('pat'), 'video_consult', 'Sabotage note');
  perform public.finalize_encounter_note(v_note, 'reassurance', true);
  perform pg_temp.back();
  insert into results values ('sabotaged', 'a signed note carries a hash', 'true',
    (coalesce((select signed_content_hash from public.clinical_encounter_notes where id = v_note), '') ~ '^[0-9a-f]{64}$')::text);

  -- the CMO check removed from scribe_edit_rates
  v_orig := pg_get_functiondef('public.scribe_edit_rates(timestamptz,timestamptz)'::regprocedure);
  v_def := replace(v_orig, 'if not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('doc'), 'select public.scribe_edit_rates()::text');
  insert into results values ('sabotaged', 'a clinician cannot read the rates', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S35c proof FAILED on the real migration: %',
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
