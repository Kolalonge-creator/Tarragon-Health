-- W-02 proof: override_alert_level + alert_override_events, task reasons, case brief feedback, CMO count functions
-- (migration *_w02_override_reason_codes_and_brief_feedback.sql). NOT EXECUTED LOCALLY when written (Docker was down); the CI replay is its first run.
--   1. override_alert_level: clinicians only (a coordinator, patient or anon is refused), reason required, code optional, the live trigger fills
--      overridden_by/overridden_at, the system's own level is untouched, every override leaves an append-only event; clinician_alerts has no code column.
--   2. Task reasons: accepted from the caller who held the claim at ANY time (history), once per task; others refused.
--   3. Brief feedback: needs a real relationship to the patient; a code only with unsafe or missing; changing one's mind inserts a new row.
--   4. Every raw table is readable by its author only: another clinician, the CMO and an admin select none.
--   5. CMO counts: CMO only, groups under 3 omitted, latest answer per clinician and brief, no clinician column.
--   6. SABOTAGE: the override update, claim history, the relationship check, the CMO check and the minimum group size each removed.
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
  values (v, 'w02-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'W02 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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
  values (p_org, v, 'W02 ' || p_label, 'MDCN', 'W01-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_cmo uuid; v_coord uuid; v_pat uuid; v_pat2 uuid; v_task uuid; v_task2 uuid; v_brief uuid; v_brief2 uuid; v_alert uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_other := pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_coord := pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('coord', v_coord); perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2);
  -- the doctor is on pat's care team (a real relationship); nobody is on pat2's
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());
  set local session_replication_role = replica;
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state,
      claimed_by, claimed_at, claim_expires_at, is_test)
  select v_org, tt.code, tt.version, 5, 5, v_pat, 'senior_medical_officer', now() + interval '1 day', 'claimed', v_doc, now(), now() + interval '1 hour', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task;
  -- a task the doctor held earlier and handed back (claimed_by is empty now, the claim is in the history)
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test)
  select v_org, tt.code, tt.version, 5, 5, v_pat, 'senior_medical_officer', now() + interval '1 day', 'created', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task2;
  insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
  values (v_org, v_task2, v_doc, now() - interval '1 hour', now() - interval '30 minutes', now() - interval '40 minutes', 'handed_back', true);
  insert into public.case_briefs (organisation_id, clinician_alert_id, patient_id, status, model_id, input_snapshot)
  values (v_org, gen_random_uuid(), v_pat, 'generated', 'w02-proof', '{}'::jsonb) returning id into v_brief;
  insert into public.case_briefs (organisation_id, clinician_alert_id, patient_id, status, model_id, input_snapshot)
  values (v_org, gen_random_uuid(), v_pat2, 'generated', 'w02-proof', '{}'::jsonb) returning id into v_brief2;
  insert into public.clinician_alerts (organisation_id, patient_id, level, title) values (v_org, v_pat, 'clinician_review', 'W02 proof alert') returning id into v_alert;
  set local session_replication_role = origin;
  perform pg_temp.setf('task', v_task); perform pg_temp.setf('task2', v_task2); perform pg_temp.setf('brief', v_brief); perform pg_temp.setf('brief2', v_brief2); perform pg_temp.setf('alert', v_alert);
end $$;

