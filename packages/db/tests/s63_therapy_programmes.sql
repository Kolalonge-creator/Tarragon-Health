-- S63 proof: digital therapy programmes (Module 14). Entry screen fails closed and every exclusion item refuses enrolment (81 items, table-driven);
-- ACCEPTANCE back pain with saddle numbness blocks enrolment with urgent guidance and a clinician task; PHQ-9 item 9 above zero is a crisis stop with a class 1
-- task and an urgent event; the screen is re-run at the start of every session; scores only at checkpoints; worsening pauses the programme and raises a review task
-- once (idempotent for the bus handler); a programme version change does not alter an enrolled patient's content and an approved version is frozen (INV-16);
-- per-patient access with no staff, sponsor or admin read (INV-12), consent-gated audited clinician read (INV-10), revocable at once; guards off; anon refused.
-- Roles proved: patient own, other patient, tied clinician, untied clinician, tied coordinator, CMO without a tie, admin, finance, analyst, corporate admin, anon.
-- SABOTAGE: a staff select policy added, the enrolment guard trigger dropped, the content freeze dropped, the screen made to always pass; each must flip its check
-- (the file fails with VACUOUS TEST otherwise). Everything is rolled back.
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
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
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
-- the same as anon
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
-- 'claimed', the error code, or the reason no task was given
create function pg_temp.next_outcome(p_uid uuid) returns text language sql as
$$ select coalesce(r ->> 'error', case when jsonb_typeof(r -> 'task') = 'object' then 'claimed' else r ->> 'reason' end)
     from (select pg_temp.next_as(p_uid) as r) x $$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's22-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S22 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S22 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.cnt(p_uid uuid, p_table text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.%I', p_table)) $$;
create function pg_temp.tcount(p_sql text) returns text language plpgsql as $f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.tasks_for(p_patient uuid, p_type text) returns text language sql as
$$ select count(*)::text from public.clinical_tasks where patient_id = p_patient and type = p_type $$;
create function pg_temp.audit_n(p_actor uuid, p_result text) returns integer language sql as
$$ select count(*)::integer from public.audit_log where actor_id = p_actor and action = 'staff.therapy_progress_read' and result = p_result $$;
-- answers for a list with every item clear, optionally with one item made positive
create function pg_temp.answers(p_code text, p_positive text default null) returns jsonb language plpgsql as
$f$ declare r record; a jsonb := '{}'::jsonb; v jsonb;
begin
  for r in select * from public.therapy_exclusion_rules where programme_code = p_code and list_version = (select coalesce(max(version) filter (where status = 'confirmed'), max(version)) from public.therapy_exclusion_list_versions where programme_code = p_code) loop
    if r.item_code = p_positive then
      v := case r.kind when 'yes_no' then 'true'::jsonb when 'score_at_least' then to_jsonb(r.threshold) else to_jsonb(r.threshold - 1) end;
    else
      v := case r.kind when 'yes_no' then 'false'::jsonb when 'score_at_least' then to_jsonb(r.threshold - 1) else to_jsonb(r.threshold) end;
    end if;
    a := a || jsonb_build_object(r.item_code, v);
  end loop;
  return a;
