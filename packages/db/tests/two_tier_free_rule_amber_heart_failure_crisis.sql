-- Two-tier Free rule extension proof (migration *_two_tier_free_rule_amber_heart_failure_crisis.sql; needs the free red path).
--
-- Proves in one rolled-back transaction:
--   1. AMBER: a Free patient's amber triage event that asks for a task creates no clinical task and one calm Free record
--      (kind amber, neutral notice); amber with no task action creates nothing; a Member gets the task as before; undeterminable
--      membership gets the task; a repeat adds nothing.
--   2. HEART FAILURE: a rapid weight gain on Free raises no clinician alert, opens one Free record (kind heart_failure) however
--      many readings follow; a Member is alerted as before; undeterminable membership alerts.
--   3. CRISIS (the part in git): a crisis answer on Free writes the emergency event, raises no clinician alert and opens the
--      Free record, so the crisis guidance screen is still shown; a Member's raises the Priority 1 alert. The live-only function
--      private.raise_crisis_follow_up is patched from its own text: a stand-in with the live shape proves the patch skips the task
--      and the page on Free, and leaves a Member untouched.
--   4. Guidance RPCs: only the owner reads and acknowledges; a clinician, the CMO and an admin read nothing.
--   5. SABOTAGE: a gate stuck open (Free gets a task, Free gets an alert) and a gate stuck shut (a Member loses the alert) must
--      flip the matching checks.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'tt2-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'TT2 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.amber(p_patient uuid, p_set uuid, p_actions jsonb) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), 'amber', 'A1', p_set, v_rs.code, v_rs.version, v_rs.status,
         p_actions, false, true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
