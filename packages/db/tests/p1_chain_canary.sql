-- P1 proof: the live canary for the clinical chain (migration *_p1_chain_canary.sql).
--
-- Proves in one rolled-back transaction:
--   1. Subjects: the synthetic organisation, patient, clinician and admin exist once (idempotent), all is_test, in their own organisation.
--   2. A run inserts the enabled fixtures through the real insert path (reading + symptom), writes an append-only 'started' row, and the
--      bus emits observation.recorded for each.
--   3. A STOPPED PROCESSOR makes the canary fail: with nothing consuming the bus the run fails at stage 'graded', names it, and opens a
--      sev1 incident. (This is the acceptance sabotage from the plan.)
--   4. With the processor's work emulated (the same RPCs process-events calls: record_triage_result, create_tasks_from_triage_event,
--      create_red_page, deliveries done) the run passes: red graded, paged, notified neutrally and acknowledged; amber graded with a task and no page.
--   5. Isolation: no notification in the whole transaction reached a profile outside the synthetic organisation, none is 'pending', and the
--      real on-call rota is untouched (INV-13, never pages real clinicians).
--   6. A page notification that carries a reading fails 'notification_not_neutral' (INV-07).
--   7. Clean-up leaves no open task or page, so the next run starts clean; the tick evaluates then starts, a second tick waits, a stale
--      canary raises an incident.
--   8. RLS and grants: admin and the CMO read runs, a patient and anon do not; runs are append only; the subjects table is closed.
--   9. SABOTAGE: with the auto-acknowledge trigger dropped the run must fail at 'ack'; with the record-only trigger dropped a canary
--      notification stays 'pending' (and so would be sent).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table notif_before on commit drop as select id from public.notifications;

create function pg_temp.res(p_check text, p_expected text, p_actual text) returns void language sql as
$f$ insert into results values ('real', p_check, p_expected, p_actual) $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'p1-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'P1 ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

create function pg_temp.run_readings(p_run uuid) returns setof uuid language sql as
$f$ select (x ->> 'reading_id')::uuid from public.chain_canary_runs r, jsonb_array_elements(r.fixtures) x where r.run_id = p_run and r.kind = 'started' $f$;

-- Stand in for process-events: the same database calls its handlers make, for every fixture reading of a run.
create function pg_temp.emulate_processor(p_run uuid) returns void language plpgsql as $f$
declare
  it jsonb; v_rs uuid; v_res jsonb; v_te uuid; r record; v_code text;
begin
  select id into v_rs from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' order by version desc limit 1;
  for it in select * from jsonb_array_elements((select fixtures from public.chain_canary_runs where run_id = p_run and kind = 'started')) loop
    v_code := it ->> 'fixture';
    select version into r from public.triage_rule_sets where id = v_rs;
    if v_code = 'bp_red_chest_pain' then
      v_res := jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'BP-R1', 'explanationKey', 'EMG-001',
        'actions', '[{"kind":"show_emergency_guidance","code":"EMG-001"},{"kind":"page_on_call"}]'::jsonb, 'matchedRuleIds', '["BP-R1"]'::jsonb, 'taskKey', null,
        'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', r.version));
    else
      v_res := jsonb_build_object('status', 'graded', 'grade', 'amber', 'ruleId', 'BP-A7', 'explanationKey', 'TRI-004',
        'actions', '[{"kind":"create_task","task":"low_bp_review","notifyKey":"notify.triage.task_created","dueMinutes":1440}]'::jsonb,
        'matchedRuleIds', '["BP-A7"]'::jsonb, 'taskKey', 'low_bp_review', 'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', r.version));
    end if;
    perform public.record_triage_result((it ->> 'reading_id')::uuid, v_res, v_rs, null, '');
    select id into v_te from public.triage_events where trigger_id = (it ->> 'reading_id')::uuid;
    perform public.create_tasks_from_triage_event(v_te);
    perform public.create_red_page(v_te);
  end loop;
  update public.domain_event_deliveries d set status = 'done', done_at = now()
   where d.status = 'pending' and d.event_id in (select e.id from public.domain_events e where e.event_type = 'triage.graded' and e.is_test);
  set constraints all immediate;   -- fires the deferred auto-acknowledge, as commit would
  set constraints all deferred;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_pat uuid; v_s public.chain_canary_subjects; v_t0 timestamptz := clock_timestamp();
  v_run uuid; v_run2 uuid; v_run3 uuid; v_run4 uuid; v_ok boolean; v_n integer; v_tick jsonb; v_rota_before integer; v_err text; v_stage text; v_nid uuid;
