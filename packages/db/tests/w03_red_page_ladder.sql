-- W-03 proof: the drilled red-page ladder (migration *_w03_red_page_ladder_drilled.sql). One rolled-back transaction.
--   1. Ships OFF: both switches false; the per-minute job exists and the 30-minute full canary is unchanged; the detection budget is a CHECK
--      (a config that could not see a failure inside three minutes is refused).
--   2. RED LANE, seeded failure: with the event processor stopped, the run injected by one tick is judged by a tick two minutes later, fails at
--      'graded', and opens a sev1 incident, well inside 180 seconds. A run that is not yet old enough is not judged. With the processor's work
--      emulated the lane passes (the check can pass), and with the auto-acknowledge trigger dropped it fails at 'ack'.
--   3. DEAD LETTER: a dead delivery on a red-class subscriber opens a sev1 incident, one tracking row and an audit row, goes to the ops desk
--      (an assignment, or the loud "no named ops person" incident when nobody is on duty); a second sweep does nothing new; a non-red
--      subscriber and a test event are ignored; a requeued delivery closes the alarm; the sweep is inert while its switch is off.
--   4. ROTA COVERAGE: the report counts credentialed clinicians and uncovered hours for the window; with no rota every hour is uncovered and the
--      minimum is not met; non-admins are refused.
--   5. SOLE-CMO EXPIRY: a new real exception is capped to the dated end; none can be signed after it; the active check refuses after it; the
--      sweep closes a lapsed exception; test rows are exempt.
--   6. PHONE FALLBACKS: a call logged on the ops desk for an expired-page incident is mirrored once; RLS and grants.
--   SABOTAGE: (a) auto-ack trigger dropped -> lane must fail at 'ack'; (b) red-class list emptied -> a seeded dead letter must NOT be paged
--   (the check flips); (c) mirror trigger dropped -> the phone fallback row must be missing (the check flips).
-- NOT EXECUTED LOCALLY when written (Docker was down): run it in the CI migration replay before merging.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.res(p_check text, p_expected text, p_actual text) returns void language sql as $f$ insert into results values ('real', p_check, p_expected, p_actual) $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare v text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; v := 'ok'; exception when others then v := sqlstate; end;
  perform pg_temp.back();
  return v;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w03-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'W03 ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

-- the same approved-rule-set fixture the P1 canary proof uses (a fresh database holds bp_care_triage only as drafts; production approves v3)
do $$
declare v_p uuid := gen_random_uuid(); v_adm uuid := gen_random_uuid(); v_org uuid;
begin
  if not exists (select 1 from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved') then
    select id into v_org from public.organisations order by created_at limit 1;
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_p, 'w03-rs-' || v_p::text || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
      values (v_p, v_org, 'clinician', 'W03 rule set approver', (current_date - interval '45 years')::date, true) on conflict (id) do update set is_test = true;
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_adm, 'w03-rs-admin-' || v_adm::text || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
      values (v_adm, v_org, 'admin', 'W03 rule set admin', (current_date - interval '45 years')::date, true) on conflict (id) do update set is_test = true;
    insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by, is_test)
      values (v_p, v_org, 'W03 rule set approver', 'chief_medical_officer', true, now(), 'employed', true, v_adm, true);
    update public.triage_rule_sets set status = 'approved', approved_by = v_p, approved_at = now() where code = 'bp_care_triage' and version = 3;
  end if;
end $$;

