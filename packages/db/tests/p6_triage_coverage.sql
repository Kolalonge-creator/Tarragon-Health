-- P6 proof: triage coverage (migration *_p6_triage_coverage.sql).
--
--   1. The daily sweep is born off and does nothing; once on it emits ONE silence.detected per Member per Lagos day, however
--      often it runs, only for active Members with a blood pressure interest (not Free, not a Member with no BP interest,
--      not a Member who read recently), and never again for a cause that already has a triage event.
--   2. Safety case 7 end to end: silence event -> context (care_pack_active) -> recorded result (BP-A5, approved v3, not
--      shadow) -> create_tasks_from_triage_event -> exactly ONE open task; a second day merges into it. A Free patient given
--      the same result gets no task. A redelivered record is a no-op.
--   3. Adherence: a Member whose doses went untaken gets one adherence.below_line event a day and no second event in the week
--      once a triage event with that week's task key exists.
--   4. Symptom report with no reading: a shadow-only triage_events row (rule_set_id null, live_symptom_gate), a shadow
--      triage.graded bus event, and nothing else - no page and no task come from it; the live path still sets is_red_flag;
--      a low-severity report and a report just after a BP reading write nothing here; the check refuses a non-shadow row
--      without a rule set.
--   5. cuff_type: visible in observations.context, in the stored triage context, and in the clinician summary reading rows;
--      the stored context holds the reading and the symptoms the engine saw.
--   6. The explainer: the task holder gets rule id, rule set version, reading and symptoms and exactly one audit row; another
--      clinician, a patient and anon get nothing; shadow rows never reach the summary.
--   7. Grants.
--   8. SABOTAGE: the config put back on, with the Free-patient filter removed; and the shadow-only check dropped. Each must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_check, p_expected, p_actual) $$;
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
  values (v, 'p6-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'P6 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkmember(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient');
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test)
  values (p_org, v, 'purchase', 'active', now() - interval '30 days', true);
  return v;
end $f$;
create function pg_temp.bp_at(p_org uuid, p_patient uuid, p_days integer) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  -- triggers off: a historical fixture reading must not emit an observation event of its own
  set local session_replication_role = replica;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, created_at, source)
  values (p_org, p_patient, 'blood_pressure', 126, 80, now() - make_interval(days => p_days), now() - make_interval(days => p_days), 'device')
  returning id into v;
  set local session_replication_role = origin;
  return v;
end $f$;
create function pg_temp.events_for(p_patient uuid, p_type text) returns integer language sql as
$$ select count(*)::integer from public.domain_events where event_type = p_type and patient_id = p_patient $$;
create function pg_temp.open_tasks(p_patient uuid) returns integer language sql as
$$ select count(*)::integer from public.clinical_tasks where patient_id = p_patient and state not in ('completed', 'cancelled') $$;

