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
--   REVIEW FIXES: (7) the lane is debounced (one failed run is a blip, two in a row page), (8) enabling the lane never raises the stale alarm,
--   (9) dead letters are grouped per subscriber per hour, capped per organisation per hour and ignore anything that died before paging was
--   switched on, (10) the two switches change only through CMO-only RPCs that audit and keep a history, (11) the sunset date makes a SELF-granted
--   on_call competency stop counting towards rota coverage, (12) the prior behaviour of ops_desk_assign and sole_cmo_exception_active is kept,
--   (13) the phone log has a fixed outcome list and validates the person phoned, (14) the partial index for the dead letter sweep exists.
--   MORE SABOTAGE: debounce replaced by always-page (a single failure must flip to paging); stale reference reset (re-enable must flip to alarming);
--   flood cap raised (a new incident must appear); switch guard trigger dropped (a direct flip must succeed); the rota competency helper made
--   always true (a self-granted competency must count again after the date).
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

-- flips a switch the way the CMO-only RPCs do (they set this setting); used for plumbing, the RPCs themselves are tested in section 1b
create function pg_temp.flip(p_key text, p_val boolean) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.red_switch_write', 'on', true);
  if p_key = 'red_lane' then update public.chain_canary_red_config set red_lane_enabled = p_val;
  else update public.chain_canary_red_config set dead_letter_paging_enabled = p_val; end if;
  perform set_config('tarragon.red_switch_write', 'off', true);
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
create function pg_temp.mkoncall(p_org uuid, p_admin uuid, p_label text, p_test boolean default true, p_self_granted boolean default false) returns uuid language plpgsql as
$f$ declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_cs uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, license_expires_at, indemnity_expires_at, is_test)
  values (p_org, v, 'W03 ' || p_label, 'MDCN', 'W03-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer', 'employed', 2, now() + interval '2 years', now() + interval '2 years', p_test) returning id into v_cs;
  alter table public.clinician_competencies disable trigger user;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_cs, 'on_call', case when p_self_granted then v else p_admin end, p_test);
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
  v_ops uuid; v_dep uuid; v_ct uuid; v_ct2 uuid; v_dl5 uuid; v_org4 uuid; v_before integer; v_cn integer; v_r jsonb; v_dl4 uuid; v_inc4 uuid; v_asg uuid; v_org3 uuid; v_docs uuid[] := '{}'; v_d uuid; i integer; v_cadm uuid; v_cplain uuid; v_pg uuid; v_rota uuid;
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
  perform pg_temp.res('the red job runs every 3 minutes and the full canary is unchanged', '*/3 * * * *,11,41 * * * *',
    (select schedule from cron.job where jobname = 'chain-canary-red') || ',' || (select schedule from cron.job where jobname = 'chain-canary'));
  perform pg_temp.res('a disabled lane does nothing', 'disabled', private.chain_canary_red_tick() ->> 'skipped');
  perform pg_temp.res('a disabled dead letter sweep does nothing', 'disabled', private.sweep_red_dead_letters() ->> 'skipped');
  perform pg_temp.res('an evaluation wait of a full tick or more is refused (check 23514)', '23514', pg_temp.try('update public.chain_canary_red_config set eval_after_seconds = 171'));
  perform pg_temp.res('the dead letter partial index exists', '1', (select count(*)::text from pg_indexes where indexname = 'domain_event_deliveries_dead_updated_idx' and indexdef like '%WHERE (status = ''dead''%'));
  perform pg_temp.res('a cadence that is not a multiple of the 3-minute tick is refused (check 23514)', '23514',
    pg_temp.try('update public.chain_canary_red_config set inject_every_minutes = 4'));
  perform pg_temp.res('a cadence whose worst case exceeds the stored budget is refused (check 23514)', '23514',
    pg_temp.try('update public.chain_canary_red_config set inject_every_minutes = 6'));
  perform pg_temp.res('the stored budget is the honest worst case for a PAGE: two failing injections plus one judging tick, 540 s, not 180 s', '540,3,540,150',
    (select detection_budget_seconds::text || ',' || inject_every_minutes::text || ',' || (inject_every_minutes * 60 * 2 + (((eval_after_seconds + 179) / 180) * 180))::text || ',' || eval_after_seconds::text from public.chain_canary_red_config));

  -- 1b. THE SWITCHES: CMO only, audited, with a history -------------------------------------------------------------------------
  perform pg_temp.res('a direct change of a switch is refused (guard trigger, 42501)', '42501', pg_temp.try('update public.chain_canary_red_config set red_lane_enabled = true'));
  perform pg_temp.res('an admin, a plain user and anon cannot flip the lane switch', '42501,42501,42501',
    pg_temp.try_as(v_admin, $q$select public.set_red_lane_enabled(true, 'an admin trying to switch the lane on')$q$) || ',' ||
    pg_temp.try_as(v_plain, $q$select public.set_red_lane_enabled(true, 'a patient trying to switch the lane on')$q$) || ',' ||
    (case when has_function_privilege('anon', 'public.set_red_lane_enabled(boolean, text)', 'EXECUTE') then 'open' else '42501' end));
  perform pg_temp.res('an admin cannot flip the dead letter switch either', '42501', pg_temp.try_as(v_admin, $q$select public.set_dead_letter_paging_enabled(true, 'an admin trying to switch paging on')$q$));
  perform pg_temp.res('the CMO needs a real reason (20 characters)', '23514', pg_temp.try_as(v_cmo, 'select public.set_red_lane_enabled(true, ''too short'')'));
  perform pg_temp.res('the CMO switches the lane on', 'ok', pg_temp.try_as(v_cmo, $q$select public.set_red_lane_enabled(true, 'drill window agreed with the founder today')$q$));
  perform pg_temp.res('it is on, stamped with when it was enabled, with one history row naming the CMO and the reason', 'true,true,1,true',
    (select red_lane_enabled::text || ',' || (red_lane_enabled_at is not null)::text from public.chain_canary_red_config) || ',' ||
    (select count(*)::text || ',' || bool_and(changed_by = v_cmo and old_value = false and new_value = true and reason like 'drill window%')::text from public.red_ladder_switch_history where switch_key = 'red_lane'));
  perform pg_temp.res('and the audit log has who, when and why', '1', (select count(*)::text from public.audit_log where action = 'red_ladder.switch_changed' and actor_id = v_cmo and event ->> 'switch' = 'red_lane' and event ->> 'reason' like 'drill window%'));
  perform pg_temp.res('switching it to the value it already has is refused', '23514', pg_temp.try_as(v_cmo, $q$select public.set_red_lane_enabled(true, 'switching it on a second time over')$q$));
  perform pg_temp.res('the ladder status shows the last change', 'true,drill window agreed with the founder today',
    ((pg_temp.q_as(v_admin, 'select public.red_ladder_status()')::jsonb) -> 'switch_changes' -> 'red_lane' ->> 'new_value') || ',' || ((pg_temp.q_as(v_admin, 'select public.red_ladder_status()')::jsonb) -> 'switch_changes' -> 'red_lane' ->> 'reason'));
  perform pg_temp.res('the CMO switches it back off', 'ok,false', pg_temp.try_as(v_cmo, $q$select public.set_red_lane_enabled(false, 'back to off until the drill starts')$q$) || ',' || (select red_lane_enabled::text from public.chain_canary_red_config));

  -- 2. RED LANE: the seeded failure -----------------------------------------------------------------------------------------
  perform pg_temp.flip('red_lane', true);
  v_s := private.chain_canary_ensure();
  v_tick := private.chain_canary_red_tick();     -- tick 1: injects run 1 (no processor is running: the seeded failure)
  perform pg_temp.res('tick 1 injects one red run', '1,true', (select count(*)::text from public.chain_canary_red_runs where judged_at is null) || ',' || (v_tick ->> 'started' is not null)::text);
  perform pg_temp.res('the red reading went through the real insert path and emitted observation.recorded as a test event', 'true',
    (exists (select 1 from public.domain_events e where e.event_type = 'observation.recorded' and e.patient_id = v_s.patient_id and e.is_test))::text);
  v_tick := private.chain_canary_red_tick();     -- the same instant again: not old enough to judge, and no second injection inside the interval
  perform pg_temp.res('a run that is not yet old enough is not judged and no second run is injected', '0,1', (v_tick ->> 'evaluated') || ',' || (select count(*)::text from public.chain_canary_red_runs));
  update public.chain_canary_red_runs set injected_at = clock_timestamp() - interval '181 seconds' where judged_at is null;
  v_tick := private.chain_canary_red_tick();     -- tick 2, 3 minutes later: judges run 1 (a first failure) and injects run 2
  perform pg_temp.res('tick 2 judges run 1: failed at graded', 'false,graded', (select passed::text || ',' || failed_stage from public.chain_canary_red_runs order by injected_at limit 1));
  perform pg_temp.res('and injects the next run', '2', (select count(*)::text from public.chain_canary_red_runs));
  perform pg_temp.res('DEBOUNCE: a single failed run is a blip: recorded, not paged, no incident', 'false,0',
    (select coalesce(details ->> 'paged', 'null') from public.chain_canary_red_runs order by injected_at limit 1) || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference like 'chain_canary_red:%' and status not in ('resolved', 'closed')));
  perform pg_temp.res('the card counts it as a blip, not a failure', '0,1', ((pg_temp.q_as(v_admin, 'select public.red_ladder_status()')::jsonb) -> 'red_lane' ->> 'failures_24h') || ',' || ((pg_temp.q_as(v_admin, 'select public.red_ladder_status()')::jsonb) -> 'red_lane' ->> 'blips_24h'));
  update public.chain_canary_red_runs set injected_at = clock_timestamp() - interval '181 seconds' where judged_at is null;
  v_tick := private.chain_canary_red_tick();     -- tick 3: judges run 2, a SECOND consecutive failure: sev1
  perform pg_temp.res('tick 3 judges run 2: a second consecutive failure', 'false,graded,true', (select passed::text || ',' || failed_stage || ',' || (details ->> 'paged') from public.chain_canary_red_runs where judged_at is not null order by injected_at desc limit 1));
  perform pg_temp.res('a sev1 incident names the stage', '1', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary_red:graded' and severity = 'sev1' and status not in ('resolved', 'closed')));
  perform pg_temp.res('the failure was seen within the stored worst-case budget (540 s), not within 180 s', 'true', (select ((details ->> 'judged_after_seconds')::int <= (select detection_budget_seconds from public.chain_canary_red_config))::text
    from public.chain_canary_red_runs where judged_at is not null order by injected_at limit 1));
  perform pg_temp.res('the lane did not touch the full canary history', '0', (select count(*)::text from public.chain_canary_runs where at > now() - interval '1 hour'));
  perform pg_temp.res('no stale alarm was raised while the lane was reporting', '0', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary_red:stale'));

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
  perform pg_temp.res('DEBOUNCE: that single failure right after a pass raised no incident', '0', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary_red:ack'));
  -- SABOTAGE (e): the debounce replaced by always-page -> the next single failure after a pass WOULD page (the check flips)
  update public.chain_canary_red_runs set passed = true, failed_stage = null where id = v_b;      -- treat the blip as settled: the next failure is again a single one
  create or replace function private.red_lane_note_failure(p_run uuid, p_stage text, p_msg text) returns boolean language plpgsql security definer set search_path = '' as
  $f$ begin perform private.ops_alert_incident('chain_canary_red:' || p_stage, 'sabotaged', 'sabotaged', 'sev1'); return true; end $f$;
  v_c := private.chain_canary_start_red();
  perform pg_temp.emulate_red_processor(v_c);
  perform private.chain_canary_evaluate_red(v_c);
  insert into results values ('sabotaged', 'with the debounce removed a single failure after a pass raises an incident', '0', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary_red:ack'));

  -- STALE ALARM: a lane that is switched off for a day and back on must not alarm on its first ticks
  create or replace function private.red_lane_note_failure(p_run uuid, p_stage text, p_msg text) returns boolean language plpgsql security definer set search_path = '' as
  $f$
  declare r public.chain_canary_red_runs; c public.chain_canary_red_config; v_prev boolean; v_page boolean;
  begin
    select * into r from public.chain_canary_red_runs where id = p_run;
    select * into c from public.chain_canary_red_config;
    select x.passed into v_prev from public.chain_canary_red_runs x
     where x.judged_at is not null and x.id <> p_run and x.injected_at < r.injected_at and x.injected_at > r.injected_at - make_interval(mins => c.inject_every_minutes * 3)
     order by x.injected_at desc limit 1;
    v_page := v_prev is false;
    update public.chain_canary_red_runs set details = details || jsonb_build_object('paged', v_page) where id = p_run;
    if v_page then
      perform private.ops_alert_incident('chain_canary_red:' || p_stage, 'Red page chain canary failed twice in a row at stage: ' || p_stage, coalesce(p_msg, ''), 'sev1');
    end if;
    return v_page;
  end $f$;
  delete from public.chain_canary_red_runs where judged_at is null;
  update public.chain_canary_red_runs set injected_at = injected_at - interval '1 day', judged_at = judged_at - interval '1 day';
  perform pg_temp.flip('red_lane', false);
  perform pg_temp.flip('red_lane', true);
  v_tick := private.chain_canary_red_tick();
  perform pg_temp.res('STALE: re-enabling a lane whose last run is a day old raises no stale alarm', '0', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary_red:stale' and status not in ('resolved', 'closed')));
  update public.chain_canary_red_config set red_lane_enabled_at = null;      -- SABOTAGE (f): forget when it was switched on
  delete from public.chain_canary_red_runs where judged_at is null;
  v_tick := private.chain_canary_red_tick();
  insert into results values ('sabotaged', 'without the enabled-at reference the old last run raises a stale alarm', '0', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary_red:stale' and status not in ('resolved', 'closed')));
  update public.ops_incidents set status = 'resolved', root_cause = 'W-03 proof' where external_reference like 'chain_canary_red:%';
  perform pg_temp.flip('red_lane', false);

  -- 3. DEAD LETTER ---------------------------------------------------------------------------------------------------------
  perform pg_temp.flip('dead_letter', true);
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-dl-' || gen_random_uuid(), false) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'paging.on_red', v_org, 'dead') returning id into v_dl;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'points.award.vitals_logged', v_org, 'dead') returning id into v_dl2;
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-dl-t-' || gen_random_uuid(), true) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'queue.create_from_triage', v_org, 'dead') returning id into v_dl3;

  v_tick := private.sweep_red_dead_letters();
  perform pg_temp.res('one dead red-class delivery is paged; a non-red subscriber and a test event are not', '1', v_tick ->> 'paged');
  select incident_id into v_inc from public.red_dead_letter_pages where delivery_id = v_dl;
  perform pg_temp.res('a sev1 incident exists for it', 'sev1', (select severity::text from public.ops_incidents where id = v_inc));
  perform pg_temp.res('one tracking row and one audit row', '1,1', (select count(*)::text from public.red_dead_letter_pages where delivery_id = v_dl) || ',' ||
    (select count(*)::text from public.audit_log where action = 'red_dead_letter.paged' and entity_id = v_dl));
  perform pg_temp.res('it reached the ops desk: an assignment, or the loud nobody-on-duty incident', '1',
    ((select count(*) from public.ops_desk_assignments where incident_id = v_inc) + (select count(*) from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || v_inc))::text);
  perform pg_temp.res('the non-red subscriber and the test event have no tracking row', '0', (select count(*)::text from public.red_dead_letter_pages where delivery_id in (v_dl2, v_dl3)));
  perform pg_temp.res('a second sweep pages nothing new', '0', private.sweep_red_dead_letters() ->> 'paged');
  perform pg_temp.res('PRIOR BEHAVIOUR: with nobody on duty the loud uncovered alarm is raised', '1', (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || v_inc and severity = 'sev1'));
  -- BACKLOG: a delivery that died BEFORE paging was switched on is never paged
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-old-' || gen_random_uuid(), false) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status, updated_at)
    values (v_ev, 'paging.on_red', v_org, 'dead', (select dead_letter_paging_started_at from public.chain_canary_red_config) - interval '1 hour') returning id into v_dl5;
  perform pg_temp.res('BACKLOG: a delivery that went dead before paging was switched on is ignored', '0,0', (private.sweep_red_dead_letters() ->> 'paged') || ',' || (select count(*)::text from public.red_dead_letter_pages where delivery_id = v_dl5));
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
  select incident_id into v_inc4 from public.red_dead_letter_pages where delivery_id = v_dl4;
  perform pg_temp.res('it is assigned to the named ops person, who owns the incident', 'true,true,true',
    (exists (select 1 from public.ops_desk_assignments a where a.incident_id = v_inc4 and a.profile_id = v_ops and a.role = 'primary'))::text || ',' ||
    ((select owner_id from public.ops_incidents where id = v_inc4) = v_ops)::text || ',' ||
    ((select assigned_to from public.red_dead_letter_pages where delivery_id = v_dl4) = v_ops)::text);
  perform pg_temp.res('no uncovered alarm was raised for it', '0', (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || v_inc4));
  perform pg_temp.res('the ops person got the dead letter notice on push, in-app and email only', '3,email,in_app,push',
    (select count(*)::text || ',' || string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = v_ops and template = 'on_call_ops_desk_dead_letter'));
  perform pg_temp.res('and the notice carries only the incident id', 'incident_id', (select string_agg(distinct k, ',') from public.notifications n, jsonb_object_keys(n.payload) k where n.recipient_id = v_ops and n.template = 'on_call_ops_desk_dead_letter'));
  perform pg_temp.res('nobody else got a dead letter notice', '0', (select count(*)::text from public.notifications where template = 'on_call_ops_desk_dead_letter' and recipient_id <> v_ops));
  perform pg_temp.res('PRIOR BEHAVIOUR: the first assignment went to the primary, reason first_choice', 'first_choice', (select reason from public.ops_desk_assignments where incident_id = v_inc4 and profile_id = v_ops));
  -- PRIOR BEHAVIOUR: the deputy after an unacknowledged primary
  v_dep := pg_temp.mkphoneuser(v_org, 'dep', 'admin', '+2348031765409');
  insert into public.ops_desk_contacts (organisation_id, profile_id, role) values (v_org, v_dep, 'deputy') returning id into v_ct2;
  insert into public.ops_desk_contact_windows (organisation_id, contact_id, day_of_week, start_time, end_time)
    values (v_org, v_ct2, extract(isodow from now() at time zone 'Africa/Lagos')::int, time '00:00', time '23:59');
  update public.ops_desk_contacts set is_active = true, activated_by = v_admin, activated_at = now() where id = v_ct2;
  update public.ops_desk_contacts set is_test = false where id = v_ct2;
  perform pg_temp.res('PRIOR BEHAVIOUR: after an unacknowledged primary the deputy is assigned (primary_unacknowledged)', 'primary_unacknowledged,deputy',
    (select reason || ',' || role from public.ops_desk_assignments where id = private.ops_desk_assign(v_inc4, 'deputy', v_ops)));
  update public.domain_event_deliveries set status = 'done', done_at = now() where id = v_dl4;
  perform private.sweep_red_dead_letters();

  -- GROUPING: four more dead letters of one subscriber become ONE incident whose summary carries the count
  for i in 1..4 loop
    insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
      values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-grp-' || i || gen_random_uuid(), false) returning id into v_ev;
    insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'triage.grade_observation', v_org, 'dead');
  end loop;
  v_r := private.sweep_red_dead_letters();
  perform pg_temp.res('GROUPING: four dead letters, four tracked, one new incident', '4,1', (v_r ->> 'paged') || ',' || (v_r ->> 'incidents'));
  perform pg_temp.res('and their summary says four', 'true', (select (summary like '4 step(s)%')::text from public.ops_incidents where id = (select incident_id from public.red_dead_letter_pages where subscriber_key = 'triage.grade_observation' limit 1)));
  perform pg_temp.res('one incident per subscriber per hour, so one incident holds all four', '1', (select count(distinct incident_id)::text from public.red_dead_letter_pages where subscriber_key = 'triage.grade_observation'));

  -- CAP: the organisation already has three incidents this hour (paging.on_red, queue.create_from_triage, triage.grade_observation); a new
  -- subscriber-hour group would be a fourth, so it is appended to the newest open incident instead and nobody new is assigned
  select count(*) into v_before from public.ops_incidents where external_reference like 'page\_dead\_letter:%';
  select count(*) into v_cn from public.ops_desk_assignments where incident_id in (select id from public.ops_incidents where external_reference like 'page\_dead\_letter:%');
  update public.ops_incidents set status = 'resolved', root_cause = 'W-03 proof' where id = (select incident_id from public.red_dead_letter_pages where delivery_id = v_dl);   -- the first group is closed: paging.on_red has no open group
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-cap-' || gen_random_uuid(), false) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'paging.on_red', v_org, 'dead');
  v_r := private.sweep_red_dead_letters();
  perform pg_temp.res('CAP: the fourth group in the hour is appended to an open incident: no new incident, no new assignment', '1,1,0,0',
    (v_r ->> 'paged') || ',' || (v_r ->> 'appended_over_cap') || ',' || ((select count(*) from public.ops_incidents where external_reference like 'page\_dead\_letter:%') - v_before)::text ||
    ',' || ((select count(*) from public.ops_desk_assignments where incident_id in (select id from public.ops_incidents where external_reference like 'page\_dead\_letter:%')) - v_cn)::text);
  -- SABOTAGE (g): the cap raised -> the same situation creates a fourth incident (the check flips)
  update public.chain_canary_red_config set dead_letter_max_incidents_per_hour = 20;
  update public.ops_incidents set status = 'resolved', root_cause = 'W-03 proof' where external_reference like 'page\_dead\_letter:paging.on_red:%';
  insert into public.domain_events (event_type, organisation_id, payload, priority, idempotency_key, is_test)
    values ('triage.graded', v_org, '{}'::jsonb, 'urgent', 'w03-cap2-' || gen_random_uuid(), false) returning id into v_ev;
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id, status) values (v_ev, 'paging.on_red', v_org, 'dead');
  v_r := private.sweep_red_dead_letters();
  insert into results values ('sabotaged', 'with the cap raised the flood still creates no new incident', '0', (v_r ->> 'incidents'));
  update public.chain_canary_red_config set dead_letter_max_incidents_per_hour = 3;

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

  -- SUNSET BITES: in a REAL (non-test) world, five credentialed clinicians where one holds on_call only because they granted it to themselves
  insert into public.organisations (name, type) values ('W03 proof org four', 'clinic') returning id into v_org4;
  v_docs := '{}';
  for i in 1..5 loop
    v_docs := v_docs || pg_temp.mkoncall(v_org4, v_admin, 'real' || i, false, i = 5);
  end loop;
  perform set_config('tarragon.lead_write', 'on', true);
  for i in 0..29 loop
    insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
    values (v_org4, date_trunc('hour', now()) + make_interval(hours => 24 * i), date_trunc('hour', now()) + make_interval(hours => 24 * (i + 1)),
            v_docs[1 + (i % 5)], v_docs[1 + ((i + 1) % 5)], false);
  end loop;
  perform set_config('tarragon.lead_write', 'off', true);
  update public.rota_cover_policy set sole_cmo_exception_sunset = (now() at time zone 'Africa/Lagos')::date + 10;
  v_cov := private.rota_coverage(v_org4, false, now());
  perform pg_temp.res('BEFORE the date a self-granted on_call counts: five credentialed, minimum met, exception not ended', 'true,5,0,false',
    (v_cov ->> 'meets_minimum') || ',' || (v_cov ->> 'distinct_credentialed_on_rota') || ',' || (v_cov ->> 'self_granted_not_counted') || ',' || (v_cov -> 'sole_cmo_exception' ->> 'exception_ended'));
  update public.rota_cover_policy set sole_cmo_exception_sunset = (now() at time zone 'Africa/Lagos')::date - 1;
  v_cov := private.rota_coverage(v_org4, false, now());
  perform pg_temp.res('AFTER the date the self-granted competency no longer counts: four credentialed, minimum NOT met, the card says ended', 'false,4,1,true',
    (v_cov ->> 'meets_minimum') || ',' || (v_cov ->> 'distinct_credentialed_on_rota') || ',' || (v_cov ->> 'self_granted_not_counted') || ',' || (v_cov -> 'sole_cmo_exception' ->> 'exception_ended'));
  perform pg_temp.res('nothing was removed: the competency row is still there', '1', (select count(*)::text from public.clinician_competencies cc join public.clinical_staff cs on cs.id = cc.clinical_staff_id where cs.profile_id = v_docs[5] and cc.revoked_at is null));
  perform pg_temp.res('a test world never reports the exception as ended', 'false', (private.rota_coverage(v_org3, true, now()) -> 'sole_cmo_exception' ->> 'exception_ended'));
  update public.rota_cover_policy set sole_cmo_exception_sunset = date '2027-01-31';

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
  update public.rota_cover_policy set sole_cmo_exception_sunset = (now() at time zone 'Africa/Lagos')::date + 10;
  perform pg_temp.res('PRIOR BEHAVIOUR: a different competency code is not covered', 'null', coalesce(private.sole_cmo_exception_active(v_org2, 'other_code', v_cmo2)::text, 'null'));
  perform pg_temp.res('PRIOR BEHAVIOUR: another signer is not covered', 'null', coalesce(private.sole_cmo_exception_active(v_org2, 'on_call', v_admin)::text, 'null'));
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
  insert into public.ops_desk_call_log (organisation_id, incident_id, called_by, callee_kind, callee_profile_id, outcome, note, is_test)
    values (v_org, v_inc, v_admin, 'on_call_primary', v_cmo, 'no_answer', 'free text typed on the ops desk', true);
  perform pg_temp.res('a call logged on the ops desk is mirrored once, keyed to the page, outcome mapped to the fixed list, no note copied', '1,on_call_clinician,not_reached,null',
    (select count(*)::text from public.page_phone_fallbacks where page_id = v_pat) || ',' ||
    (select callee_kind || ',' || outcome || ',' || coalesce(note, 'null') from public.page_phone_fallbacks where page_id = v_pat));
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
  perform pg_temp.res('an admin logs the call', 'ok', pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''on_call_clinician'', ''not_reached'', ''rang twice'')', v_pg, v_s.clinician_id)));
  perform pg_temp.res('one row, keyed to the page, attributed to the caller', '1,true', (select count(*)::text from public.page_phone_fallbacks where page_id = v_pg and called_by = v_cadm and source = 'rpc') || ',' ||
    (select (outcome = 'not_reached' and callee_kind = 'on_call_clinician' and note = 'rang twice')::text from public.page_phone_fallbacks where page_id = v_pg and source = 'rpc'));
  perform pg_temp.res('and the audit trail records it', '1', (select count(*)::text from public.audit_log where action = 'page.phone_fallback_logged' and entity_id = v_pg));
  perform pg_temp.res('the ladder status now shows the call', '0',
    ((pg_temp.q_as(v_cadm, 'select public.red_ladder_status()')::jsonb) -> 'phone_fallbacks' ->> 'expired_pages_without_call_30d'));
  perform pg_temp.res('a plain user is refused, an unknown page, a blank outcome and a bad callee kind are refused', '42501,P0002,23514,23514',
    pg_temp.try_as(v_cplain, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''not_reached'')', v_pg, v_s.clinician_id)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''not_reached'')', gen_random_uuid(), v_s.clinician_id)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''   '')', v_pg, v_s.clinician_id)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''neighbour'', ''not_reached'')', v_pg, v_s.clinician_id)));
  perform pg_temp.res('a free-text outcome is refused (fixed list), an optional note may be left out', '23514,ok',
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''no_answer'')', v_pg, v_s.clinician_id)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''left_message'')', v_pg, v_s.clinician_id)));
  perform pg_temp.res('the person phoned must be clinical staff or an ops contact of THIS organisation: another organisation, a plain patient, are refused', '23514,23514',
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''not_reached'')', v_pg, v_admin)) || ',' ||
    pg_temp.try_as(v_cadm, format('select public.log_page_phone_fallback(%L, %L, ''other'', ''not_reached'')', v_pg, v_cplain)));
  -- PRIOR BEHAVIOUR: a TEST drill page with nobody on duty is silent (an audit row, no sev1, no notice)
  insert into public.ops_incidents (organisation_id, category, severity, title, external_reference, ack_due_at, resolve_due_at)
    values (v_s.organisation_id, 'clinical', 'sev1', 'W03 proof drill page', 'page_expired:' || v_pg, now(), now()) returning id into v_inc;
  perform pg_temp.res('PRIOR BEHAVIOUR: a test drill with nobody on duty leaves only an audit row: no uncovered incident', '1,0',
    (select count(*)::text from public.audit_log where action = 'ops_desk.uncovered_test' and entity_id = v_inc) || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || v_inc));

  -- SABOTAGE (c): the mirror trigger dropped -> the row must be missing
  drop trigger ops_desk_call_log_mirror_phone_fallbacks on public.ops_desk_call_log;
  v_pat := gen_random_uuid();
  insert into public.ops_incidents (organisation_id, category, severity, title, external_reference, ack_due_at, resolve_due_at)
    values (v_org, 'clinical', 'sev1', 'W03 proof expired page 2', 'page_expired:' || v_pat, now(), now()) returning id into v_inc;
  insert into public.ops_desk_call_log (organisation_id, incident_id, called_by, callee_kind, callee_profile_id, outcome, is_test)
    values (v_org, v_inc, v_admin, 'on_call_primary', v_cmo, 'no_answer', true);
  insert into results values ('sabotaged', 'without the mirror trigger the phone fallback is still logged', '1', (select count(*)::text from public.page_phone_fallbacks where page_id = v_pat));

  -- SABOTAGE (h): the switch guard dropped -> a direct flip would succeed (the check flips from 42501 to ok)
  drop trigger chain_canary_red_config_switch_guard on public.chain_canary_red_config;
  insert into results values ('sabotaged', 'without the switch guard a direct flip is refused', '42501', pg_temp.try('update public.chain_canary_red_config set red_lane_enabled = true'));

  -- SABOTAGE (i): the competency helper made always true -> the self-granted competency counts again after the date (the check flips)
  create or replace function private.rota_on_call_competent(p_profile uuid, p_exempt boolean) returns boolean language sql stable as
  $f$ select exists (select 1 from public.clinical_staff cs join public.clinician_competencies cc on cc.clinical_staff_id = cs.id and cc.revoked_at is null and cc.competency_code = 'on_call' where cs.profile_id = p_profile) $f$;
  update public.rota_cover_policy set sole_cmo_exception_sunset = (now() at time zone 'Africa/Lagos')::date - 1;
  insert into results values ('sabotaged', 'with the helper sabotaged the ended exception still bites', 'false', (private.rota_coverage(v_org4, false, now()) ->> 'meets_minimum'));
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W-03 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) < 8 then
    raise exception 'VACUOUS TEST: not every sabotage changed its outcome (% of 8): %', (select count(*) from results where phase = 'sabotaged' and expected <> actual),
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