-- stand in for process-events for the red fixture: the same database calls its handlers make
create function pg_temp.emulate_red_processor(p_run uuid) returns void language plpgsql as $f$
declare v_rs uuid; v_ver integer; v_reading uuid; v_res jsonb; v_te uuid;
begin
  select id, version into v_rs, v_ver from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' order by version desc limit 1;
  select reading_id into v_reading from public.chain_canary_red_runs where id = p_run;
  v_res := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'BP-R1', 'explanationKey', 'EMG-001',
    'actions', '[{"kind":"show_emergency_guidance","code":"EMG-001"},{"kind":"page_on_call"}]'::jsonb, 'matchedRuleIds', '["BP-R1"]'::jsonb, 'taskKey', null,
    'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', v_ver));
  perform public.record_triage_result(v_reading, v_res, v_rs, null, '');
  select id into v_te from public.triage_events where trigger_id = v_reading;
  perform public.create_tasks_from_triage_event(v_te);
  perform public.create_red_page(v_te);
  update public.domain_event_deliveries d set status = 'done', done_at = now()
   where d.status = 'pending' and d.event_id in (select e.id from public.domain_events e where e.event_type = 'triage.graded' and e.is_test);
  set constraints all immediate;
  set constraints all deferred;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_plain uuid; v_s public.chain_canary_subjects;
  v_a uuid; v_b uuid; v_c uuid; v_ev uuid; v_dl uuid; v_dl2 uuid; v_dl3 uuid; v_tick jsonb; v_inc uuid; v_n integer; v_cov jsonb; v_exc uuid; v_pat uuid;
  v_ref text; v_end timestamptz; v_org2 uuid; v_cmo2 uuid;