-- two weights, the second more than 2 kg above the first within three days
create function pg_temp.gain(p_patient uuid, p_org uuid) returns void language plpgsql as
$f$ begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at) values (p_org, p_patient, 'weight', 80.0, now() - interval '2 days');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at) values (p_org, p_patient, 'weight', 83.0, now() - interval '1 hour');
end $f$;
create function pg_temp.enrol_hf(p_patient uuid, p_org uuid) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;   -- fixture only: the heart-failure programme is not switched on in a fresh database
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id)
  select p_org, p_patient, id from public.chronic_condition_programmes where condition = 'heart_failure' limit 1;
  set local session_replication_role = origin;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_rs uuid;
  fa uuid; ma uuid; ua uuid; fh uuid; mh uuid; uh uuid; fc uuid; mc uuid; v_fre uuid; v_orig text; v_n text;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; v_screen uuid;
  v_acts jsonb := '[{"kind":"create_task","task":"bp_review","dueMinutes":1440}]'::jsonb;
  v_ok boolean; v_def text; v_new text; v_marker text := E'  select coalesce(is_test, false) into v_test from public.profiles where id = s.patient_id;\n';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  fa := pg_temp.mkuser(v_org, 'free-amber', 'patient'); ma := pg_temp.mkuser(v_org, 'member-amber', 'patient'); ua := pg_temp.mkuser(v_org, 'unknown-amber', 'patient');
  fh := pg_temp.mkuser(v_org, 'free-hf', 'patient'); mh := pg_temp.mkuser(v_org, 'member-hf', 'patient'); uh := pg_temp.mkuser(v_org, 'unknown-hf', 'patient');
  fc := pg_temp.mkuser(v_org, 'free-crisis', 'patient'); mc := pg_temp.mkuser(v_org, 'member-crisis', 'patient');
  insert into fx values ('fa', fa), ('ma', ma), ('fh', fh), ('mh', mh), ('uh', uh), ('ua', ua), ('rs', gen_random_uuid());
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test)
  values (v_org, ma, 'purchase', 'active', true), (v_org, mh, 'purchase', 'active', true), (v_org, mc, 'purchase', 'active', true);
  -- an approved rule set as a fixture (the approver trigger is skipped; this is a rolled-back proof transaction)
  set local session_replication_role = replica;
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('tt2test', 1, 'approved', '{"code":"tt2test","version":1}'::jsonb, v_cmo, now(), 'proof fixture') returning id into v_rs;
  set local session_replication_role = origin;
  update fx set id = v_rs where label = 'rs';

  -- 1. AMBER ---------------------------------------------------------------------------------------------------
  e1 := pg_temp.amber(fa, v_rs, v_acts);
  perform pg_temp.rec('amber, Free: no task is created', '0', public.create_tasks_from_triage_event(e1)::text);
  perform pg_temp.rec('amber, Free: no clinical task exists', '0', (select count(*)::text from public.clinical_tasks where patient_id = fa));
  perform pg_temp.rec('amber, Free: one calm Free record, no emergency event', '1,amber,0',
    (select count(*)::text || ',' || min(kind) from public.free_red_events where patient_id = fa) || ',' || (select count(*)::text from public.emergency_events where patient_id = fa));
  perform pg_temp.rec('amber, Free: the notice is neutral, in-app, critical', '1,{}',
    (select count(*)::text || ',' || min(payload::text) from public.notifications where recipient_id = fa and template = 'free_red_guidance' and channel = 'in_app' and priority = 'critical'));
  perform pg_temp.rec('amber, Free: a repeat adds nothing', '0,1', public.create_tasks_from_triage_event(e1)::text || ',' || (select count(*)::text from public.free_red_events where patient_id = fa));
  perform pg_temp.rec('amber with no task action creates no record', '0,0',
    public.create_tasks_from_triage_event(pg_temp.amber(fa, v_rs, '[]'::jsonb))::text || ',' || ((select count(*) from public.free_red_events where patient_id = fa) - 1)::text);
  e2 := pg_temp.amber(ma, v_rs, v_acts);
  perform pg_temp.rec('amber, Member: the task path runs as before and opens no Free record', '1,0',
    public.create_tasks_from_triage_event(e2)::text || ',' || (select count(*)::text from public.free_red_events where patient_id = ma));
  v_orig := pg_get_functiondef('private.patient_is_member(uuid)'::regprocedure);
  create or replace function private.patient_is_member(p_patient uuid) returns boolean language plpgsql as $f$ begin raise exception 'membership store unavailable'; end $f$;
  e3 := pg_temp.amber(ua, v_rs, v_acts);
  perform pg_temp.rec('amber, undeterminable membership: the task is created', '1', public.create_tasks_from_triage_event(e3)::text);
  execute v_orig;

  -- 2. HEART FAILURE -------------------------------------------------------------------------------------------
  perform pg_temp.enrol_hf(fh, v_org); perform pg_temp.enrol_hf(mh, v_org); perform pg_temp.enrol_hf(uh, v_org);
  perform pg_temp.gain(fh, v_org);
  perform pg_temp.rec('heart failure, Free: no clinician alert', '0', (select count(*)::text from public.clinician_alerts where patient_id = fh));
  perform pg_temp.rec('heart failure, Free: one Free record of that kind', '1,heart_failure', (select count(*)::text || ',' || min(kind) from public.free_red_events where patient_id = fh));
  perform pg_temp.rec('heart failure, Free: the audit line says no doctor was alerted', 'false',
    (select (event ->> 'doctor_alerted') from public.audit_log where action = 'heart_failure_weight_gain.raised' and actor_id = fh and entity_type = 'vitals_readings' order by created_at desc limit 1));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at) values (v_org, fh, 'weight', 83.5, now() - interval '10 minutes');
  perform pg_temp.rec('heart failure, Free: a later reading adds no second record', '1', (select count(*)::text from public.free_red_events where patient_id = fh));
  perform pg_temp.gain(mh, v_org);
  perform pg_temp.rec('heart failure, Member: alerted as before', '1,0', (select count(*)::text from public.clinician_alerts where patient_id = mh and title = 'Heart failure: rapid weight gain') || ',' || (select count(*)::text from public.free_red_events where patient_id = mh));
  create or replace function private.patient_is_member(p_patient uuid) returns boolean language plpgsql as $f$ begin raise exception 'membership store unavailable'; end $f$;
  perform pg_temp.gain(uh, v_org);
  perform pg_temp.rec('heart failure, undeterminable membership: alerted', '1,0', (select count(*)::text from public.clinician_alerts where patient_id = uh and title = 'Heart failure: rapid weight gain') || ',' || (select count(*)::text from public.free_red_events where patient_id = uh));
  execute v_orig;

  -- 3. CRISIS ----------------------------------------------------------------------------------------------------
  -- F1 fix 4 (earlier in the chain) hangs the real follow-up on this table; this proof drives the function by hand through a stand-in, so the trigger is off here (rolled back).
  drop trigger if exists mental_health_screens_crisis_task on public.mental_health_screens;
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged) values (v_org, fc, 'phq9', 20, 'severe', true);
  perform pg_temp.rec('crisis, Free: the emergency event (the crisis guidance screen) is still raised', '1,mental_health_screen',
    (select count(*)::text || ',' || min(source::text) from public.emergency_events where patient_id = fc));
  perform pg_temp.rec('crisis, Free: no clinician alert, the Free record is open', '0,1', (select count(*)::text from public.clinician_alerts where patient_id = fc) || ',' || (select count(*)::text from public.free_red_events where patient_id = fc));
  perform pg_temp.rec('crisis, Free: the emergency event carries no clinician alert, so the screen says no doctor was alerted', 'true', (select (clinician_alert_id is null)::text from public.emergency_events where patient_id = fc));
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged) values (v_org, mc, 'phq9', 20, 'severe', true);
  perform pg_temp.rec('crisis, Member: the Priority 1 alert is raised', '1,0', (select count(*)::text from public.clinician_alerts where patient_id = mc and level = 'emergency') || ',' || (select count(*)::text from public.free_red_events where patient_id = mc));

  -- the live-only follow-up function: a stand-in with its live opening lines, then the migration's own patch step
  -- create or replace: F1 (fix 4) defines the real function earlier in the chain; the stand-in replaces it inside this rolled-back transaction
  create or replace function private.raise_crisis_follow_up(p_screen uuid) returns boolean
  language plpgsql security definer set search_path = '' as $f$
  declare
    s public.mental_health_screens%rowtype;
    v_test boolean;
  begin
    select * into s from public.mental_health_screens where id = p_screen;
    if not found or not s.crisis_flagged then return false; end if;
    select coalesce(is_test, false) into v_test from public.profiles where id = s.patient_id;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event) values (s.organisation_id, 'crisis.task_made', 'mental_health_screen', s.id, '{}'::jsonb);
    return true;
  end; $f$;
  -- the same patch the migration applies, run against the stand-in
  v_def := pg_get_functiondef('private.raise_crisis_follow_up(uuid)'::regprocedure);
  v_new := replace(v_def, v_marker, v_marker ||
    E'  if not private.patient_may_page_doctor(s.patient_id) then\n' ||
    E'    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)\n' ||
    E'      values (s.organisation_id, ''crisis.handled'', ''mental_health_screen'', s.id, jsonb_build_object(''doctor_alerted'', false));\n' ||
    E'    return true;\n' ||
    E'  end if;\n');
  execute v_new;
  perform pg_temp.rec('the migration patch marker exists in the live function shape', 'true', (position('patient_may_page_doctor' in pg_get_functiondef('private.raise_crisis_follow_up(uuid)'::regprocedure)) > 0)::text);
  v_ok := private.raise_crisis_follow_up((select id from public.mental_health_screens where patient_id = fc));
  perform pg_temp.rec('crisis follow-up, Free: no task step, handled with doctor_alerted false', 'true,0,false',
    v_ok::text || ',' || (select count(*)::text from public.audit_log where action = 'crisis.task_made' and entity_id = (select id from public.mental_health_screens where patient_id = fc)) || ',' ||
    (select (event ->> 'doctor_alerted') from public.audit_log where action = 'crisis.handled' and entity_id = (select id from public.mental_health_screens where patient_id = fc)));
  v_ok := private.raise_crisis_follow_up((select id from public.mental_health_screens where patient_id = mc));
  perform pg_temp.rec('crisis follow-up, Member: the task step still runs', 'true,1',
    v_ok::text || ',' || (select count(*)::text from public.audit_log where action = 'crisis.task_made' and entity_id = (select id from public.mental_health_screens where patient_id = mc)));

  -- 4. Guidance RPCs -------------------------------------------------------------------------------------------
  perform pg_temp.act(fh);
  perform pg_temp.rec('the owner sees one guidance notice, of the right kind', '1,heart_failure', (select count(*)::text || ',' || min(kind) from public.my_free_guidance()));
  v_fre := (select id from public.my_free_guidance());
  perform pg_temp.back();
  perform pg_temp.act(fa);
  perform pg_temp.rec('another patient cannot acknowledge it', '42501', pg_temp.try(format('select public.acknowledge_free_guidance(%L)', v_fre)));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a clinician reads no Free record', '0', (select count(*)::text from public.free_red_events));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin reads no Free record', '0', (select count(*)::text from public.free_red_events));
  perform pg_temp.back();
  perform pg_temp.act(fh);
  perform pg_temp.rec('the owner acknowledges it', 'ok', pg_temp.try(format('select public.acknowledge_free_guidance(%L)', v_fre)));
  perform pg_temp.rec('...and it is gone from the list', '0', (select count(*)::text from public.my_free_guidance()));
  perform pg_temp.back();
