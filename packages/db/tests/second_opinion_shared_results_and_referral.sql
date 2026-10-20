-- Proof: second opinion with patient-shared results and a recommended referral
-- (migration *_second_opinion_shared_results_and_referral.sql).
--
-- Proves in one rolled-back transaction:
--   1. Grants: nothing for anon; the sharing table is closed to every signed-in role.
--   2. Sharing: a patient shares only their own RELEASED, current result with items on their own open request; an unreleased
--      result, someone else's result and someone else's request are all refused.
--   3. Doctor read: an active doctor sees only the shared results (not the patient's other released result), the read writes an
--      audit_log row, a care coordinator and the patient themselves are refused through this function, and a result withdrawn
--      after sharing disappears from the read.
--   4. Answer + referral: the answer stamps answered_by, creates a DRAFT referral stamped with referred_by and no consent, and a
--      second answer is refused; the patient cannot point a request at a referral themselves (guard trigger).
--   5. Accept: only the patient accepts; the referral becomes pending and the existing consent trigger stamps patient_consent_at.
--   6. SABOTAGE: the guard trigger disabled, and the table opened to authenticated; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
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
-- run a statement as a user; returns 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
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
  values (v, 'so-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'SO ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'SO ' || p_label, 'MDCN', 'SO-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true);
  return v;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_other uuid;
  v_req uuid; v_req_other uuid; v_r_ok uuid; v_r_ok2 uuid; v_r_held uuid; v_r_foreign uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', 'contracted', v_admin));
  perform pg_temp.setf('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', 'employed', v_admin));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_other := pg_temp.mkuser(v_org, 'other', 'patient');
  perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('other', v_other);

  -- results are inserted straight into their end state (release guards off for the fixture only)
  alter table public.lab_results disable trigger user;
  alter table public.lab_result_items disable trigger user;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, released_at, reviewed_by, reviewed_at, is_test)
  values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'released', 'clinician_review', now(), v_admin, now(), true) returning id into v_r_ok;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, released_at, reviewed_by, reviewed_at, is_test)
  values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'released', 'clinician_review', now(), v_admin, now(), true) returning id into v_r_ok2;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, is_test)
  values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'awaiting_review', true) returning id into v_r_held;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, released_at, reviewed_by, reviewed_at, is_test)
  values (v_org, v_other, 'pdf_upload', 'tarragon_team', 'released', 'clinician_review', now(), v_admin, now(), true) returning id into v_r_foreign;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, ref_low, ref_high, flag, is_test)
  values (v_r_ok, v_org, v_pat, 'hba1c', 7.1, '%', 4.0, 5.6, 'high', true),
         (v_r_ok2, v_org, v_pat, 'creatinine', 0.9, 'mg/dL', 0.6, 1.3, 'normal', true),
         (v_r_held, v_org, v_pat, 'potassium', 4.1, 'mmol/L', 3.5, 5.1, 'normal', true),
         (v_r_foreign, v_org, v_other, 'sodium', 140, 'mmol/L', 135, 145, 'normal', true);
  alter table public.lab_result_items enable trigger user;
  alter table public.lab_results enable trigger user;
  perform pg_temp.setf('r_ok', v_r_ok);
  perform pg_temp.setf('r_ok2', v_r_ok2);
  perform pg_temp.setf('r_held', v_r_held);
  perform pg_temp.setf('r_foreign', v_r_foreign);

  -- the credit gate is not what is under test here
  alter table public.second_opinion_requests disable trigger second_opinion_requests_enforce_credit;
  insert into public.second_opinion_requests (organisation_id, patient_id, existing_diagnosis_or_result)
  values (v_org, v_pat, 'My GP says my sugar is high and wants to start a tablet.') returning id into v_req;
  insert into public.second_opinion_requests (organisation_id, patient_id, existing_diagnosis_or_result)
  values (v_org, v_other, 'Another patient''s request about something else.') returning id into v_req_other;
  alter table public.second_opinion_requests enable trigger second_opinion_requests_enforce_credit;
  perform pg_temp.setf('req', v_req);
  perform pg_temp.setf('req_other', v_req_other);