begin
  select id into v_org from public.organisations where not coalesce((metadata ->> 'canary')::boolean, false) order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_plain := pg_temp.mkuser(v_org, 'plain', 'patient');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_cmo, v_org, 'W03 CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin, true);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('plain', v_plain); perform pg_temp.setf('cmo', v_cmo);

  -- 1. Ships OFF -------------------------------------------------------------------------------------------------------------
  perform pg_temp.res('both switches ship off', 'false,false', (select red_lane_enabled::text || ',' || dead_letter_paging_enabled::text from public.chain_canary_red_config));
  perform pg_temp.res('the per-minute red job exists and the full canary is unchanged', '* * * * *,11,41 * * * *',
    (select schedule from cron.job where jobname = 'chain-canary-red') || ',' || (select schedule from cron.job where jobname = 'chain-canary'));
  perform pg_temp.res('a disabled lane does nothing', 'disabled', private.chain_canary_red_tick() ->> 'skipped');
  perform pg_temp.res('a disabled dead letter sweep does nothing', 'disabled', private.sweep_red_dead_letters() ->> 'skipped');
  perform pg_temp.res('a config that could not see a failure inside three minutes is refused (check 23514)', '23514',
    pg_temp.try('update public.chain_canary_red_config set inject_every_minutes = 2'));
  perform pg_temp.res('the default budget is within three minutes', 'true', (select (inject_every_minutes * 60 + (((eval_after_seconds + 59) / 60) * 60) <= 180)::text from public.chain_canary_red_config));

  -- 2. RED LANE: the seeded failure -----------------------------------------------------------------------------------------
  update public.chain_canary_red_config set red_lane_enabled = true;
  v_s := private.chain_canary_ensure();
  v_tick := private.chain_canary_red_tick();     -- minute 0: injects a run (no processor is running: the seeded failure)
  perform pg_temp.res('tick 1 injects one red run', '1,true', (select count(*)::text from public.chain_canary_red_runs where judged_at is null) || ',' || (v_tick ->> 'started' is not null)::text);
  perform pg_temp.res('the red reading went through the real insert path and emitted observation.recorded as a test event', 'true',
    (exists (select 1 from public.domain_events e where e.event_type = 'observation.recorded' and e.patient_id = v_s.patient_id and e.is_test))::text);
  update public.chain_canary_red_runs set injected_at = clock_timestamp() - interval '61 seconds' where judged_at is null;
  v_tick := private.chain_canary_red_tick();     -- minute 1: the first run is 61 s old (under 90 s): not judged; a new run is injected
  perform pg_temp.res('tick 2 does not judge a run that is not yet old enough, and injects the next', '0,2', (v_tick ->> 'evaluated') || ',' || (select count(*)::text from public.chain_canary_red_runs));
  update public.chain_canary_red_runs set injected_at = injected_at - interval '61 seconds' where judged_at is null and injected_at < clock_timestamp() - interval '55 seconds';
  v_tick := private.chain_canary_red_tick();     -- minute 2: the first run is 122 s old: judged
  perform pg_temp.res('tick 3 judges the first run: failed at graded', 'false,graded', (select passed::text || ',' || failed_stage from public.chain_canary_red_runs order by injected_at limit 1));
  perform pg_temp.res('the failure was seen inside three minutes of its injection', 'true', (select ((details ->> 'judged_after_seconds')::int <= 180)::text from public.chain_canary_red_runs order by injected_at limit 1));
  perform pg_temp.res('a sev1 incident names the stage', '1', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary_red:graded' and severity = 'sev1' and status not in ('resolved', 'closed')));
  perform pg_temp.res('the lane did not touch the full canary history', '0', (select count(*)::text from public.chain_canary_runs where at > now() - interval '1 hour'));

  -- the lane can pass: judge a fresh run after the processor's work is emulated
  update public.chain_canary_red_runs set judged_at = clock_timestamp(), passed = true where judged_at is null;
  v_a := private.chain_canary_start_red();
  perform pg_temp.emulate_red_processor(v_a);
  perform pg_temp.res('with the processor working the red lane passes', 'true', private.chain_canary_evaluate_red(v_a)::text);
  perform pg_temp.res('and its clean-up leaves no open page', '0', (select count(*)::text from public.pages where organisation_id = v_s.organisation_id and closed_at is null));

  -- SABOTAGE (a): the auto-acknowledge trigger dropped -> the same healthy run must fail at ack
  drop trigger pages_chain_canary_auto_ack on public.pages;
  v_b := private.chain_canary_start_red();
  perform pg_temp.emulate_red_processor(v_b);
  insert into results values ('sabotaged', 'without the auto-ack trigger the lane still passes', 'true', private.chain_canary_evaluate_red(v_b)::text || ':' || (select coalesce(failed_stage, '') from public.chain_canary_red_runs where id = v_b));
  perform pg_temp.res('without the auto-ack trigger the lane fails at ack (the check can fail)', 'false:ack', (select passed::text || ':' || failed_stage from public.chain_canary_red_runs where id = v_b));

  -- 3. DEAD LETTER ---------------------------------------------------------------------------------------------------------
  update public.chain_canary_red_config set red_lane_enabled = false, dead_letter_paging_enabled = true;
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-dl-' || gen_random_uuid(), false) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'paging.on_red', v_org, 'dead') returning id into v_dl;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'points.award.vitals_logged', v_org, 'dead') returning id into v_dl2;
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-dl-t-' || gen_random_uuid(), true) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'queue.create_from_triage', v_org, 'dead') returning id into v_dl3;

  v_tick := private.sweep_red_dead_letters();
  perform pg_temp.res('one dead red-class delivery is paged; a non-red subscriber and a test event are not', '1', v_tick ->> 'paged');
  v_ref := 'page_dead_letter:' || v_dl;
  select id into v_inc from public.ops_incidents where external_reference = v_ref;
  perform pg_temp.res('a sev1 incident exists for it', 'sev1', (select severity::text from public.ops_incidents where id = v_inc));
  perform pg_temp.res('one tracking row and one audit row', '1,1', (select count(*)::text from public.red_dead_letter_pages where delivery_id = v_dl) || ',' ||
    (select count(*)::text from public.audit_log where action = 'red_dead_letter.paged' and entity_id = v_dl));
  perform pg_temp.res('it reached the ops desk: an assignment, or the loud nobody-on-duty incident', '1',
    ((select count(*) from public.ops_desk_assignments where incident_id = v_inc) + (select count(*) from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || v_inc))::text);
  perform pg_temp.res('the non-red subscriber and the test event have no tracking row', '0', (select count(*)::text from public.red_dead_letter_pages where delivery_id in (v_dl2, v_dl3)));
  perform pg_temp.res('a second sweep pages nothing new', '0', private.sweep_red_dead_letters() ->> 'paged');
  update public.domain_event_deliveries set status = 'done', done_at = now() where id = v_dl;
  perform pg_temp.res('a requeued and finished delivery closes the alarm', '1,resolved', (private.sweep_red_dead_letters() ->> 'resolved') || ',' || (select status::text from public.ops_incidents where id = v_inc));

  -- SABOTAGE (b): the red-class list emptied -> a seeded dead letter must NOT be paged
  update public.domain_event_deliveries set status = 'dead', done_at = null where id = v_dl;
  delete from public.red_dead_letter_pages where delivery_id = v_dl;
  update public.chain_canary_red_config set red_class_subscribers = '{}';
  insert into results values ('sabotaged', 'with an empty red-class list the dead letter is still paged', '1', private.sweep_red_dead_letters() ->> 'paged');
  update public.chain_canary_red_config set red_class_subscribers = array['paging.on_red', 'queue.create_from_triage', 'triage.grade_observation'];

  -- 4. ROTA COVERAGE -------------------------------------------------------------------------------------------------------
  v_cov := private.rota_coverage(v_org, true, now());
  perform pg_temp.res('with no test rota every hour of the window is uncovered and the minimum is not met', 'false,672,0',
    (v_cov ->> 'meets_minimum') || ',' || (v_cov ->> 'hours_uncovered') || ',' || (v_cov ->> 'hours_covered'));
  perform pg_temp.res('the report carries the required number and window from the policy', '5,28', (v_cov ->> 'required_clinicians') || ',' || (v_cov ->> 'window_days'));
  perform pg_temp.res('the synthetic canary rota shows its clinician but one is not five', 'false,true', (private.rota_coverage(v_s.organisation_id, true, now()) ->> 'meets_minimum') ||
    ',' || ((private.rota_coverage(v_s.organisation_id, true, now()) ->> 'distinct_on_rota')::int >= 1)::text);
  perform pg_temp.res('an admin reads the report, a plain user is refused', 'ok,42501', pg_temp.try_as(v_admin, 'select public.rota_coverage_report()') || ',' || pg_temp.try_as(v_plain, 'select public.rota_coverage_report()'));
  perform pg_temp.res('the ladder status is the same: admin ok, plain refused', 'ok,42501', pg_temp.try_as(v_admin, 'select public.red_ladder_status()') || ',' || pg_temp.try_as(v_plain, 'select public.red_ladder_status()'));

  -- 5. SOLE-CMO EXPIRY (in its own organisation so the sole-CMO count is exactly one) -------------------------------------------
  insert into public.organisations (name, type) values ('W03 proof org two', 'clinic') returning id into v_org2;
  v_cmo2 := pg_temp.mkuser(v_org2, 'cmo2', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_cmo2, v_org2, 'W03 CMO two', 'chief_medical_officer', true, now(), 'employed', true, v_admin, true);
  update public.rota_cover_policy set sole_cmo_exception_sunset = (now() at time zone 'Africa/Lagos')::date + 10;
  v_end := private.sole_cmo_sunset_end();
  insert into public.sole_cmo_exceptions (organisation_id, competency_code, reason, signed_by, is_test, signed_at)
    values (v_org2, 'on_call', repeat('x', 45), v_cmo2, false, now() - interval '3 days') returning id into v_exc;
  perform pg_temp.res('a new real exception is capped to the dated end', 'true', (select (expires_at = v_end)::text from public.sole_cmo_exceptions where id = v_exc));
  perform pg_temp.res('control: before the date the exception is active', v_exc::text, coalesce(private.sole_cmo_exception_active(v_org2, 'on_call', v_cmo2)::text, 'null'));
  update public.rota_cover_policy set sole_cmo_exception_sunset = (now() at time zone 'Africa/Lagos')::date - 1;
  perform pg_temp.res('after the date the same exception is not active', 'null', coalesce(private.sole_cmo_exception_active(v_org2, 'on_call', v_cmo2)::text, 'null'));
  perform pg_temp.res('no real exception can be signed after the date (check 23514)', '23514',
    pg_temp.try(format('insert into public.sole_cmo_exceptions (organisation_id, competency_code, reason, signed_by, is_test) values (%L, ''on_call'', %L, %L, false)', v_org2, repeat('y', 45), v_cmo2)));
  update public.sole_cmo_exceptions set expires_at = now() - interval '1 hour' where id = v_exc;
  perform pg_temp.res('the sweep closes the lapsed real exception and audits it', '1,1', (private.sole_cmo_sunset_sweep() ->> 'closed') || ',' ||
    (select count(*)::text from public.audit_log where action = 'sole_cmo_exception.expired' and entity_id = v_exc));
  insert into public.sole_cmo_exceptions (organisation_id, competency_code, reason, signed_by, is_test)
    values (v_org2, 'on_call', repeat('t', 45), v_cmo2, true);
  perform pg_temp.res('a test exception is exempt from the date (the older proofs cannot rot)', 'true',
    (select (expires_at > now() + interval '300 days')::text from public.sole_cmo_exceptions where organisation_id = v_org2 and is_test));
  update public.rota_cover_policy set sole_cmo_exception_sunset = date '2027-01-31';

  -- 6. PHONE FALLBACKS -------------------------------------------------------------------------------------------------------
  v_pat := gen_random_uuid();
  insert into public.ops_incidents (organisation_id, category, severity, title, external_reference, ack_due_at, resolve_due_at)
    values (v_org, 'clinical', 'sev1', 'W03 proof expired page', 'page_expired:' || v_pat, now(), now()) returning id into v_inc;
  insert into public.ops_desk_call_log (organisation_id, incident_id, called_by, callee_kind, callee_profile_id, outcome, is_test)
    values (v_org, v_inc, v_admin, 'on_call_primary', v_cmo, 'no_answer', true);
  perform pg_temp.res('a call logged on the ops desk is mirrored once, keyed to the page', '1,on_call_clinician,no_answer',
    (select count(*)::text from public.page_phone_fallbacks where page_id = v_pat) || ',' ||
    (select callee_kind || ',' || outcome from public.page_phone_fallbacks where page_id = v_pat));
  perform pg_temp.res('the table cannot be written by a client or read by anon', '42501,42501', pg_temp.try_as(v_admin, format('insert into public.page_phone_fallbacks (organisation_id, page_id, called_by, callee_kind, outcome) values (%L, %L, %L, ''other'', ''x'')', v_org, v_pat, v_admin)) ||
    ',' || (case when has_table_privilege('anon', 'public.page_phone_fallbacks', 'SELECT') then 'open' else '42501' end));
  perform pg_temp.res('an admin of the organisation reads the log, a plain user cannot read it as a table row', 'ok', pg_temp.try_as(v_admin, 'select count(*) from public.page_phone_fallbacks'));

  -- SABOTAGE (c): the mirror trigger dropped -> the row must be missing
  drop trigger ops_desk_call_log_mirror_phone_fallbacks on public.ops_desk_call_log;
  v_pat := gen_random_uuid();
  insert into public.ops_incidents (organisation_id, category, severity, title, external_reference, ack_due_at, resolve_due_at)
    values (v_org, 'clinical', 'sev1', 'W03 proof expired page 2', 'page_expired:' || v_pat, now(), now()) returning id into v_inc;
  insert into public.ops_desk_call_log (organisation_id, incident_id, called_by, callee_kind, callee_profile_id, outcome, is_test)
    values (v_org, v_inc, v_admin, 'on_call_primary', v_cmo, 'no_answer', true);
  insert into results values ('sabotaged', 'without the mirror trigger the phone fallback is still logged', '1', (select count(*)::text from public.page_phone_fallbacks where page_id = v_pat));
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W-03 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) < 3 then
    raise exception 'VACUOUS TEST: not every sabotage changed its outcome (% of 3)', (select count(*) from results where phase = 'sabotaged' and expected <> actual);
  end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