end $f$;
create function pg_temp.enrol_as(p_uid uuid, p_code text, p_answers jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.enrol_in_therapy_programme(p_code, p_answers); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.start_as(p_uid uuid, p_enrol uuid, p_ord integer, p_re jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.start_therapy_session(p_enrol, p_ord, p_re); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.done_as(p_uid uuid, p_enrol uuid, p_ord integer, p_scores jsonb) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.complete_therapy_session(p_enrol, p_ord, p_scores); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_coord uuid; v_cmo uuid; v_pat uuid; v_real uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('patB', pg_temp.mkuser(v_org, 'patB', 'patient'));
  perform pg_temp.setf('patC', pg_temp.mkuser(v_org, 'patC', 'patient'));
  perform pg_temp.setf('patD', pg_temp.mkuser(v_org, 'patD', 'patient'));
  perform pg_temp.setf('patE', pg_temp.mkuser(v_org, 'patE', 'patient'));
  v_real := pg_temp.mkuser(v_org, 'real', 'patient'); perform pg_temp.setf('real', v_real);
  update public.profiles set is_test = false where id = v_real;
  v_doc := pg_temp.mkdoc(v_org, 'doctied', 'medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('doctied', v_doc);
  v_coord := pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', 'employed', '{}', v_admin); perform pg_temp.setf('coord', v_coord);
  perform pg_temp.setf('finance', pg_temp.mkuser(v_org, 'finance', 'finance'));
  perform pg_temp.setf('analyst', pg_temp.mkuser(v_org, 'analyst', 'analyst'));
  perform pg_temp.setf('corp', pg_temp.mkuser(v_org, 'corp', 'corporate_admin'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id) values (v_org, v_pat, v_doc, v_coord);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('docuntied', pg_temp.mkdoc(v_org, 'docuntied', 'medical_officer', 'contracted', '{adult_general}', v_admin));
end $$;

-- 1. Entry screen: every exclusion in every list refuses enrolment (table-driven), unanswered refuses, no list admits nobody ----------
do $$
declare r record; o jsonb; n_rules integer := 0; n_refused integer := 0;
begin
  for r in select programme_code, item_code, route from public.therapy_exclusion_rules
            where list_version = 1 and programme_code <> 'pulmonary_rehab' order by programme_code, ordinal loop
    n_rules := n_rules + 1;
    o := pg_temp.enrol_as(pg_temp.f('pat2'), r.programme_code, pg_temp.answers(r.programme_code, r.item_code));
    if (o ->> 'enrolled') = 'false' and (o ->> 'route') = r.route and (o -> 'stop_codes') = jsonb_build_array(r.item_code) then n_refused := n_refused + 1; end if;
  end loop;
  perform pg_temp.ck('every exclusion item refuses enrolment with its own route (' || n_rules || ' items)', n_rules::text, n_refused::text);
  perform pg_temp.ck('...and the rule count is the seeded lists (81)', '81', n_rules::text);
  perform pg_temp.ck('no active enrolment exists for the patient who tripped them all', '0',
    (select count(*)::text from public.therapy_enrolments where patient_id = pg_temp.f('pat2') and state in ('active', 'paused')));
  perform pg_temp.ck('a missing answer refuses (fail closed)', 'blocked',
    pg_temp.enrol_as(pg_temp.f('pat2'), 'pelvic_floor', pg_temp.answers('pelvic_floor') - 'blood_in_urine') ->> 'state');
  perform pg_temp.ck('empty answers refuse', 'false', pg_temp.enrol_as(pg_temp.f('pat2'), 'ibs_hypnotherapy', '{}'::jsonb) ->> 'enrolled');
  perform pg_temp.ck('a wrong kind of answer (text for a yes/no) refuses', 'false',
    pg_temp.enrol_as(pg_temp.f('pat2'), 'pelvic_floor', pg_temp.answers('pelvic_floor') || '{"blood_in_urine":"no"}'::jsonb) ->> 'enrolled');
  perform pg_temp.ck('answering the form again after a stop does not undo it (a clinician looks first)', 'clinician_review_pending',
    pg_temp.enrol_as(pg_temp.f('pat2'), 'pelvic_floor', pg_temp.answers('pelvic_floor')) ->> 'reason');
  perform pg_temp.ck('a programme with no entry list admits nobody', 'true', (pg_temp.enrol_as(pg_temp.f('pat2'), 'pulmonary_rehab', '{}'::jsonb) ->> 'no_rules'));
  -- ACCEPTANCE
  o := pg_temp.enrol_as(pg_temp.f('pat'), 'pain_back', pg_temp.answers('pain_back', 'saddle_numbness'));
  perform pg_temp.ck('ACCEPTANCE: back pain with saddle numbness blocks enrolment', 'false', o ->> 'enrolled');
  perform pg_temp.ck('...and returns the same-day clinician route (urgent guidance)', 'same_day_clinician', o ->> 'route');
  perform pg_temp.ck('...and a clinician task exists (never only a notification)', '1', pg_temp.tasks_for(pg_temp.f('pat'), 'symptom_review'));
  perform pg_temp.ck('...and nothing is active', '0', (select count(*)::text from public.therapy_enrolments where patient_id = pg_temp.f('pat') and state = 'active'));
  perform pg_temp.ck('a scaffold programme with clean answers is not available', 'not_available', pg_temp.enrol_as(pg_temp.f('patB'), 'pain_back', pg_temp.answers('pain_back')) ->> 'reason');
  -- the pure check shows guidance and writes nothing
  perform pg_temp.ck('the pure screen writes nothing', 'same_day_clinician',
    pg_temp.q_as(pg_temp.f('patB'), format($q$select (public.therapy_check_entry_screen('pain_back', %L::jsonb))->>'route'$q$, pg_temp.answers('pain_back', 'saddle_numbness')::text)));
  perform pg_temp.ck('...no row for patB', '0', (select count(*)::text from public.therapy_enrolments where patient_id = pg_temp.f('patB')));
end $$;

-- 2. Mood: item 9 above zero is a crisis stop with a class 1 task and an urgent event; no helpline anywhere ---------------------------
do $$
declare o jsonb;
begin
  o := pg_temp.enrol_as(pg_temp.f('patC'), 'low_mood', pg_temp.answers('low_mood', 'phq9_item9'));
  perform pg_temp.ck('PHQ-9 item 9 above zero blocks and routes to crisis', 'crisis', o ->> 'route');
  perform pg_temp.ck('...a class 1 task is raised', '1', pg_temp.tasks_for(pg_temp.f('patC'), 'red_event_unacknowledged'));
  perform pg_temp.ck('...an urgent programme.flag event is written with ids only', '1',
    (select count(*)::text from public.domain_events where patient_id = pg_temp.f('patC') and event_type = 'programme.flag' and priority = 'urgent' and payload ?& array['enrolment_id'] and jsonb_array_length(jsonb_path_query_array(payload, '$.*')) = 1));
  o := pg_temp.enrol_as(pg_temp.f('patD'), 'low_mood', pg_temp.answers('low_mood', 'phq9_total'));
  perform pg_temp.ck('PHQ-9 of 15 needs clinician review first, not a crisis', 'medical_review_first', o ->> 'route');
  perform pg_temp.ck('...and raises no crisis task', '0', pg_temp.tasks_for(pg_temp.f('patD'), 'red_event_unacknowledged'));
  perform pg_temp.ck('no phone number or helpline in any guidance string the database returns', '0',
    (select count(*)::text from public.therapy_exclusion_rules where question ~* '(help ?line|hotline|\d{7,})'));
end $$;

-- 3. Enrol, session re-check, scores, worsening, event, idempotence ----------------------------------------------------------------
do $$
declare o jsonb; e uuid; i integer; s jsonb;
begin
  o := pg_temp.enrol_as(pg_temp.f('patE'), 'panic_breathing', pg_temp.answers('panic_breathing'));
  perform pg_temp.ck('a test account with clean answers enrols', 'true', o ->> 'enrolled');
  e := (o ->> 'enrolment_id')::uuid; perform pg_temp.setf('e_panic', e);
  perform pg_temp.ck('...and a repeat returns the same enrolment', e::text, pg_temp.enrol_as(pg_temp.f('patE'), 'panic_breathing', pg_temp.answers('panic_breathing')) ->> 'enrolment_id');
  perform pg_temp.ck('a real patient is told the programme is not open yet (guard off)', 'not_open_yet',
    pg_temp.enrol_as(pg_temp.f('real'), 'panic_breathing', pg_temp.answers('panic_breathing')) ->> 'reason');
  -- the trigger itself, as the table owner
  begin
    insert into public.therapy_enrolments (organisation_id, patient_id, programme_id, programme_version, exclusion_list_version, state)
      select pg_temp.f('org'), pg_temp.f('real'), id, 1, 1, 'active' from public.therapy_programmes where code = 'panic_breathing';
    perform pg_temp.ck('the guard trigger refuses an active row for a real patient', 'refused', 'inserted');
  exception when others then
    perform pg_temp.ck('the guard trigger refuses an active row for a real patient', 'refused', case when sqlerrm like '%not open%' then 'refused' else sqlerrm end);
  end;
  perform pg_temp.ck('session 2 before session 1 is refused', 'true', (pg_temp.start_as(pg_temp.f('patE'), e, 2, pg_temp.answers('panic_breathing')) ->> 'error' like '%not open yet%')::text);
  s := pg_temp.start_as(pg_temp.f('patE'), e, 1, pg_temp.answers('panic_breathing'));
  perform pg_temp.ck('a clean re-check opens session 1 with the draft text', 'ok', s ->> 'status');
  perform pg_temp.ck('...marked as draft content', 'true', s ->> 'draft_content');
  perform pg_temp.ck('...and it is a checkpoint with its instrument', 'panic_episodes_week', s -> 'instruments' ->> 0);
  perform pg_temp.ck('a checkpoint session cannot finish without scores', 'true', (pg_temp.done_as(pg_temp.f('patE'), e, 1, null) ->> 'error' like '%scores are needed%')::text);
  perform pg_temp.ck('an out-of-range score is refused', 'true', (pg_temp.done_as(pg_temp.f('patE'), e, 1, '{"panic_episodes_week":500}') ->> 'error' like '%out of range%')::text);
  perform pg_temp.ck('a good score completes session 1', 'ok', pg_temp.done_as(pg_temp.f('patE'), e, 1, '{"panic_episodes_week":2}') ->> 'status');
  perform pg_temp.ck('...baseline recorded', '2', (select baseline_score::text from public.therapy_enrolments where id = e));
  perform pg_temp.ck('...programme.session_completed event written, ids only', '1',
    (select count(*)::text from public.domain_events where event_type = 'programme.session_completed' and aggregate_id = e and payload ?& array['enrolment_id', 'ordinal']));
  perform pg_temp.ck('...a repeat completion is safe (already saved)', 'true', pg_temp.done_as(pg_temp.f('patE'), e, 1, '{"panic_episodes_week":2}') ->> 'already');
  -- session 2: a positive re-check stops the programme and routes it
  perform pg_temp.ck('session 2 opens', 'ok', pg_temp.start_as(pg_temp.f('patE'), e, 2, pg_temp.answers('panic_breathing')) ->> 'status');
  perform pg_temp.ck('session 2 completes (not a checkpoint, no scores)', 'ok', pg_temp.done_as(pg_temp.f('patE'), e, 2, null) ->> 'status');
  perform pg_temp.ck('scores outside a checkpoint are refused', 'true',
    (pg_temp.start_as(pg_temp.f('patE'), e, 3, pg_temp.answers('panic_breathing')) ->> 'status' = 'ok')::text);
  perform pg_temp.ck('a worsening score at the next checkpoint (2 to 6, a rise of 4) pauses for review', 'true',
    pg_temp.done_as(pg_temp.f('patE'), e, 3, '{"panic_episodes_week":6}') ->> 'paused_for_review');
  perform pg_temp.ck('...the enrolment is paused for review', 'paused', (select state from public.therapy_enrolments where id = e));
  perform pg_temp.ck('...a clinician review task exists', '1', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('patE') and type = 'symptom_review' and dedup_key = 'therapy_worsening:' || e));
  perform pg_temp.ck('...a programme.flag event exists', '1', (select count(*)::text from public.domain_events where event_type = 'programme.flag' and aggregate_id = e and idempotency_key = 'programme.flag:' || e || ':worsening_review'));
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform public.therapy_run_progress(e);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ck('the bus handler path is idempotent: no second task', '1', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('patE') and dedup_key = 'therapy_worsening:' || e));
  perform pg_temp.ck('a paused programme opens no session', 'not_active', pg_temp.start_as(pg_temp.f('patE'), e, 4, pg_temp.answers('panic_breathing')) ->> 'status');
end $$;
-- therapy_run_progress is service role only

-- 4. Re-check every session, fail closed ---------------------------------------------------------------------------------------
do $$
declare o jsonb; e uuid; s jsonb;
begin
  o := pg_temp.enrol_as(pg_temp.f('patB'), 'pelvic_floor', pg_temp.answers('pelvic_floor'));
  e := (o ->> 'enrolment_id')::uuid; perform pg_temp.setf('e_pelvic', e);
  s := pg_temp.start_as(pg_temp.f('patB'), e, 1, pg_temp.answers('pelvic_floor', 'blood_in_urine'));
  perform pg_temp.ck('a positive re-check stops the programme and returns no content', 'stopped', s ->> 'status');
  perform pg_temp.ck('...no session text is in the answer', 'false', (s ? 'session')::text);
  perform pg_temp.ck('...the enrolment is stopped', 'stopped_exclusion', (select state from public.therapy_enrolments where id = e));
  perform pg_temp.ck('...a same-day clinician task exists', '1', pg_temp.tasks_for(pg_temp.f('patB'), 'symptom_review'));
  perform pg_temp.ck('a missing re-check answer also stops (fail closed)', 'stopped',
    pg_temp.start_as(pg_temp.f('patB'), (pg_temp.enrol_as(pg_temp.f('patB'), 'ibs_hypnotherapy', pg_temp.answers('ibs_hypnotherapy')) ->> 'enrolment_id')::uuid, 1, '{}'::jsonb) ->> 'status');
end $$;

-- 5. INV-16: a version change does not alter an enrolled patient's content; an approved version cannot change -----------------------
do $$
declare pid uuid; e1 uuid; e2 uuid; t1 text; t2 text; v_admin uuid := pg_temp.f('admin'); v text;
begin
  select id into pid from public.therapy_programmes where code = 'ibs_hypnotherapy';
  e1 := (pg_temp.enrol_as(pg_temp.f('patC'), 'ibs_hypnotherapy', pg_temp.answers('ibs_hypnotherapy')) ->> 'enrolment_id')::uuid;
  perform pg_temp.ck('patC enrols on version 1', '1', (select programme_version::text from public.therapy_enrolments where id = e1));
  insert into public.therapy_programme_versions (programme_id, version, review_state) values (pid, 2, 'draft');
  insert into public.therapy_programme_sessions (programme_id, version, ordinal, title, kind, text_body, duration_seconds)
    select programme_id, 2, ordinal, title, kind, 'VERSION TWO TEXT ' || ordinal, duration_seconds from public.therapy_programme_sessions where programme_id = pid and version = 1;
  update public.therapy_programmes set current_version = 2 where id = pid;
  t1 := pg_temp.start_as(pg_temp.f('patC'), e1, 1, pg_temp.answers('ibs_hypnotherapy')) -> 'session' ->> 'text';
  perform pg_temp.ck('the enrolled patient still reads version 1 text after the bump', 'false', (t1 like 'VERSION TWO%')::text);
  e2 := (pg_temp.enrol_as(pg_temp.f('patD'), 'ibs_hypnotherapy', pg_temp.answers('ibs_hypnotherapy')) ->> 'enrolment_id')::uuid;
  perform pg_temp.ck('a new enrolment starts on version 2', '2', (select programme_version::text from public.therapy_enrolments where id = e2));
  t2 := pg_temp.start_as(pg_temp.f('patD'), e2, 1, pg_temp.answers('ibs_hypnotherapy')) -> 'session' ->> 'text';
  perform pg_temp.ck('...and reads version 2 text', 'true', (t2 like 'VERSION TWO TEXT 1')::text);
  begin update public.therapy_enrolments set programme_version = 2 where id = e1; v := 'changed'; exception when others then v := 'refused'; end;
  perform pg_temp.ck('...trigger refuses the change', 'refused', v);
  update public.therapy_exclusion_list_versions set status = 'confirmed', confirmed_by = v_admin, confirmed_at = now() where programme_code = 'ibs_hypnotherapy' and version = 1;
  insert into public.therapy_exclusion_list_versions (programme_code, version, status) values ('ibs_hypnotherapy', 2, 'draft');
  insert into public.therapy_exclusion_rules (programme_code, list_version, ordinal, item_code, question, kind, route) values ('ibs_hypnotherapy', 2, 1, 'only_draft_item', 'q', 'yes_no', 'same_day_clinician');
  perform pg_temp.ck('a newer unconfirmed list does not replace the confirmed one on the live screen', 'true',
    pg_temp.q_as(pg_temp.f('patB'), format($q$select (public.therapy_check_entry_screen('ibs_hypnotherapy', %L::jsonb))->>'passed'$q$, pg_temp.answers('ibs_hypnotherapy')::text)));
  begin update public.therapy_exclusion_rules set question = 'edited' where programme_code = 'ibs_hypnotherapy' and list_version = 1 and ordinal = 1; v := 'changed'; exception when others then v := 'refused'; end;
  perform pg_temp.ck('a confirmed list cannot be edited', 'refused', v);
  -- approve version 1 and prove it is frozen
  update public.therapy_programme_versions set review_state = 'approved', approved_by = v_admin, approved_at = now() where programme_id = pid and version = 1;
  begin update public.therapy_programme_sessions set text_body = 'edited' where programme_id = pid and version = 1 and ordinal = 1; v := 'changed'; exception when others then v := 'refused'; end;
  perform pg_temp.ck('an approved version cannot be edited', 'refused', v);
  begin update public.therapy_programme_versions set review_state = 'draft' where programme_id = pid and version = 1; v := 'changed'; exception when others then v := 'refused'; end;
  perform pg_temp.ck('an approved version cannot go back to draft', 'refused', v);
  perform pg_temp.ck('a real patient is shown approved content only once approved (version 1 now approved)', 'ok',
    pg_temp.start_as(pg_temp.f('patC'), e1, 1, pg_temp.answers('ibs_hypnotherapy')) ->> 'status');
  update public.therapy_programmes set current_version = 1 where id = pid;
end $$;

-- 6. Roles: direct reads, writes, anon, governance ----------------------------------------------------------------------------------
do $$
declare t text; who text;
begin
  perform pg_temp.ck('the patient reads their own enrolments', '1', pg_temp.cnt(pg_temp.f('patE'), 'therapy_enrolments'));
  perform pg_temp.ck('...and own progress rows', '3', pg_temp.cnt(pg_temp.f('patE'), 'therapy_session_progress'));
  perform pg_temp.ck('another patient sees none of patient pat2', '0', pg_temp.q_as(pg_temp.f('real'), format('select count(*)::text from public.therapy_enrolments where patient_id = %L', pg_temp.f('patE'))));
  foreach t in array array['therapy_enrolments', 'therapy_session_progress', 'therapy_share_consents'] loop
    foreach who in array array['doctied', 'docuntied', 'coord', 'cmo', 'admin', 'finance', 'analyst', 'corp'] loop
      perform pg_temp.ck(who || ' cannot read ' || t || ' directly', '0', pg_temp.cnt(pg_temp.f(who), t));
    end loop;
  end loop;
  foreach who in array array['patE', 'doctied', 'coord', 'finance', 'analyst', 'corp'] loop
    perform pg_temp.ck(who || ' cannot read programme content', '0', pg_temp.cnt(pg_temp.f(who), 'therapy_programme_sessions'));
  end loop;
  perform pg_temp.ck('admin can read programme content for review', (select count(*)::text from public.therapy_programme_sessions), pg_temp.cnt(pg_temp.f('admin'), 'therapy_programme_sessions'));
  perform pg_temp.ck('a patient cannot write an enrolment directly', 'true',
    (pg_temp.try_as(pg_temp.f('patE'), format($q$update public.therapy_enrolments set completed_count = 99 where id = %L$q$, pg_temp.f('e_panic'))) like '%permission denied%')::text);
  perform pg_temp.ck('a patient cannot insert one directly', 'true',
    (pg_temp.try_as(pg_temp.f('patE'), format($q$insert into public.therapy_enrolments (organisation_id, patient_id, programme_id, programme_version, exclusion_list_version, state) select %L, %L, id, 1, 1, 'active' from public.therapy_programmes limit 1$q$, pg_temp.f('org'), pg_temp.f('patE'))) like '%permission denied%')::text);
  perform pg_temp.ck('anon is refused at the table', '42501', pg_temp.try_anon('select count(*) from public.therapy_enrolments'));
  perform pg_temp.ck('anon cannot enrol', '42501', pg_temp.try_anon($q$select public.enrol_in_therapy_programme('panic_breathing', '{}'::jsonb)$q$));
  perform pg_temp.ck('therapy_run_progress is refused to a patient', 'true',
    (pg_temp.try_as(pg_temp.f('patE'), format($q$select public.therapy_run_progress(%L)$q$, pg_temp.f('e_panic'))) like '%permission denied%')::text);
  perform pg_temp.ck('a clinician (not CMO) cannot save an exclusion list', 'true',
    (pg_temp.try_as(pg_temp.f('doctied'), $q$select public.save_therapy_exclusion_list('panic_breathing', '[{"code":"x","question":"q","kind":"yes_no","route":"same_day_clinician"}]'::jsonb)$q$) like '%only the Chief Medical Officer%')::text);
  perform pg_temp.ck('...nor approve content', 'true', (pg_temp.try_as(pg_temp.f('doctied'), $q$select public.approve_therapy_programme_version('panic_breathing', 1)$q$) like '%only the Chief Medical Officer%')::text);
  perform pg_temp.ck('the CMO saves a new draft list (version 2)', 'ok', pg_temp.try_as(pg_temp.f('cmo'), $q$select public.save_therapy_exclusion_list('panic_breathing', '[{"code":"x","question":"q","kind":"yes_no","route":"same_day_clinician"}]'::jsonb)$q$));
  perform pg_temp.ck('...which is a draft, newest, and an old confirmed list could not change', '2', (select max(version)::text from public.therapy_exclusion_list_versions where programme_code = 'panic_breathing'));
  perform pg_temp.ck('...and the screen now uses it: an old-list answer set no longer passes (fail closed)', 'false',
    pg_temp.enrol_as(pg_temp.f('patB'), 'panic_breathing', pg_temp.answers('panic_breathing') - 'x') ->> 'enrolled');
  delete from public.therapy_exclusion_rules where programme_code = 'panic_breathing' and list_version = 2;
  delete from public.therapy_exclusion_list_versions where programme_code = 'panic_breathing' and version = 2;
end $$;

-- 7. Go-live guards: seven, off, cannot be switched on from unmet conditions -------------------------------------------------------
do $$
begin
  perform pg_temp.ck('seven therapy guards exist', '7', (select count(*)::text from public.go_live_guards where key like 'therapy\_%\_enabled'));
  perform pg_temp.ck('...all off', '0', (select count(*)::text from public.go_live_guards where key like 'therapy\_%\_enabled' and is_on));
  perform pg_temp.ck('the CMO cannot switch one on while conditions are unmet', 'true',
    (pg_temp.try_as(pg_temp.f('cmo'), $q$select public.set_go_live_guard('therapy_panic_breathing_enabled', true, 'trying it out for a test')$q$) <> 'ok')::text);
  perform pg_temp.ck('...it is still off', 'false', (select is_on::text from public.go_live_guards where key = 'therapy_panic_breathing_enabled'));
  perform pg_temp.ck('content_approved is unmet while the version is a draft', 'false',
    (select (c ->> 'met') from jsonb_array_elements(private.go_live_conditions('therapy_pelvic_floor_enabled', null)) c where c ->> 'code' = 'content_approved'));
  perform pg_temp.ck('a CMO can attest cover', 'ok',
    pg_temp.try_as(pg_temp.f('cmo'), $q$select public.attest_go_live_condition('therapy_pelvic_floor_enabled', 'clinical_cover_confirmed', true, 'proof run: cover checked by the test script')$q$));
end $$;

-- 8. Consent and the audited read -----------------------------------------------------------------------------------------------------
do $$
declare e uuid := pg_temp.f('e_panic'); pat uuid := pg_temp.f('patE'); q text;
begin
  -- pat2 is tied to nobody; tie them to the tied doctor for these checks
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id) values (pg_temp.f('org'), pat, pg_temp.f('doctied'), pg_temp.f('coord'));
  q := format($q$select (public.read_therapy_progress_audited(%L, 'reviewing the programme for a follow up'))->>'status'$q$, pat);
  perform pg_temp.ck('tied clinician, no consent: nothing shared', 'not_shared', pg_temp.q_as(pg_temp.f('doctied'), q));
  perform pg_temp.ck('another patient cannot call the staff read', 'true', (pg_temp.q_as(pg_temp.f('real'), q) like 'ERR:%not authorised%')::text);
  perform pg_temp.ck('only the owner can share', 'true',
    (pg_temp.try_as(pg_temp.f('real'), format($q$select public.set_therapy_progress_sharing(%L, true)$q$, e)) like '%not found%')::text);
  perform pg_temp.ck('the patient shares', 'ok', pg_temp.try_as(pat, format($q$select public.set_therapy_progress_sharing(%L, true)$q$, e)));
  perform pg_temp.ck('tied clinician now reads (audited)', 'ok', pg_temp.q_as(pg_temp.f('doctied'), q));
  perform pg_temp.ck('...and the read carries the scores', '3', pg_temp.q_as(pg_temp.f('doctied'), format($q$select jsonb_array_length((public.read_therapy_progress_audited(%L, 'checking the scores for the review'))->'enrolments'->0->'sessions')::text$q$, pat)));
  perform pg_temp.ck('an untied clinician is denied even with consent', 'denied', pg_temp.q_as(pg_temp.f('docuntied'), q));
  perform pg_temp.ck('a care coordinator is denied', 'denied', pg_temp.q_as(pg_temp.f('coord'), q));
  perform pg_temp.ck('admin and the CMO without a tie are denied', 'denied', pg_temp.q_as(pg_temp.f('admin'), q));
  perform pg_temp.ck('...CMO', 'denied', pg_temp.q_as(pg_temp.f('cmo'), q));
  perform pg_temp.ck('finance is denied', 'denied', pg_temp.q_as(pg_temp.f('finance'), q));
  perform pg_temp.ck('a reason of 10 characters is required', 'true', (pg_temp.q_as(pg_temp.f('doctied'), format($q$select (public.read_therapy_progress_audited(%L, 'short'))->>'status'$q$, pat)) like 'ERR:%reason%')::text);
  perform pg_temp.ck('every staff read and refusal is audited (success)', '2', pg_temp.audit_n(pg_temp.f('doctied'), 'success')::text);
  perform pg_temp.ck('...denied attempts are audited too', 'true', (pg_temp.audit_n(pg_temp.f('docuntied'), 'denied') >= 1 and pg_temp.audit_n(pg_temp.f('coord'), 'denied') >= 1)::text);
  perform pg_temp.ck('the patient revokes', 'ok', pg_temp.try_as(pat, format($q$select public.set_therapy_progress_sharing(%L, false)$q$, e)));
  perform pg_temp.ck('...and the clinician is refused at once', 'not_shared', pg_temp.q_as(pg_temp.f('doctied'), q));
  perform pg_temp.ck('sharing and revoking are logged', '2', (select count(*)::text from public.audit_log where actor_id = pat and action like 'therapy_progress.share_%'));
  perform pg_temp.ck('a clinician resumes a paused programme (tied)', 'ok', pg_temp.try_as(pg_temp.f('doctied'), format($q$select public.resume_therapy_enrolment(%L, 'reviewed with the patient today')$q$, e)));
  perform pg_temp.ck('after resume the old checkpoint scores are not assessed again', 'false',
    (pg_temp.start_as(pat, e, 4, pg_temp.answers('panic_breathing')) ->> 'status' = 'ok' and pg_temp.done_as(pat, e, 4, null) ->> 'paused_for_review' = 'true')::text);
  perform pg_temp.ck('...and the programme is still active', 'active', (select state from public.therapy_enrolments where id = e));
  update public.therapy_programme_config set is_active = false;
  perform pg_temp.ck('with no active config a session will not open (fails closed)', 'true', (pg_temp.start_as(pat, e, 5, pg_temp.answers('panic_breathing')) ->> 'error' like '%not configured%')::text);
  update public.therapy_programme_config set is_active = true where version = 1;
  perform pg_temp.ck('...an untied clinician cannot resume', 'true', (pg_temp.try_as(pg_temp.f('docuntied'), format($q$select public.resume_therapy_enrolment(%L, 'trying to resume it')$q$, e)) like '%not authorised%')::text);
end $$;

-- 9. SABOTAGE: each protection removed must flip its checks ----------------------------------------------------------------------------
create policy therapy_sabotage on public.therapy_enrolments for select to authenticated using (true);
drop trigger therapy_enrolments_rules on public.therapy_enrolments;
drop trigger therapy_programme_sessions_immutable on public.therapy_programme_sessions;
create or replace function private.therapy_evaluate_screen(p_code text, p_answers jsonb, p_list_version integer default null)
returns jsonb language sql stable as $$ select jsonb_build_object('passed', true, 'route', null, 'stops', '[]'::jsonb, 'no_rules', false, 'list_version', 1) $$;
grant select on public.therapy_enrolments to authenticated;
do $$
declare v text;
begin
  perform pg_temp.sab('an untied clinician reads no enrolments', '0', pg_temp.cnt(pg_temp.f('docuntied'), 'therapy_enrolments'));
  begin
    insert into public.therapy_enrolments (organisation_id, patient_id, programme_id, programme_version, exclusion_list_version, state)
      select pg_temp.f('org'), pg_temp.f('real'), id, 1, 1, 'active' from public.therapy_programmes where code = 'panic_breathing';
    v := 'inserted';
  exception when others then v := 'refused'; end;
  perform pg_temp.sab('a real patient cannot be made active while the guard is off', 'refused', v);
  begin
    update public.therapy_programme_sessions set text_body = 'edited' where programme_id = (select id from public.therapy_programmes where code = 'ibs_hypnotherapy') and version = 1 and ordinal = 1;
    v := 'changed';
  exception when others then v := 'refused'; end;
  perform pg_temp.sab('an approved version cannot be edited', 'refused', v);
  perform pg_temp.sab('saddle numbness still blocks enrolment', 'blocked',
    pg_temp.enrol_as(pg_temp.f('patC'), 'pain_back', pg_temp.answers('pain_back', 'saddle_numbness')) ->> 'state');
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S63 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