end $$;

-- 5. SABOTAGE ------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_rs uuid; v_fa uuid; v_ma uuid; v_gate text; v_acts jsonb := '[{"kind":"create_task","task":"bp_review","dueMinutes":1440}]'::jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_rs from fx where label = 'rs';
  select id into v_fa from fx where label = 'fa';
  select id into v_ma from fx where label = 'ma';
  v_gate := pg_get_functiondef('private.patient_may_page_doctor(uuid)'::regprocedure);

  -- gate stuck open: a Free amber event must then wrongly get a task, and a Free heart-failure gain a clinician alert
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $f$ select true $f$;
  insert into results values ('sabotaged', 'amber, Free: no task is created', '0', public.create_tasks_from_triage_event(pg_temp.amber(v_fa, v_rs, v_acts))::text);
  delete from public.free_red_events where patient_id = (select id from fx where label = 'fh');
  perform set_config('app.allow_clinical_value_delete', 'on', true);   -- S05b: fixture cleanup is a superuser maintenance delete
  delete from public.vitals_readings where patient_id = (select id from fx where label = 'fh');
  perform set_config('app.allow_clinical_value_delete', 'off', true);
  perform pg_temp.gain((select id from fx where label = 'fh'), v_org);
  insert into results values ('sabotaged', 'heart failure, Free: no clinician alert', '0', (select count(*)::text from public.clinician_alerts where patient_id = (select id from fx where label = 'fh')));
  execute v_gate;

  -- gate stuck shut: a Member's amber event must then wrongly get no task
  create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql as $f$ select false $f$;
  insert into results values ('sabotaged', 'amber, Member: the task is created', '1', public.create_tasks_from_triage_event(pg_temp.amber(v_ma, v_rs, v_acts))::text);
  execute v_gate;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Free rule extension proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then
    raise exception 'VACUOUS TEST: only % of 3 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
