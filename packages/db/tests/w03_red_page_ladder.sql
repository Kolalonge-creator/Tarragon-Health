-- W-03 proof: the drilled red-page ladder (migration *_w03_red_page_ladder_drilled.sql). One rolled-back transaction.
--   1. Ships OFF: both switches false; the per-minute job exists and the 30-minute full canary is unchanged; the detection budget is a CHECK
--      (a config that could not see a failure inside three minutes is refused).
--   2. RED LANE (every 3 minutes), seeded failure: with the event processor stopped, the run injected by one tick is judged by the next tick
--      (180 s later), fails at 'graded', and opens a sev1 incident. The proof asserts the REAL budget: judged within 360 s of injection, and the
--      stored worst-case budget is 360 s, not 180 s ("within 3 minutes" does not hold at a 3-minute cadence). A run that is not yet old enough
--      is not judged and no second run is injected inside the interval. With the processor's work emulated the lane passes (the check can
--      pass), and with the auto-acknowledge trigger dropped it fails at 'ack'.
--   3. DEAD LETTER: a dead delivery on a red-class subscriber opens a sev1 incident, one tracking row and an audit row, goes to the ops desk
--      (the loud "no named ops person" incident when nobody is on duty; a real assignment plus the three neutral notices to the named ops
--      person once one is on duty); a second sweep does nothing new; a non-red
--      subscriber and a test event are ignored; a requeued delivery closes the alarm; the sweep is inert while its switch is off.
--   4. ROTA COVERAGE: the report counts credentialed clinicians and uncovered hours for the window; with no rota every hour is uncovered and the
--      minimum is not met; with five credentialed on-call clinicians covering all 28 days (primary and backup) the minimum IS met; a cancelled
--      shift or a revoked competency drops it again; non-admins are refused.
--   5. SOLE-CMO EXPIRY: a new real exception is capped to the dated end; none can be signed after it; the active check refuses after it; the
--      sweep closes a lapsed exception; test rows are exempt.
--   6. PHONE FALLBACKS: a call logged on the ops desk for an expired-page incident is mirrored once; log_page_phone_fallback through a real
--      page (admin ok, plain user refused, unknown page, blank outcome); the ladder status counts an expired page without a call, then with one.
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