end $$;

-- 1. Grants ------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_req uuid := pg_temp.f('req');
begin
  perform pg_temp.rec('anon cannot share', '42501', pg_temp.try_anon(format('select public.share_results_with_second_opinion(%L, array[]::uuid[])', v_req)));
  perform pg_temp.rec('anon cannot read as a doctor', '42501', pg_temp.try_anon(format('select public.read_second_opinion_audited(%L)', v_req)));
  perform pg_temp.rec('anon cannot answer', '42501', pg_temp.try_anon(format('select public.answer_second_opinion_request(%L, %L)', v_req, 'A long enough answer for the check.')));
  perform pg_temp.rec('anon cannot accept', '42501', pg_temp.try_anon(format('select public.accept_second_opinion_referral(%L)', v_req)));
  perform pg_temp.rec('the sharing table is closed to a patient', 'true',
    (pg_temp.q_as(v_pat, 'select count(*)::text from public.second_opinion_shared_results') like 'ERR:permission denied%')::text);
end $$;

-- 2. Sharing -----------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_other uuid := pg_temp.f('other'); v_req uuid := pg_temp.f('req');
begin
  perform pg_temp.rec('a result still awaiting review cannot be shared', 'ERR:one of those results cannot be shared',
    pg_temp.q_as(v_pat, format('select public.share_results_with_second_opinion(%L, array[%L]::uuid[])::text', v_req, pg_temp.f('r_held'))));
  perform pg_temp.rec('another patient''s released result cannot be shared', 'ERR:one of those results cannot be shared',
    pg_temp.q_as(v_pat, format('select public.share_results_with_second_opinion(%L, array[%L]::uuid[])::text', v_req, pg_temp.f('r_foreign'))));
  perform pg_temp.rec('another patient cannot share into my request', 'ERR:not your request',
    pg_temp.q_as(v_other, format('select public.share_results_with_second_opinion(%L, array[%L]::uuid[])::text', v_req, pg_temp.f('r_foreign'))));
  perform pg_temp.rec('my own released result is shared', '1',
    pg_temp.q_as(v_pat, format('select public.share_results_with_second_opinion(%L, array[%L]::uuid[])::text', v_req, pg_temp.f('r_ok'))));
  perform pg_temp.rec('the share is stored once', '1', (select count(*)::text from public.second_opinion_shared_results where request_id = v_req));
end $$;