-- 1. Alert override through the function ---------------------------------------------------------------------------------------
do $$
declare r text;
begin
  insert into results values ('real', 'clinician_alerts has no override_reason_code column', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'clinician_alerts' and column_name = 'override_reason_code'));
  r := pg_temp.q_as(pg_temp.f('coord'), format($q$select public.override_alert_level(%L, 'urgent_escalation', 'a coordinator tries', 'other')::text$q$, pg_temp.f('alert')));
  insert into results values ('real', 'a care coordinator cannot override an alert', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('pat'), format($q$select public.override_alert_level(%L, 'urgent_escalation', 'a patient tries', 'other')::text$q$, pg_temp.f('alert')));
  insert into results values ('real', 'a patient cannot override an alert', 'ERR:42501', r);
  r := pg_temp.try_anon(format($q$select public.override_alert_level(%L, 'urgent_escalation', 'anon tries', null)$q$, pg_temp.f('alert')));
  insert into results values ('real', 'anon cannot override an alert', '42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.override_alert_level(%L, 'urgent_escalation', '', null)::text$q$, pg_temp.f('alert')));
  insert into results values ('real', 'a reason is required', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.override_alert_level(%L, 'urgent_escalation', 'Known history raises this', 'context_known')::text$q$, pg_temp.f('alert')));
  insert into results values ('real', 'a clinician overrides with a code', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'the live trigger filled overridden_by and overridden_at, and the level and reason were set', 'true',
    (select (override_level = 'urgent_escalation' and override_reason = 'Known history raises this' and overridden_by is not null and overridden_at is not null)::text
       from public.clinician_alerts where id = pg_temp.f('alert')));
  insert into results values ('real', 'the system''s own level is untouched', 'clinician_review', (select level::text from public.clinician_alerts where id = pg_temp.f('alert')));
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.override_alert_level(%L, 'emergency', 'No code given this time', null)::text$q$, pg_temp.f('alert')));
  insert into results values ('real', 'the code is optional', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'both overrides are on record', '2', (select count(*)::text from public.alert_override_events where alert_id = pg_temp.f('alert')));
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.alert_override_events');
  insert into results values ('real', 'the clinician reads their own events', '2', r);
  r := pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.alert_override_events');
  insert into results values ('real', 'another clinician reads none', '0', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.alert_override_events');
  insert into results values ('real', 'the CMO cannot select other clinicians'' override events', '0', r);
  r := pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.alert_override_events');
  insert into results values ('real', 'an admin cannot select override events either', '0', r);
  begin
    update public.alert_override_events set reason = 'edited';
    insert into results values ('real', 'override events cannot be edited', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'override events cannot be edited', 'raised', 'raised');
  end;
end $$;

-- 2. Task reasons: claim history ----------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'context_known')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'the clinician who holds the task records a reason', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'a second reason for the same task is refused', 'ERR:23505', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'data_error')::text$q$, pg_temp.f('task2')));
  insert into results values ('real', 'a task held earlier (claim history) is accepted, so finishing it does not race the reason', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, pg_temp.f('task2')));
  insert into results values ('real', 'a clinician who never held the task is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'a patient is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'not_a_code')::text$q$, pg_temp.f('task')));
  insert into results values ('real', 'a code outside the list is refused', 'ERR:22P02', r);
  r := pg_temp.try_anon(format($q$select public.record_task_override_reason(%L, 'other')$q$, pg_temp.f('task')));
  insert into results values ('real', 'anon is refused', '42501', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.clinical_task_override_reasons');
  insert into results values ('real', 'the CMO cannot select other clinicians'' task reasons', '0', r);
  r := pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.clinical_task_override_reasons');
  insert into results values ('real', 'another clinician reads none', '0', r);
end $$;

-- 3. Brief feedback: relationship, code rule, latest wins ----------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_case_brief_feedback(%L, 'unsafe', 'data_error')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a clinician on the patient''s care team records feedback with a code', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_case_brief_feedback(%L, 'useful')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a clinician with no relationship to the patient is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_case_brief_feedback(%L, 'useful')::text$q$, pg_temp.f('brief2')));
  insert into results values ('real', 'a brief for a patient they are not tied to is refused', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_case_brief_feedback(%L, 'useful', 'other')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a code with ''useful'' is refused', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_case_brief_feedback(%L, 'great')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a feedback value outside the list is refused', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_case_brief_feedback(%L, 'useful')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'changing their mind inserts a new row', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'both rows are kept', '2', (select count(*)::text from public.case_brief_feedback where case_brief_id = pg_temp.f('brief')));
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.case_brief_feedback');
  insert into results values ('real', 'the CMO cannot select other clinicians'' feedback', '0', r);
  r := pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_case_brief_feedback(%L, 'useful')::text$q$, pg_temp.f('brief')));
  insert into results values ('real', 'a patient is refused', 'ERR:42501', r);