create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'null');
end $f$;
-- a user with a phone number confirmed through auth.users.phone_confirmed_at, exactly as sign-in does
create function pg_temp.mkphoneuser(p_org uuid, p_label text, p_role text, p_phone text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, phone, phone_confirmed_at)
  values (v, 'w03-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}', regexp_replace(p_phone, '\D', '', 'g'), now());
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'W03 ' || p_label, p_phone, (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, organisation_id = excluded.organisation_id;
  return v;
end $f$;
-- a credentialed on-call doctor: eligible (licence and indemnity dated well ahead) and holding the on_call competency
create function pg_temp.mkoncall(p_org uuid, p_admin uuid, p_label text) returns uuid language plpgsql as
$f$ declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_cs uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, license_expires_at, indemnity_expires_at, is_test)
  values (p_org, v, 'W03 ' || p_label, 'MDCN', 'W03-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'employed', 2, now() + interval '2 years', now() + interval '2 years', true) returning id into v_cs;
  alter table public.clinician_competencies disable trigger user;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_cs, 'on_call', p_admin, true);
  alter table public.clinician_competencies enable trigger user;
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
  v_ops uuid; v_ct uuid; v_dl4 uuid; v_inc4 uuid; v_asg uuid; v_org3 uuid; v_docs uuid[] := '{}'; v_d uuid; i integer; v_cadm uuid; v_cplain uuid; v_pg uuid; v_rota uuid;
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
  perform pg_temp.res('the job runs every 3 minutes', '*/3 * * * *', (select schedule from cron.job where jobname = 'chain-canary-red'));
  perform pg_temp.res('a cadence that is not a multiple of the 3-minute tick is refused (check 23514)', '23514',
    pg_temp.try('update public.chain_canary_red_config set inject_every_minutes = 4'));
  perform pg_temp.res('a cadence whose worst case exceeds the stored budget is refused (check 23514)', '23514',
    pg_temp.try('update public.chain_canary_red_config set inject_every_minutes = 6'));
  perform pg_temp.res('the stored budget is the honest worst case: one interval plus one judging tick, 360 s, not 180 s', '360,3,360',
    (select detection_budget_seconds::text || ',' || inject_every_minutes::text || ',' || (inject_every_minutes * 60 + (((eval_after_seconds + 179) / 180) * 180))::text from public.chain_canary_red_config));

  -- 2. RED LANE: the seeded failure -----------------------------------------------------------------------------------------
  update public.chain_canary_red_config set red_lane_enabled = true;
  v_s := private.chain_canary_ensure();
  v_tick := private.chain_canary_red_tick();     -- tick 1: injects a run (no processor is running: the seeded failure)
  perform pg_temp.res('tick 1 injects one red run', '1,true', (select count(*)::text from public.chain_canary_red_runs where judged_at is null) || ',' || (v_tick ->> 'started' is not null)::text);
  perform pg_temp.res('the red reading went through the real insert path and emitted observation.recorded as a test event', 'true',
    (exists (select 1 from public.domain_events e where e.event_type = 'observation.recorded' and e.patient_id = v_s.patient_id and e.is_test))::text);
  v_tick := private.chain_canary_red_tick();     -- the same instant again: not old enough to judge, and no second injection inside the interval
  perform pg_temp.res('a run that is not yet old enough is not judged and no second run is injected', '0,1', (v_tick ->> 'evaluated') || ',' || (select count(*)::text from public.chain_canary_red_runs));
  update public.chain_canary_red_runs set injected_at = clock_timestamp() - interval '181 seconds' where judged_at is null;
  v_tick := private.chain_canary_red_tick();     -- tick 2, 3 minutes later: judges the first run and injects the next
  perform pg_temp.res('tick 2 judges the first run: failed at graded', 'false,graded', (select passed::text || ',' || failed_stage from public.chain_canary_red_runs order by injected_at limit 1));
  perform pg_temp.res('and injects the next run', '2', (select count(*)::text from public.chain_canary_red_runs));
  perform pg_temp.res('the failure was seen within the stored worst-case budget (360 s), not within 180 s', 'true', (select ((details ->> 'judged_after_seconds')::int <= (select detection_budget_seconds from public.chain_canary_red_config))::text
    from public.chain_canary_red_runs order by injected_at limit 1));
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

  -- positive assignment: a named, verified ops person is on duty, so the dead letter reaches THEM (and nobody else) with the neutral notice
  v_ops := pg_temp.mkphoneuser(v_org, 'ops', 'admin', '+2348062541973');
  insert into public.ops_desk_contacts (organisation_id, profile_id, role) values (v_org, v_ops, 'primary') returning id into v_ct;
  insert into public.ops_desk_contact_windows (organisation_id, contact_id, day_of_week, start_time, end_time)
    values (v_org, v_ct, extract(isodow from now() at time zone 'Africa/Lagos')::int, time '00:00', time '23:59');
  update public.ops_desk_contacts set is_active = true, activated_by = v_admin, activated_at = now() where id = v_ct;
  update public.ops_desk_contacts set is_test = false where id = v_ct;      -- the dead letter below is a real-world event
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-dl4-' || gen_random_uuid(), false) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'queue.create_from_triage', v_org, 'dead') returning id into v_dl4;
  perform pg_temp.res('with an ops person on duty the dead letter is paged', '1', private.sweep_red_dead_letters() ->> 'paged');
  select id into v_inc4 from public.ops_incidents where external_reference = 'page_dead_letter:' || v_dl4;
  perform pg_temp.res('it is assigned to the named ops person, who owns the incident', 'true,true,true',
    (exists (select 1 from public.ops_desk_assignments a where a.incident_id = v_inc4 and a.profile_id = v_ops and a.role = 'primary'))::text || ',' ||
    ((select owner_id from public.ops_incidents where id = v_inc4) = v_ops)::text || ',' ||
    ((select assigned_to from public.red_dead_letter_pages where delivery_id = v_dl4) = v_ops)::text);
  perform pg_temp.res('no uncovered alarm was raised for it', '0', (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || v_inc4));
  perform pg_temp.res('the ops person got the dead letter notice on push, in-app and email only', '3,email,in_app,push',
    (select count(*)::text || ',' || string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = v_ops and template = 'on_call_ops_desk_dead_letter'));
  perform pg_temp.res('and the notice carries only the incident id', 'incident_id', (select string_agg(distinct k, ',') from public.notifications n, jsonb_object_keys(n.payload) k where n.recipient_id = v_ops and n.template = 'on_call_ops_desk_dead_letter'));
  perform pg_temp.res('nobody else got a dead letter notice', '0', (select count(*)::text from public.notifications where template = 'on_call_ops_desk_dead_letter' and recipient_id <> v_ops));
  update public.domain_event_deliveries set status = 'done', done_at = now() where id = v_dl4;
  perform private.sweep_red_dead_letters();

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
  -- positive: five credentialed on-call clinicians cover all 28 days, each with a credentialed backup
  insert into public.organisations (name, type) values ('W03 proof org three', 'clinic') returning id into v_org3;
  for i in 1..5 loop
    v_docs := v_docs || pg_temp.mkoncall(v_org3, v_admin, 'doc' || i);
  end loop;
  perform set_config('tarragon.lead_write', 'on', true);
  for i in 0..29 loop
    insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
    values (v_org3, date_trunc('hour', now()) + make_interval(hours => 24 * i), date_trunc('hour', now()) + make_interval(hours => 24 * (i + 1)),
            v_docs[1 + (i % 5)], v_docs[1 + ((i + 1) % 5)], true);
  end loop;
  perform set_config('tarragon.lead_write', 'off', true);
  v_cov := private.rota_coverage(v_org3, true, now());
  perform pg_temp.res('five credentialed clinicians covering all 28 days meets the minimum', 'true,5,0,0,672,5',
    (v_cov ->> 'meets_minimum') || ',' || (v_cov ->> 'distinct_credentialed_on_rota') || ',' || (v_cov ->> 'hours_uncovered') || ',' || (v_cov ->> 'hours_without_backup') || ',' ||
    (v_cov ->> 'hours_covered') || ',' || (v_cov ->> 'eligible_on_call_staff'));
  select id into v_rota from public.on_call_rota where organisation_id = v_org3 order by starts_at offset 10 limit 1;
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = now() where id = v_rota;
  perform set_config('tarragon.lead_write', 'off', true);
  v_cov := private.rota_coverage(v_org3, true, now());
  perform pg_temp.res('cancelling one day of the rota leaves 24 hours uncovered and the minimum unmet', 'false,24', (v_cov ->> 'meets_minimum') || ',' || (v_cov ->> 'hours_uncovered'));
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = null where id = v_rota;
  perform set_config('tarragon.lead_write', 'off', true);
  update public.clinician_competencies set revoked_at = now() where clinical_staff_id = (select id from public.clinical_staff where profile_id = v_docs[1]) and competency_code = 'on_call';
  v_cov := private.rota_coverage(v_org3, true, now());
  perform pg_temp.res('revoking one clinician''s on_call competency drops the credentialed count to four and the minimum fails', 'false,4',
    (v_cov ->> 'meets_minimum') || ',' || (v_cov ->> 'distinct_credentialed_on_rota'));

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

  -- log_page_phone_fallback through a real page (the one the healthy red lane run above made in the canary organisation)
  v_cadm := pg_temp.mkuser(v_s.organisation_id, 'canaryadmin', 'admin');
  v_cplain := pg_temp.mkuser(v_s.organisation_id, 'canaryplain', 'patient');
  select id into v_pg from public.pages where organisation_id = v_s.organisation_id and parent_page_id is null order by created_at desc limit 1;
  perform pg_temp.res('there is a real red page to log a call against', 'true', (v_pg is not null)::text);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set expired_at = now() where id = v_pg;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.res('the ladder status counts an expired page with no logged call', '1,1',
    ((pg_temp.q_as(v_cadm, 'select public.red_ladder_status()')::jsonb) -> 'phone_fallbacks' ->> 'expired_pages_30d') || ',' ||
    ((pg_temp.q_as(v_cadm, 'select public.red_ladder_status()')::jsonb) -> 'phone_fallbacks' ->> 'expired_pages_without_call_30d'));
  perform pg_temp.res('an admin logs the call', 'ok', pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''on_call_clinician'', ''no_answer'', ''rang twice'')', v_pg, v_s.clinician_id)));
  perform pg_temp.res('one row, keyed to the page, attributed to the caller', '1,true', (select count(*)::text from public.page_phone_fallbacks where page_id = v_pg and called_by = v_cadm and source = 'rpc') || ',' ||
    (select (outcome = 'no_answer' and callee_kind = 'on_call_clinician')::text from public.page_phone_fallbacks where page_id = v_pg and source = 'rpc'));
  perform pg_temp.res('and the audit trail records it', '1', (select count(*)::text from public.audit_log where action = 'page.phone_fallback_logged' and entity_id = v_pg));
  perform pg_temp.res('the ladder status now shows the call', '0',
    ((pg_temp.q_as(v_cadm, 'select public.red_ladder_status()')::jsonb) -> 'phone_fallbacks' ->> 'expired_pages_without_call_30d'));
  perform pg_temp.res('a plain user is refused, an unknown page, a blank outcome and a bad callee kind are refused', '42501,P0002,23514,23514',
    pg_temp.try_as(v_cplain, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''no_answer'')', v_pg, v_s.clinician_id)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''no_answer'')', gen_random_uuid(), v_s.clinician_id)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''   '')', v_pg, v_s.clinician_id)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''neighbour'', ''no_answer'')', v_pg, v_s.clinician_id)));

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