-- 3. Doctor read -------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); v_coord uuid := pg_temp.f('coord'); v_req uuid := pg_temp.f('req');
begin
  -- worklist: a doctor with no care-team tie still sees the open request; a coordinator and a patient see none
  perform pg_temp.rec('an untied doctor sees the open request in the worklist', '1',
    pg_temp.q_as(v_doc, format($q$select count(*)::text from jsonb_array_elements(public.list_second_opinion_worklist()) e where e ->> 'id' = %L$q$, v_req)));
  perform pg_temp.rec('the worklist shows how many results are shared', '1',
    pg_temp.q_as(v_doc, format($q$select (e ->> 'shared_results') from jsonb_array_elements(public.list_second_opinion_worklist()) e where e ->> 'id' = %L$q$, v_req)));
  perform pg_temp.rec('a care coordinator sees an empty worklist', '0', pg_temp.q_as(v_coord, 'select jsonb_array_length(public.list_second_opinion_worklist())::text'));
  perform pg_temp.rec('a patient sees an empty worklist', '0', pg_temp.q_as(v_pat, 'select jsonb_array_length(public.list_second_opinion_worklist())::text'));
  -- outside documents
  perform pg_temp.rec('a file outside the patient''s own folder is refused', 'ERR:file path must be in your own folder for this request',
    pg_temp.q_as(v_pat, format($q$select public.attach_second_opinion_document(%L, %L, 'application/pdf', 1000)::text$q$, v_req, gen_random_uuid()::text || '/' || v_req::text || '/a.pdf')));
  perform pg_temp.rec('a file type that is not accepted is refused', 'ERR:that file type is not accepted',
    pg_temp.q_as(v_pat, format($q$select public.attach_second_opinion_document(%L, %L, 'application/zip', 1000)::text$q$, v_req, v_pat::text || '/' || v_req::text || '/a.zip')));
  perform pg_temp.rec('another patient cannot attach a file to my request', 'ERR:not your request',
    pg_temp.q_as(pg_temp.f('other'), format($q$select public.attach_second_opinion_document(%L, %L, 'application/pdf', 1000)::text$q$, v_req, pg_temp.f('other')::text || '/' || v_req::text || '/a.pdf')));
  perform pg_temp.rec('my own file is registered', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.attach_second_opinion_document(%L, %L, 'application/pdf', 1000)::text$q$, v_req, v_pat::text || '/' || v_req::text || '/report.pdf')) !~ '^ERR:')::text);
  perform pg_temp.rec('the documents table is closed to a patient', 'true',
    (pg_temp.q_as(v_pat, 'select count(*)::text from public.second_opinion_documents') like 'ERR:permission denied%')::text);
  perform pg_temp.rec('the doctor''s audited read lists the file', '1',
    pg_temp.q_as(v_doc, format('select jsonb_array_length(public.read_second_opinion_audited(%L) -> ''documents'')::text', v_req)));
  -- claiming the review
  perform pg_temp.rec('a care coordinator cannot start a review', 'ERR:request not found',
    pg_temp.q_as(v_coord, format('select public.start_second_opinion_review(%L)::text', v_req)));
  -- run the call first and read the row afterwards: a single statement would read the row from before the update
  perform pg_temp.rec('a doctor can start the review', 'ok', pg_temp.try_as(v_doc, format('select public.start_second_opinion_review(%L)', v_req)));
  perform pg_temp.rec('...and the request is then in review', 'in_review', (select status::text from public.second_opinion_requests where id = v_req));
  perform pg_temp.rec('the doctor sees only the shared result (not the patient''s other released one)', '1',
    pg_temp.q_as(v_doc, format('select jsonb_array_length(public.read_second_opinion_audited(%L) -> ''results'')::text', v_req)));
  perform pg_temp.rec('...with its values', 'hba1c',
    pg_temp.q_as(v_doc, format('select public.read_second_opinion_audited(%L) -> ''results'' -> 0 -> ''items'' -> 0 ->> ''analyte_code''', v_req)));
  -- every read writes a row (this doctor has read the request more than once by now), so the proof is "at least one", not an exact count
  perform pg_temp.rec('the read is audited with its basis', 'true',
    ((select count(*) from public.audit_log where entity_type = 'second_opinion_request' and entity_id = v_req
        and actor_id = v_doc and event ->> 'basis' = 'second_opinion_share') >= 1)::text);
  perform pg_temp.rec('a care coordinator is refused', 'ERR:request not found',
    pg_temp.q_as(v_coord, format('select public.read_second_opinion_audited(%L)::text', v_req)));
  perform pg_temp.rec('the patient is refused through the doctor function', 'ERR:request not found',
    pg_temp.q_as(v_pat, format('select public.read_second_opinion_audited(%L)::text', v_req)));
  -- a result withdrawn after sharing disappears from the read
  alter table public.lab_results disable trigger user;
  update public.lab_results set release_state = 'withheld', withheld_reason = 'proof: withdrawn after sharing' where id = pg_temp.f('r_ok');
  perform pg_temp.rec('a result withdrawn after sharing is no longer shown', '0',
    pg_temp.q_as(v_doc, format('select jsonb_array_length(public.read_second_opinion_audited(%L) -> ''results'')::text', v_req)));
  update public.lab_results set release_state = 'released', withheld_reason = null where id = pg_temp.f('r_ok');
  alter table public.lab_results enable trigger user;
end $$;