end $$;

-- 4. Aggregates: CMO only, groups of 3 or more, latest answer per clinician and brief, no clinician field ---------------------
do $$
declare r text; v_org uuid := pg_temp.f('org'); v_i integer; v_d uuid; v_b uuid; v_p uuid; v_x1 uuid; v_x2 uuid;
begin
  v_x1 := pg_temp.mkdoc(v_org, 'x1', 'senior_medical_officer', pg_temp.f('admin'));
  v_x2 := pg_temp.mkdoc(v_org, 'x2', 'senior_medical_officer', pg_temp.f('admin'));
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.alert_override_reason_counts()');
  insert into results values ('real', 'a code used twice is not shown (group under 3)', '0', r);
  set local session_replication_role = replica;
  for v_i in 1..3 loop
    insert into public.alert_override_events (organisation_id, alert_id, clinician_profile_id, level, reason, code, is_test)
    values (v_org, pg_temp.f('alert'), pg_temp.f('doc'), 'urgent_escalation', 'proof ' || v_i, 'system_too_low', false);
  end loop;
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select string_agg(code::text || '':'' || responses, '','') from public.alert_override_reason_counts()');
  insert into results values ('real', 'three of one code are shown as a count', 'system_too_low:3', r);
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.alert_override_reason_counts()');
  insert into results values ('real', 'a doctor who is not the CMO cannot read the counts', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.task_override_reason_counts()');
  insert into results values ('real', 'the task counts function runs for the CMO', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.task_override_reason_counts()');
  insert into results values ('real', 'a doctor cannot read the task counts', 'ERR:42501', r);
  -- three clinicians' latest answers on one brief: the doctor's two rows count once (latest = useful)
  v_b := pg_temp.f('brief'); v_p := pg_temp.f('pat');
  set local session_replication_role = replica;
  insert into public.case_brief_feedback (organisation_id, case_brief_id, clinician_profile_id, feedback, is_test)
  values (v_org, v_b, v_x1, 'useful', false), (v_org, v_b, v_x2, 'useful', false);
  -- the doctor changed their mind in a later transaction in real life; here the later row is given a later time
  update public.case_brief_feedback set created_at = created_at + interval '1 second' where feedback = 'useful' and clinician_profile_id = pg_temp.f('doc');
  update public.case_brief_feedback set is_test = false;
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select string_agg(feedback || '':'' || responses, '','') from public.case_brief_feedback_counts()');
  insert into results values ('real', 'brief counts use each clinician''s latest answer only (three people, all now useful)', 'useful:3', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from information_schema.parameters p where p.specific_name ~ ''(case_brief_feedback_counts|task_override_reason_counts|alert_override_reason_counts)'' and p.parameter_mode = ''OUT'' and p.parameter_name ilike ''%clinician%''');
  insert into results values ('real', 'no aggregate has a clinician column', '0', r);
end $$;

-- 5. SABOTAGE ------------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; r text; v_alert2 uuid; v_task3 uuid; v_alert1 uuid;
begin
  -- the real-phase twin of sabotage 1, on a fresh alert
  set local session_replication_role = replica;
  insert into public.clinician_alerts (organisation_id, patient_id, level, title) values (pg_temp.f('org'), pg_temp.f('pat'), 'clinician_review', 'W02 real alert') returning id into v_alert1;
  set local session_replication_role = origin;
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.override_alert_level(%L, 'routine', 'real step', 'other')::text$q$, v_alert1));
  insert into results values ('real', 'the override function sets the level', 'routine', coalesce((select override_level::text from public.clinician_alerts where id = v_alert1), 'none'));
  -- (1) the update removed from the override function: the level is never set
  v_orig := pg_get_functiondef('public.override_alert_level(uuid,public.alert_level,text,public.override_reason_code)'::regprocedure);
  v_def := replace(v_orig, 'update public.clinician_alerts set override_level = p_level, override_reason = btrim(p_reason) where id = p_alert;', 'null;');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  set local session_replication_role = replica;
  insert into public.clinician_alerts (organisation_id, patient_id, level, title) values (pg_temp.f('org'), pg_temp.f('pat'), 'clinician_review', 'W02 sabotage alert') returning id into v_alert2;
  set local session_replication_role = origin;
  perform pg_temp.q_as(pg_temp.f('doc'), format($q$select public.override_alert_level(%L, 'routine', 'sabotage step', 'other')::text$q$, v_alert2));
  insert into results values ('sabotaged', 'the override function sets the level', 'routine', coalesce((select override_level::text from public.clinician_alerts where id = v_alert2), 'none'));

  -- (2) claim history ignored: only the current holder passes
  v_orig := pg_get_functiondef('public.record_task_override_reason(uuid,public.override_reason_code)'::regprocedure);
  v_def := replace(v_orig, ' or exists (select 1 from public.task_claims c where c.task_id = t.id and c.clinician_id = v_uid)', '');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  set local session_replication_role = replica;
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test)
  select pg_temp.f('org'), tt.code, tt.version, 5, 5, pg_temp.f('pat'), 'senior_medical_officer', now() + interval '1 day', 'created', true
    from public.task_types tt order by tt.code limit 1 returning id into v_task3;
  insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
  values (pg_temp.f('org'), v_task3, pg_temp.f('doc'), now() - interval '1 hour', now() - interval '30 minutes', now() - interval '40 minutes', 'handed_back', true);
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_task_override_reason(%L, 'other')::text$q$, v_task3));
  insert into results values ('sabotaged', 'a task held earlier (claim history) is accepted, so finishing it does not race the reason', 'true', (r !~ '^ERR')::text);

  -- (3) the relationship check removed from brief feedback
  v_orig := pg_get_functiondef('public.record_case_brief_feedback(uuid,text,public.override_reason_code)'::regprocedure);
  v_def := replace(v_orig, ' or not private.clinician_has_patient_access(b.patient_id)', '');
  if v_def = v_orig then raise exception 'SABOTAGE 3 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('other'), format($q$select public.record_case_brief_feedback(%L, 'useful')::text$q$, pg_temp.f('brief')));
  insert into results values ('sabotaged', 'a clinician with no relationship to the patient is refused', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);

  -- (4) the CMO check removed from the alert counts
  v_orig := pg_get_functiondef('public.alert_override_reason_counts()'::regprocedure);
  v_def := replace(v_orig, 'if not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE 4 not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.alert_override_reason_counts()');
  insert into results values ('sabotaged', 'a doctor who is not the CMO cannot read the counts', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);

  -- (5) the minimum group size removed from the alert counts
  v_orig := pg_get_functiondef('public.alert_override_reason_counts()'::regprocedure);
  v_def := replace(v_orig, 'having count(*) >= 3', '');
  if v_def = v_orig then raise exception 'SABOTAGE 5 not applied'; end if;
  execute v_def;
  set local session_replication_role = replica;
  insert into public.alert_override_events (organisation_id, alert_id, clinician_profile_id, level, reason, code, is_test)
  values (pg_temp.f('org'), pg_temp.f('alert'), pg_temp.f('doc'), 'routine', 'proof single', 'data_error', false);
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), 'select count(*) filter (where code = ''data_error'')::text from public.alert_override_reason_counts()');
  insert into results values ('sabotaged', 'a code used once is not shown (group under 3)', '0', r);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W02 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