-- Result shaped exactly like the engine's for BP-A5 / BP-A4 under the APPROVED rule set.
create function pg_temp.coverage_result(p_rule text, p_task text, p_key text) returns jsonb language plpgsql as
$f$ declare rs public.triage_rule_sets%rowtype;
begin
  select * into rs from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' order by version desc limit 1;
  return jsonb_build_object('status', 'graded', 'grade', 'amber', 'ruleId', p_rule, 'explanationKey', 'TRI-002',
    'actions', jsonb_build_array(jsonb_build_object('kind', 'create_task', 'task', p_task, 'dueMinutes', 2880, 'notifyKey', 'task_created')),
    'matchedRuleIds', jsonb_build_array(p_rule), 'taskKey', p_key, 'duplicateSuppressed', false,
    'ruleSet', jsonb_build_object('code', rs.code, 'version', rs.version));
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_neverread uuid; v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_silent uuid; v_free uuid; v_nobp uuid; v_recent uuid; v_adh uuid; v_sym uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_silent := pg_temp.mkmember(v_org, 'silent-member');
  perform pg_temp.bp_at(v_org, v_silent, 10);
  v_free := pg_temp.mkuser(v_org, 'free', 'patient');            -- no membership
  perform pg_temp.bp_at(v_org, v_free, 12);
  v_nobp := pg_temp.mkmember(v_org, 'member-no-bp');              -- member, no blood pressure interest
  v_neverread := pg_temp.mkmember(v_org, 'member-never-read');    -- member with a hypertension plan and no reading at all
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, v_neverread, 'hypertension', 'active');
  perform pg_temp.setf('neverread', v_neverread);
  v_recent := pg_temp.mkmember(v_org, 'member-recent');
  perform pg_temp.bp_at(v_org, v_recent, 2);
  v_adh := pg_temp.mkmember(v_org, 'member-adherence');
  perform pg_temp.bp_at(v_org, v_adh, 1);
  v_sym := pg_temp.mkuser(v_org, 'symptom-patient', 'patient');
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (v_org, v_adh, 'P6 Test Medicine', '1', 'daily', '["08:00"]', 'patient', true, now() - interval '10 days');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('silent', v_silent); perform pg_temp.setf('free', v_free); perform pg_temp.setf('nobp', v_nobp);
  perform pg_temp.setf('recent', v_recent); perform pg_temp.setf('adh', v_adh); perform pg_temp.setf('sym', v_sym);
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_other := pg_temp.mkuser(v_org, 'other-doc', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  select v_org, d.id, 'P6 doc', 'MDCN', 'P6-' || substr(d.id::text, 1, 8), true, 'active', now(), v_admin,
         'senior_medical_officer', 'contracted', 2, true, v_admin, true
    from (values (v_doc), (v_other)) d(id);
  perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('other', v_other);
end $$;

-- 1. The sweep: born off, then on ---------------------------------------------------------------------------------------
do $$
declare n integer;
begin
  perform pg_temp.res('real', 'the config is born off', 'false',
    (select (rules ->> 'enabled') from public.triage_coverage_config where is_active));
  n := private.sweep_triage_coverage();
  perform pg_temp.res('real', 'off: the sweep emits nothing', '0|0',
    n::text || '|' || (select count(*)::text from public.domain_events where idempotency_key like 'cov:%' and patient_id in
      (pg_temp.f('silent'), pg_temp.f('adh'))));

  update public.triage_coverage_config set rules = jsonb_set(rules, '{enabled}', 'true') where is_active;
  n := private.sweep_triage_coverage();
  perform pg_temp.res('real', 'on: a silent Member gets one silence.detected', '1', pg_temp.events_for(pg_temp.f('silent'), 'silence.detected')::text);
  perform pg_temp.res('real', 'the event carries days and the Lagos day, no reading', 'true|false',
    ((select payload ? 'days' and payload ? 'day' from public.domain_events where patient_id = pg_temp.f('silent') and event_type = 'silence.detected')::text) || '|' ||
    ((select payload ? 'systolic' or payload ? 'percent' from public.domain_events where patient_id = pg_temp.f('silent') and event_type = 'silence.detected')::text));
  perform pg_temp.res('real', 'the silence event has a delivery for the coverage subscriber', '1',
    (select count(*)::text from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
      where e.patient_id = pg_temp.f('silent') and e.event_type = 'silence.detected' and d.subscriber_key = 'triage.grade_silence'));
  perform pg_temp.res('real', 'a Free patient with the same readings gets none', '0', pg_temp.events_for(pg_temp.f('free'), 'silence.detected')::text);
  perform pg_temp.res('real', 'a Member with no blood pressure interest gets none', '0', pg_temp.events_for(pg_temp.f('nobp'), 'silence.detected')::text);
  perform pg_temp.res('real', 'a Member who read two days ago gets none', '0', pg_temp.events_for(pg_temp.f('recent'), 'silence.detected')::text);
  n := private.sweep_triage_coverage();
  n := private.sweep_triage_coverage();
  perform pg_temp.res('real', 'running the sweep three times still gives one event for the day', '1', pg_temp.events_for(pg_temp.f('silent'), 'silence.detected')::text);
end $$;

-- 2. Safety case 7 end to end ---------------------------------------------------------------------------------------------
do $$
declare v_ctx jsonb; v_rs uuid; v_res jsonb; v_out jsonb; v_te uuid; v_made integer; v_key text; v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  v_ctx := public.triage_context_for_coverage(pg_temp.f('silent'), 'silence', v_today);
  perform pg_temp.res('real', 'context: found, a care pack stand-in, a silence trigger with the last reading', 'true|care_pack_active|silence|true',
    (v_ctx ->> 'found') || '|' || (v_ctx #>> '{input,pathway,state}') || '|' || (v_ctx #>> '{input,trigger,type}') || '|' ||
    ((v_ctx #>> '{input,trigger,lastReadingAt}') is not null)::text);
  perform pg_temp.res('real', 'context: a Member who never read has lastReadingAt as a JSON null (the engine input check needs the key)', 'null|true',
    coalesce(jsonb_typeof(public.triage_context_for_coverage(pg_temp.f('neverread'), 'silence', v_today) #> '{input,trigger,lastReadingAt}'), 'missing') || '|' ||
    ((public.triage_context_for_coverage(pg_temp.f('neverread'), 'silence', v_today) #>> '{input,trigger,sinceAt}') is not null)::text);
  perform pg_temp.res('real', 'context: a Free patient is not found', 'false', (public.triage_context_for_coverage(pg_temp.f('free'), 'silence', v_today) ->> 'found'));
  perform pg_temp.res('real', 'context: a Member with no BP interest is not found', 'false', (public.triage_context_for_coverage(pg_temp.f('nobp'), 'silence', v_today) ->> 'found'));

  select id into v_rs from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' order by version desc limit 1;
  v_key := 'BP-A5:' || (select (max(taken_at) at time zone 'Africa/Lagos')::date::text from public.vitals_readings where patient_id = pg_temp.f('silent'));
  v_res := pg_temp.coverage_result('BP-A5', 'silence_check', v_key);
  v_out := public.record_coverage_triage_result(pg_temp.f('silent'), 'silence', v_today, v_res, v_rs, v_ctx -> 'trigger');
  v_te := (v_out ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'recorded: created, not shadow (v3 is approved)', 'true|false', (v_out ->> 'created') || '|' || (v_out ->> 'shadow'));
  perform pg_temp.res('real', 'the stored context is the trigger the engine saw', 'silence', (select context ->> 'type' from public.triage_events where id = v_te));
  v_out := public.record_coverage_triage_result(pg_temp.f('silent'), 'silence', v_today, v_res, v_rs, v_ctx -> 'trigger');
  perform pg_temp.res('real', 'a redelivered record is a no-op on the same event', 'false|true',
    (v_out ->> 'created') || '|' || ((v_out ->> 'triage_event_id')::uuid = v_te)::text);
  perform pg_temp.res('real', 'one triage.graded bus event with shadow false', '1|false',
    (select count(*)::text from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te) || '|' ||
    (select payload ->> 'shadow' from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te));

  v_made := public.create_tasks_from_triage_event(v_te);
  perform pg_temp.res('real', 'SAFETY CASE 7: the silence creates exactly one open task', '1|1', v_made::text || '|' || pg_temp.open_tasks(pg_temp.f('silent'))::text);
  perform pg_temp.res('real', 'the task carries the triage event and rule set version', 'true|true',
    ((select triage_event_id from public.clinical_tasks where patient_id = pg_temp.f('silent') and state not in ('completed','cancelled')) = v_te)::text || '|' ||
    ((select rule_set_version from public.clinical_tasks where patient_id = pg_temp.f('silent') and state not in ('completed','cancelled')) = (select version from public.triage_rule_sets where id = v_rs))::text);

  -- the next day the patient is still silent: the sweep skips it (a triage event with the same task key exists) ...
  perform pg_temp.res('real', 'the next sweep adds no second silence event for the same cause', '1',
    (select count(*)::text from public.domain_events where patient_id = pg_temp.f('silent') and event_type = 'silence.detected'
       and (select count(*) from public.triage_events e where e.patient_id = pg_temp.f('silent') and e.task_key = v_key) = 1));
  perform private.sweep_triage_coverage(now() + interval '1 day');
  perform pg_temp.res('real', 'tomorrow: still one silence event in total', '1', pg_temp.events_for(pg_temp.f('silent'), 'silence.detected')::text);
  -- ... and even if a second result for another day were recorded it merges into the open task
  v_out := public.record_coverage_triage_result(pg_temp.f('silent'), 'silence', v_today + 1, v_res, v_rs, v_ctx -> 'trigger');
  v_made := public.create_tasks_from_triage_event((v_out ->> 'triage_event_id')::uuid);
  perform pg_temp.res('real', 'a second day merges into the open task (still one)', '1', pg_temp.open_tasks(pg_temp.f('silent'))::text);

  -- Free: even if the same result were somehow recorded, no doctor task is made (two-tier)
  v_out := public.record_coverage_triage_result(pg_temp.f('free'), 'silence', v_today, v_res, v_rs, '{"type":"silence"}'::jsonb);
  v_made := public.create_tasks_from_triage_event((v_out ->> 'triage_event_id')::uuid);
  perform pg_temp.res('real', 'a Free patient gets no clinical task from the same result', '0', pg_temp.open_tasks(pg_temp.f('free'))::text);
end $$;

-- 3. Adherence ------------------------------------------------------------------------------------------------------------
do $$
declare v_ctx jsonb; v_rs uuid; v_out jsonb; v_today date := (now() at time zone 'Africa/Lagos')::date; v_key text; v_pct numeric; v_before integer;
begin
  v_pct := (private.weekly_adherence(pg_temp.f('adh')) ->> 'percent')::numeric;
  perform pg_temp.res('real', 'fixture: untaken doses give a percentage under the line', 'true', (v_pct is not null and v_pct < 80)::text);
  perform pg_temp.res('real', 'the adherence event for today was emitted once however often the sweep ran', '1',
    (select count(*)::text from public.domain_events where event_type = 'adherence.below_line' and idempotency_key = 'cov:adherence:' || pg_temp.f('adh') || ':' || v_today));
  perform pg_temp.res('real', 'a Member with no medicines gets no adherence event', '0', pg_temp.events_for(pg_temp.f('recent'), 'adherence.below_line')::text);
  v_ctx := public.triage_context_for_coverage(pg_temp.f('adh'), 'adherence', v_today);
  perform pg_temp.res('real', 'adherence context carries the percentage', 'adherence|true', (v_ctx #>> '{input,trigger,type}') || '|' || ((v_ctx #>> '{input,trigger,percent7d}') is not null)::text);
  select id into v_rs from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' order by version desc limit 1;
  v_key := 'BP-A4:' || to_char(v_today, 'IYYY-"W"IW');
  v_out := public.record_coverage_triage_result(pg_temp.f('adh'), 'adherence', v_today, pg_temp.coverage_result('BP-A4', 'adherence_review', v_key), v_rs, v_ctx -> 'trigger');
  perform public.create_tasks_from_triage_event((v_out ->> 'triage_event_id')::uuid);
  perform pg_temp.res('real', 'one adherence task', '1', pg_temp.open_tasks(pg_temp.f('adh'))::text);
  v_before := pg_temp.events_for(pg_temp.f('adh'), 'adherence.below_line');
  perform private.sweep_triage_coverage(now() + interval '1 day');
  perform pg_temp.res('real', 'no further adherence event while this week already has a triage event', '0', (pg_temp.events_for(pg_temp.f('adh'), 'adherence.below_line') - v_before)::text);
end $$;

-- 4. Symptom report with no reading ---------------------------------------------------------------------------------------
do $$
declare v_s uuid; v_te public.triage_events%rowtype; v_flag boolean; v_err text;
begin
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, reported_at)
    values (pg_temp.f('org'), pg_temp.f('sym'), 'chest_pain', 9, now()) returning id, is_red_flag into v_s, v_flag;
  perform pg_temp.res('real', 'the live path still flags it red', 'true', v_flag::text);
  select * into v_te from public.triage_events where trigger_type = 'symptom_report' and trigger_id = v_s;
  perform pg_temp.res('real', 'a shadow red row with no rule set, named for the live gate', 'red|true|live_symptom_gate|true',
    v_te.grade || '|' || v_te.shadow::text || '|' || v_te.rule_set_code || '|' || (v_te.rule_set_id is null)::text);
  perform pg_temp.res('real', 'red keeps the page action the table requires', 'true', (v_te.actions @> '[{"kind":"page_on_call"}]'::jsonb)::text);
  perform pg_temp.res('real', 'context names the symptom and says there was no reading', 'chest_pain|true',
    (v_te.context #>> '{symptoms,0}') || '|' || (v_te.context ->> 'noReading'));
  perform pg_temp.res('real', 'a shadow triage.graded bus event exists', 'true',
    (select (payload ->> 'shadow')::boolean::text from public.domain_events where event_type = 'triage.graded' and aggregate_id = v_te.id));
  perform pg_temp.res('real', 'it makes no task and no page', '0|0',
    public.create_tasks_from_triage_event(v_te.id)::text || '|' || (select count(*)::text from public.pages where triage_event_id = v_te.id));
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, reported_at)
    values (pg_temp.f('org'), pg_temp.f('sym'), 'nausea', 2, now());
  perform pg_temp.res('real', 'a mild report writes nothing here', '1',
    (select count(*)::text from public.triage_events where patient_id = pg_temp.f('sym') and trigger_type = 'symptom_report'));
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, reported_at)
    values (pg_temp.f('org'), pg_temp.f('sym'), 'dizziness', 6, now());
  perform pg_temp.res('real', 'a moderate report is amber with no page action', 'amber|false',
    (select grade from public.triage_events where patient_id = pg_temp.f('sym') and rule_id = 'SYM-LIVE-REVIEW') || '|' ||
    (select (actions @> '[{"kind":"page_on_call"}]'::jsonb)::text from public.triage_events where patient_id = pg_temp.f('sym') and rule_id = 'SYM-LIVE-REVIEW'));
  -- a symptom just after a BP reading belongs to the observation path (regrade), not to this record
  set local session_replication_role = replica;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (pg_temp.f('org'), pg_temp.f('nobp'), 'blood_pressure', 150, 95, now(), 'device');
  set local session_replication_role = origin;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, reported_at)
    values (pg_temp.f('org'), pg_temp.f('nobp'), 'severe_headache', 9, now());
  perform pg_temp.res('real', 'a symptom right after a BP reading is left to the observation path', '0',
    (select count(*)::text from public.triage_events where patient_id = pg_temp.f('nobp') and trigger_type = 'symptom_report'));
  begin
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions)
      values (pg_temp.f('org'), pg_temp.f('sym'), 'symptom_report', gen_random_uuid(), 'amber', null, 'something_else', 1, 'approved', false, '[]');
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a row with no rule set can never be a live (non-shadow) one', 'refused', v_err);
end $$;

-- 5. cuff type and the stored context ---------------------------------------------------------------------------------------
do $$
declare v_r uuid; v_rs public.triage_rule_sets%rowtype; v_out jsonb; v_te uuid;
begin
  set local session_replication_role = replica;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, created_at, source, cuff_type)
    values (pg_temp.f('org'), pg_temp.f('recent'), 'blood_pressure', 152, 96, now() - interval '1 hour', now() - interval '1 hour', 'manual', 'wrist') returning id into v_r;
  set local session_replication_role = origin;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, reported_at, created_at)
    values (pg_temp.f('org'), pg_temp.f('recent'), 'dizziness', 3, now() - interval '1 hour', now() - interval '1 hour');
  perform pg_temp.res('real', 'observations context carries cuff_type', 'wrist', (select context ->> 'cuff_type' from public.observations where id = v_r));
  select * into v_rs from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' order by version desc limit 1;
  v_out := public.record_triage_result(v_r, jsonb_build_object('status', 'graded', 'grade', 'green', 'ruleId', 'BP-G2', 'explanationKey', 'TRI-003',
    'actions', '[{"kind":"show_message","code":"TRI-003"}]'::jsonb, 'matchedRuleIds', '["BP-G2"]'::jsonb, 'taskKey', null,
    'ruleSet', jsonb_build_object('code', v_rs.code, 'version', v_rs.version)), v_rs.id, null, '');
  v_te := (v_out ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'the stored context has the reading, the cuff and the symptoms', '152|wrist|dizziness',
    (select (context #>> '{reading,systolic}') || '|' || (context ->> 'cuffType') || '|' || (context #>> '{symptoms,0}') from public.triage_events where id = v_te));
  perform pg_temp.setf('cuff_te', v_te);
end $$;

-- 6. The explainer and the summary -------------------------------------------------------------------------------------------
do $$
declare v_te uuid; v_task uuid; v_e jsonb; v_s jsonb; v_audit_before int; v_audit_after int;
begin
  select id into v_te from public.triage_events where patient_id = pg_temp.f('silent') and rule_id = 'BP-A5' order by created_at limit 1;
  select id into v_task from public.clinical_tasks where patient_id = pg_temp.f('silent') and state not in ('completed', 'cancelled');
  -- hold the task for doc (fixture: round the claim machinery, which S17 proves)
  set local session_replication_role = replica;
  update public.clinical_tasks set state = 'claimed', claimed_by = pg_temp.f('doc'), claimed_at = now(), claim_expires_at = now() + interval '30 minutes' where id = v_task;
  set local session_replication_role = origin;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (pg_temp.f('org'), pg_temp.f('silent'), pg_temp.f('doc'), now());

  v_audit_before := (select count(*) from public.audit_log where subject_patient_id = pg_temp.f('silent') and actor_id = pg_temp.f('doc') and event -> 'sections' ? 'triage_explainer');
  perform pg_temp.act(pg_temp.f('doc'));
  v_e := public.clinician_task_triage_explainer(v_task);
  perform pg_temp.back();
  v_audit_after := (select count(*) from public.audit_log where subject_patient_id = pg_temp.f('silent') and actor_id = pg_temp.f('doc') and event -> 'sections' ? 'triage_explainer');
  perform pg_temp.res('real', 'the holder gets rule id, rule set version and the trigger', 'ok|BP-A5|true|silence',
    (v_e ->> 'status') || '|' || (v_e #>> '{triage_event,rule_id}') || '|' || ((v_e #>> '{triage_event,rule_set_version}') is not null)::text || '|' || (v_e #>> '{triage_event,context,type}'));
  perform pg_temp.res('real', 'exactly one audit row for the open', '1', (v_audit_after - v_audit_before)::text);
  perform pg_temp.res('real', 'another clinician is told nothing', 'denied', (pg_temp.q_as(pg_temp.f('other'), format('select (public.clinician_task_triage_explainer(%L)) ->> %L', v_task, 'status'))));
  perform pg_temp.res('real', 'a patient is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('silent'), format('select public.clinician_task_triage_explainer(%L)::text', v_task)));
  perform pg_temp.res('real', 'anon is refused', '42501', pg_temp.try_anon(format('select public.clinician_task_triage_explainer(%L)', v_task)));

end $$;

do $$
declare v_s jsonb;
begin
  perform pg_temp.act(pg_temp.f('doc'));
  v_s := public.clinician_patient_summary(pg_temp.f('silent'), 'Reviewing the summary for a task I hold');
  perform pg_temp.back();
  perform pg_temp.res('real', 'summary triage row has rule id, set code and version', 'BP-A5|bp_care_triage|true',
    (v_s #>> '{triage_events,0,rule_id}') || '|' || (v_s #>> '{triage_events,0,rule_set_code}') || '|' || ((v_s #>> '{triage_events,0,rule_set_version}') is not null)::text);
  -- the cuff reading belongs to 'recent', give the tied doctor that patient too
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (pg_temp.f('org'), pg_temp.f('recent'), pg_temp.f('doc'), now());
  perform pg_temp.act(pg_temp.f('doc'));
  v_s := public.clinician_patient_summary(pg_temp.f('recent'), 'Reviewing the summary for a task I hold');
  perform pg_temp.back();
  perform pg_temp.res('real', 'summary reading rows show the cuff type', 'wrist',
    (select r ->> 'cuff_type' from jsonb_array_elements(v_s -> 'readings' -> 'rows') r where (r ->> 'systolic')::int = 152 limit 1));
  perform pg_temp.res('real', 'a shadow symptom-report row never reaches the summary', '0',
    (select count(*)::text from jsonb_array_elements(coalesce(v_s -> 'triage_events', '[]'::jsonb)) e where e ->> 'trigger_type' = 'symptom_report'));
end $$;

-- 6b. The task tie ends with the task (review finding): a finished task opens nothing for the clinician who held it ------------
do $$
declare v_task uuid; v_e jsonb;
begin
  select id into v_task from public.clinical_tasks where patient_id = pg_temp.f('silent') and claimed_by = pg_temp.f('doc') and state = 'claimed';
  perform pg_temp.res('real', 'while held, the holder reads it', 'ok', pg_temp.q_as(pg_temp.f('doc'), format('select (public.clinician_task_triage_explainer(%L)) ->> %L', v_task, 'status')));
  -- finish the task and drop every other tie
  set local session_replication_role = replica;
  update public.clinical_tasks set state = 'completed', completed_at = now(), outcome = '{"note":"done for the proof"}'::jsonb where id = v_task;
  set local session_replication_role = origin;
  delete from public.care_team_assignment where patient_id = pg_temp.f('silent') and clinician_id = pg_temp.f('doc');
  perform pg_temp.res('real', 'after completion, with no other tie, the former holder is told nothing', 'denied',
    pg_temp.q_as(pg_temp.f('doc'), format('select (public.clinician_task_triage_explainer(%L)) ->> %L', v_task, 'status')));
end $$;

-- 6c. A failing check for one Member is recorded, does not stop the rest, and does not undo the other trigger's event -------------
do $$
declare n integer; v_before integer; v_inc integer;
begin
  v_before := pg_temp.events_for(pg_temp.f('adh'), 'silence.detected');
  -- no active medicine_config makes private.weekly_adherence raise for every Member with a reading interest
  update public.medicine_config set is_active = false where is_active;
  n := private.sweep_triage_coverage(now() + interval '40 days');
  perform pg_temp.res('real', 'a failing adherence check is written to the audit log, once per Member it hit', 'true',
    ((select count(*) from public.audit_log where action = 'triage_coverage_sweep.error' and entity_id = pg_temp.f('adh')) >= 1)::text);
  perform pg_temp.res('real', 'and opens one operations incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'triage_coverage_sweep' and status not in ('resolved', 'closed')));
  perform pg_temp.res('real', 'the same Member still gets the silence event (a failure never rolls back the other trigger)', 'true',
    (pg_temp.events_for(pg_temp.f('adh'), 'silence.detected') > v_before)::text);
  n := private.sweep_triage_coverage(now() + interval '41 days');
  perform pg_temp.res('real', 'a second failing run does not open a second incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'triage_coverage_sweep' and status not in ('resolved', 'closed')));
end $$;

-- 7. Grants -------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.res('real', 'the coverage context and record functions are service role only', 'false|false|true|true',
    has_function_privilege('anon', 'public.triage_context_for_coverage(uuid, text, date)', 'execute')::text || '|' ||
    has_function_privilege('authenticated', 'public.record_coverage_triage_result(uuid, text, date, jsonb, uuid, jsonb, uuid)', 'execute')::text || '|' ||
    has_function_privilege('service_role', 'public.triage_context_for_coverage(uuid, text, date)', 'execute')::text || '|' ||
    has_function_privilege('service_role', 'public.record_coverage_triage_result(uuid, text, date, jsonb, uuid, jsonb, uuid)', 'execute')::text);
  perform pg_temp.res('real', 'the sweep is not callable by a signed-in user', 'false', has_function_privilege('authenticated', 'private.sweep_triage_coverage(timestamptz)', 'execute')::text);
  perform pg_temp.res('real', 'one cron job at 06:52 UTC', '52 6 * * *', (select schedule from cron.job where jobname = 'triage-coverage-daily'));
end $$;

-- 8. SABOTAGE -------------------------------------------------------------------------------------------------------------------
do $$
declare v_free_events int;
begin
  -- (a) the Member filter taken out of the candidate function: a Free patient must start getting events, flipping check 1
  execute format($e$create or replace function private.triage_coverage_candidates(p_now timestamptz, p_patient uuid default null)
  returns table (patient_id uuid, organisation_id uuid, since_at timestamptz, last_reading_at timestamptz)
  language sql stable security definer set search_path = '' as $f$
    select pr.id, pr.organisation_id, pr.created_at, (select max(v.taken_at) from public.vitals_readings v where v.patient_id = pr.id and v.vital_type::text = 'blood_pressure')
      from public.profiles pr where pr.role = 'patient' and pr.is_active and pr.id = %L::uuid
  $f$
  $e$, pg_temp.f('free'));
  perform private.sweep_triage_coverage(now() + interval '2 days');
  v_free_events := pg_temp.events_for(pg_temp.f('free'), 'silence.detected');
  insert into results values ('sabotaged', 'a Free patient with the same readings gets none', '0', v_free_events::text);

  -- (b) the shadow-only check dropped: a live row without a rule set is accepted
  alter table public.triage_events drop constraint triage_events_no_rule_set_means_shadow;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, actions)
    values (pg_temp.f('org'), pg_temp.f('sym'), 'symptom_report', gen_random_uuid(), 'amber', null, 'something_else', 1, 'approved', false, '[]');
  insert into results values ('sabotaged', 'a row with no rule set can never be a live (non-shadow) one', 'refused', 'accepted');
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'P6 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) < 2 then
    raise exception 'VACUOUS TEST: the sabotage did not change both outcomes';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results order by phase desc, check_name;

rollback;