-- 4. Answer + referral -------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_doc uuid := pg_temp.f('doc'); v_req uuid := pg_temp.f('req'); v_ref text;
begin
  perform pg_temp.rec('the patient cannot answer their own request', 'true',
    (pg_temp.q_as(v_pat, format('select public.answer_second_opinion_request(%L, %L)::text', v_req, 'I answer myself, this is long enough.')) like 'ERR:%')::text);
  v_ref := pg_temp.q_as(v_doc, format($q$select public.answer_second_opinion_request(%L, %L, 'endocrinology', 'priority', %L, %L)::text$q$,
    v_req, 'Your HbA1c is above target; a specialist review is sensible before starting treatment.',
    'HbA1c 7.1 percent on the outside report, newly raised.', 'Review and advise on treatment.'));
  perform pg_temp.rec('the answer returns a referral id', 'true', (v_ref !~ '^ERR:' and v_ref is not null)::text);
  perform pg_temp.setf('ref', v_ref::uuid);
  perform pg_temp.rec('the request is answered by the real doctor', 'answered',
    (select r.status::text from public.second_opinion_requests r join public.clinical_staff cs on cs.id = r.answered_by
      where r.id = v_req and cs.profile_id = v_doc));
  perform pg_temp.rec('the request points at the referral', 'true', (select (referral_id = v_ref::uuid)::text from public.second_opinion_requests where id = v_req));
  perform pg_temp.rec('the referral is a draft, doctor-referred, with no consent yet', 'draft|true|true',
    (select status::text || '|' || (referred_by is not null)::text || '|' || (patient_consent_at is null)::text
       from public.specialist_referrals where id = v_ref::uuid));
  perform pg_temp.rec('the letter is attributed to the recommending doctor (set_by)', 'true',
    (select (set_by = v_doc)::text from public.specialist_referrals where id = v_ref::uuid));
  perform pg_temp.rec('the draft is already signed by that doctor (INV-02: nothing leaves draft unsigned)', 'true',
    (select (signed_by = v_doc and signed_at is not null)::text from public.specialist_referrals where id = v_ref::uuid));
  perform pg_temp.rec('a second answer is refused', 'true',
    (pg_temp.q_as(v_doc, format('select public.answer_second_opinion_request(%L, %L)::text', v_req, 'Answering again after the first answer.')) like 'ERR:request not found or already answered')::text);
  perform pg_temp.rec('the patient cannot repoint the request at a referral (guard trigger)', 'true',
    (pg_temp.try_as(v_pat, format('update public.second_opinion_requests set referral_id = %L where id = %L', gen_random_uuid(), v_req)) like '%set by the care team%')::text);
end $$;

-- 5. Accept ------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_other uuid := pg_temp.f('other'); v_req uuid := pg_temp.f('req'); v_ref uuid := pg_temp.f('ref');
begin
  perform pg_temp.rec('another patient cannot accept my referral', 'ERR:no referral to accept',
    pg_temp.q_as(v_other, format('select public.accept_second_opinion_referral(%L)::text', v_req)));
  perform pg_temp.rec('the patient accepts', v_ref::text, pg_temp.q_as(v_pat, format('select public.accept_second_opinion_referral(%L)::text', v_req)));
  perform pg_temp.rec('the referral is pending and consent is stamped', 'pending|true',
    (select status::text || '|' || (patient_consent_at is not null)::text from public.specialist_referrals where id = v_ref));
end $$;

-- 6. Sabotage ----------------------------------------------------------------------------------------------------------
alter table public.second_opinion_requests disable trigger second_opinion_requests_guard_referral_link;
grant select on public.second_opinion_shared_results to authenticated;
do $$
declare v_pat uuid := pg_temp.f('pat'); v_req uuid := pg_temp.f('req');
begin
  insert into results values ('sabotaged', 'the guard trigger stops a patient repointing the referral', 'blocked',
    case when pg_temp.try_as(v_pat, format('update public.second_opinion_requests set referral_id = %L where id = %L', pg_temp.f('ref'), v_req)) = 'ok' then 'allowed' else 'blocked' end);
  insert into results values ('sabotaged', 'the sharing table is closed to a patient', 'closed',
    case when pg_temp.q_as(v_pat, 'select count(*)::text from public.second_opinion_shared_results') like 'ERR:%' then 'closed' else 'open' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'second opinion proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above. They are deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;