begin
  select id into v_org from public.organisations where not coalesce((metadata ->> 'canary')::boolean, false) order by created_at limit 1;
  select count(*) into v_rota_before from public.on_call_rota where organisation_id = v_org;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_cmo, v_org, 'P1 CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin, true);

  -- 1. Subjects ---------------------------------------------------------------------------------------------------------
  v_s := private.chain_canary_ensure();
  perform pg_temp.res('the canary has its own organisation', 'true', (select (metadata ->> 'canary')::boolean::text from public.organisations where id = v_s.organisation_id));
  perform pg_temp.res('the canary organisation is not the real one', 'true', (v_s.organisation_id <> v_org)::text);
  perform pg_temp.res('all three subjects are test profiles in it', '3', (select count(*)::text from public.profiles where id in (v_s.patient_id, v_s.clinician_id, v_s.admin_id) and is_test and organisation_id = v_s.organisation_id));
  perform pg_temp.res('the synthetic clinician is a test staff row', 'true', (select is_test::text from public.clinical_staff where profile_id = v_s.clinician_id));
  perform pg_temp.res('a second ensure returns the same subjects', v_s.patient_id::text, (private.chain_canary_ensure()).patient_id::text);
  perform pg_temp.res('only the canary organisation has canary staff', '0', (select count(*)::text from public.profiles where id in (v_s.patient_id, v_s.clinician_id, v_s.admin_id) and organisation_id = v_org));

  -- 2. A run ---------------------------------------------------------------------------------------------------------------
  v_run := private.chain_canary_start();
  perform pg_temp.res('a run inserts one reading per enabled fixture', '2', (select count(*)::text from public.vitals_readings where patient_id = v_s.patient_id));
  perform pg_temp.res('the disabled glucose hook inserted nothing', '0', (select count(*)::text from public.vitals_readings where patient_id = v_s.patient_id and vital_type = 'glucose'));
  perform pg_temp.res('the red fixture has its red-flag symptom', '1', (select count(*)::text from public.symptoms where patient_id = v_s.patient_id and symptom_type = 'chest_pain'));
  perform pg_temp.res('the bus emitted observation.recorded for both, as test events', '2,true', (select count(*)::text || ',' || bool_and(is_test)::text from public.domain_events where event_type = 'observation.recorded' and patient_id = v_s.patient_id and idempotency_key not like '%:sym:%'));
  perform pg_temp.res('a started row was written', '1', (select count(*)::text from public.chain_canary_runs where run_id = v_run and kind = 'started'));
  perform pg_temp.res('a synthetic on-call rota covers now, is_test', '1', (select count(*)::text from public.on_call_rota where organisation_id = v_s.organisation_id and is_test and starts_at <= now() and ends_at > now()));

  -- 3. STOPPED PROCESSOR: nothing consumes the bus, the run must fail and name the stage ------------------------------------
  v_ok := private.chain_canary_evaluate(v_run);
  perform pg_temp.res('a stopped processor fails the canary', 'false', v_ok::text);
  perform pg_temp.res('the result names the stage graded', 'graded', (select failed_stage from public.chain_canary_runs where run_id = v_run and kind = 'result'));
  perform pg_temp.res('an incident was opened naming the stage, sev1 because a red fixture is affected', 'sev1', (select severity::text from public.ops_incidents where external_reference = 'chain_canary:graded' and status not in ('resolved', 'closed')));
  perform pg_temp.res('the incident summary says which stage', 'true', (select (summary like '%stage "graded"%')::text from public.ops_incidents where external_reference = 'chain_canary:graded'));
  perform pg_temp.res('a run evaluates once', '', coalesce(private.chain_canary_evaluate(v_run)::text, ''));

  -- the membership self-heals: a run restores a lapsed synthetic membership (else a red would take the Free path)
  delete from public.patient_memberships where patient_id = v_s.patient_id;
  perform pg_temp.res('the synthetic patient is not a member once its membership is gone', 'false', private.patient_is_member(v_s.patient_id)::text);
  v_run4 := private.chain_canary_start();
  perform pg_temp.res('starting a run restores the synthetic membership', 'true', private.patient_is_member(v_s.patient_id)::text);
  perform private.chain_canary_evaluate(v_run4);

  -- 4. The processor runs: the chain passes --------------------------------------------------------------------------------
  v_run2 := private.chain_canary_start();
  perform pg_temp.emulate_processor(v_run2);
  v_ok := private.chain_canary_evaluate(v_run2);
  perform pg_temp.res('with the processor working the canary passes', 'true', coalesce(v_ok::text, 'null'));
  perform pg_temp.res('red graded red, amber graded amber', 'amber,red', (select string_agg(te.grade, ',' order by te.grade) from public.triage_events te where te.trigger_id in (select pg_temp.run_readings(v_run2))));
  perform pg_temp.res('the red event made one root page to the synthetic clinician', '1', (select count(*)::text from public.pages p join public.triage_events te on te.id = p.triage_event_id join public.vitals_readings vr on vr.id = te.trigger_id where p.parent_page_id is null and p.to_clinician_id = v_s.clinician_id and vr.id in (select pg_temp.run_readings(v_run2))));
  perform pg_temp.res('the page was acknowledged by the real acknowledge_page path', 'true', (select (acknowledged_by = v_s.clinician_id)::text from public.pages p where p.to_clinician_id = v_s.clinician_id order by p.sent_at desc limit 1));
  perform pg_temp.res('the amber event made a task and no page', '1,0', (select count(*)::text from public.clinical_tasks t where t.patient_id = v_s.patient_id and t.type = 'amber_bp_review' and t.is_test and t.triage_event_id in (select id from public.triage_events where trigger_id in (select pg_temp.run_readings(v_run2))))
     || ',' || (select count(*)::text from public.pages p join public.triage_events te on te.id = p.triage_event_id where te.grade = 'amber' and te.trigger_id in (select pg_temp.run_readings(v_run2))));
  perform pg_temp.res('the result row is passed', 'true', (select passed::text from public.chain_canary_runs where run_id = v_run2 and kind = 'result'));
  perform pg_temp.res('clean-up left no open canary task or page', '0,0',
    (select count(*)::text from public.clinical_tasks where organisation_id = v_s.organisation_id and state not in ('completed', 'cancelled'))
    || ',' || (select count(*)::text from public.pages where organisation_id = v_s.organisation_id and closed_at is null));
  perform pg_temp.res('clean-up recorded no errors', '[]', (select details -> 'cleanup_errors' from public.chain_canary_runs where run_id = v_run2 and kind = 'result')::text);

  -- 5. Isolation ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.res('no notification went to anyone outside the canary subjects', '0',
    (select count(*)::text from public.notifications n where n.id not in (select id from notif_before) and not private.chain_canary_is_subject(n.recipient_id)));
  perform pg_temp.res('canary notifications exist and none is pending', 'true,0',
    (select (count(*) > 0)::text from public.notifications n where private.chain_canary_is_subject(n.recipient_id))
    || ',' || (select count(*)::text from public.notifications n where private.chain_canary_is_subject(n.recipient_id) and n.status = 'pending'));
  perform pg_temp.res('the page notification went out as push, in-app and email, all recorded not sent', '3,3',
    (select count(*)::text from public.notifications n where n.template = 'on_call_page' and private.chain_canary_is_subject(n.recipient_id) and n.source_id = (select id from public.pages where to_clinician_id = v_s.clinician_id order by sent_at desc limit 1))
    || ',' || (select count(*)::text from public.notifications n where n.template = 'on_call_page' and n.status = 'suppressed' and private.chain_canary_is_subject(n.recipient_id)) );
  perform pg_temp.res('the real organisation rota is untouched', v_rota_before::text, (select count(*)::text from public.on_call_rota where organisation_id = v_org));

  -- 6. Neutral wording ------------------------------------------------------------------------------------------------------------
  v_run3 := private.chain_canary_start();
  perform pg_temp.emulate_processor(v_run3);
  update public.notifications set payload = payload || '{"systolic": 190}'::jsonb
   where template = 'on_call_page' and private.chain_canary_is_subject(recipient_id)
     and source_id in (select p.id from public.pages p join public.triage_events te on te.id = p.triage_event_id where te.trigger_id in (select pg_temp.run_readings(v_run3)));
  v_ok := private.chain_canary_evaluate(v_run3);
  perform pg_temp.res('a page notification carrying a reading fails notification_not_neutral', 'false,notification_not_neutral',
    v_ok::text || ',' || (select failed_stage from public.chain_canary_runs where run_id = v_run3 and kind = 'result'));

  -- 7. The tick -----------------------------------------------------------------------------------------------------------------------
  select count(*) into v_n from public.chain_canary_runs where kind = 'started';
  v_tick := private.chain_canary_tick();
  perform pg_temp.res('a tick starts a run', 'true', (v_tick ->> 'started' is not null)::text);
  v_tick := private.chain_canary_tick();
  perform pg_temp.res('a second tick starts nothing while one is still waiting', 'true', (v_tick ->> 'started' is null)::text);
  update public.chain_canary_config set rules = jsonb_set(rules, '{minEvalAgeSeconds}', '-3600') where is_active;
  v_tick := private.chain_canary_tick();
  perform pg_temp.res('the next tick evaluates the waiting run and starts a fresh one', '1,true', (v_tick ->> 'evaluated') || ',' || (v_tick ->> 'started' is not null)::text);
  update public.chain_canary_config set rules = jsonb_set(rules, '{staleAfterMinutes}', '-5') where is_active;
  perform private.chain_canary_tick();
  perform pg_temp.res('a canary that stopped reporting raises a stale incident', '1', (select count(*)::text from public.ops_incidents where external_reference = 'chain_canary:stale'));

  -- 8. RLS, grants, append only -----------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.res('a patient reads no runs', '0', (select count(*)::text from public.chain_canary_runs));
  perform pg_temp.res('a patient cannot run the canary now', '42501', pg_temp.try('select public.chain_canary_run_now()'));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.res('an admin reads runs', 'true', ((select count(*) from public.chain_canary_runs) > 0)::text);
  perform pg_temp.res('nobody reads the subjects table', '42501', pg_temp.try('select * from public.chain_canary_subjects'));
  perform pg_temp.res('an admin cannot write a run', '42501', pg_temp.try($q$insert into public.chain_canary_runs (run_id, kind, config_version) values (gen_random_uuid(), 'started', 1)$q$));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.res('the CMO reads runs', 'true', ((select count(*) from public.chain_canary_runs) > 0)::text);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  perform pg_temp.res('anon cannot read runs', '42501', pg_temp.try('select * from public.chain_canary_runs'));
  reset role;
  perform pg_temp.res('a run cannot be edited', '42501', pg_temp.try($q$update public.chain_canary_runs set passed = true where kind = 'result'$q$));
  perform pg_temp.res('a run cannot be deleted', '42501', pg_temp.try($q$delete from public.chain_canary_runs$q$));
  perform pg_temp.res('anon has no execute on the run-now RPC', 'false', has_function_privilege('anon', 'public.chain_canary_run_now()', 'EXECUTE')::text);
  perform pg_temp.res('authenticated has no execute on the tick', 'false', has_function_privilege('authenticated', 'private.chain_canary_tick()', 'EXECUTE')::text);
  perform pg_temp.res('there is exactly one canary cron job and it is not per minute', '11,41 * * * *', (select schedule from cron.job where jobname = 'chain-canary'));

  -- 9. SABOTAGE ----------------------------------------------------------------------------------------------------------------------
  drop trigger pages_chain_canary_auto_ack on public.pages;
  declare v_run5 uuid := private.chain_canary_start();
  begin
    perform pg_temp.emulate_processor(v_run5);
    v_ok := private.chain_canary_evaluate(v_run5);
    insert into results values ('sabotaged', 'without the auto-ack trigger the run still passes', 'true', coalesce(v_ok::text, 'null') || ':' || coalesce((select failed_stage from public.chain_canary_runs where run_id = v_run5 and kind = 'result'), ''));
    perform pg_temp.res('without the auto-ack the canary fails at ack (the check can fail)', 'false:ack', v_ok::text || ':' || (select failed_stage from public.chain_canary_runs where run_id = v_run5 and kind = 'result'));
  end;
  drop trigger notifications_chain_canary_record_only on public.notifications;
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority)
    values (v_s.clinician_id, v_s.organisation_id, 'push', 'on_call_page', '{}'::jsonb, 'pending', 'non_clinical', 'critical') returning id into v_nid;
  insert into results values ('sabotaged', 'with the record-only trigger dropped a canary notification is recorded not sent', 'suppressed',
    (select status::text from public.notifications where id = v_nid));
  perform pg_temp.res('with the record-only trigger dropped a canary notification would be sent', 'pending', (select status::text from public.notifications where id = v_nid));
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'P1 canary proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) = 0 then
    raise exception 'VACUOUS TEST: the sabotage did not change the outcome';
  end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
