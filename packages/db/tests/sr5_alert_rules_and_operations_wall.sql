-- SR5 proof: operations alert rules, the evaluator, the on-call contact list and the operations wall
-- (migration *_sr5_alert_rules_and_operations_wall.sql). One rolled-back transaction.
--
--   1. Shape: RLS on, authenticated reads only, anon nothing, execute grants (anon/PUBLIC nothing; the feed is service role only).
--   2. The 14 rules exist, each has a check function, the three with no feed ship OFF with a reason.
--   3. Permissions: a patient cannot read the wall; only an admin changes a rule or the contact list; a rule cannot be switched off
--      without a reason; SMS is not a contact channel; a contact must be an active admin or clinician.
--   4. Behaviour (real, non-test rows): a breach opens ONE alert, ONE incident and tells the contact on its channels; the next
--      evaluation adds nothing (dedup); a reminder comes only after renotify_minutes; two clean evaluations resolve it and send one
--      quiet in-app all clear and nothing else; a repeat adds nothing. A rule is not re-run before min_interval_seconds.
--   5. No contact configured: the admins are told and a sev1 incident says the list is empty.
--   6. A check that raises opens an incident and records last_error (the rule is never silently blind).
--   7. External rules: off means no alert; on with no signal is a "signal_stale" breach; a fresh low value is clean; a high value breaches;
--      only the service role can write a signal.
--   8. Checks: stale cron (incl. the schedule parser), unacknowledged page.
--   9. The wall answers an admin, carries no fixture patient reference, and shows the open alert and the rules that are off.
--  10. SABOTAGE: RLS switched off on ops_alerts, and the ops gate opened to everyone; the matching checks must flip.
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
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'sr5-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'SR5 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- number of notification rows for a recipient, optionally one template and channel
create function pg_temp.nn(p_recipient uuid, p_template text default null, p_channel text default null) returns integer language sql as
$f$ select count(*)::integer from public.notifications where recipient_id = p_recipient and (p_template is null or template = p_template) and (p_channel is null or channel::text = p_channel) $f$;
create function pg_temp.alert_state(p_rule text) returns text language sql as
$f$ select coalesce((select state || ':' || notify_count || ':' || clean_streak from public.ops_alerts where rule_code = p_rule order by first_seen_at desc limit 1), 'none') $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_patient uuid; v_clin uuid; v_other_admin uuid; v_pay uuid; v_ev jsonb; v_wall jsonb; v_n integer; v_txt text;
  v_job bigint; v_task uuid; v_triage uuid; v_rs uuid; v_page uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_other_admin := pg_temp.mkuser(v_org, 'admin2', 'admin');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  insert into fx values ('admin', v_admin), ('patient', v_patient);
  -- a clean slate for the proof: nothing else may be open or configured
  delete from public.ops_oncall_contacts; delete from public.ops_alerts;
  update public.ops_alert_rules set last_evaluated_at = null, last_error = null;

  -- 1. Shape ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('the four tables have RLS on', '4', (select count(*)::text from pg_class where oid in ('public.ops_alert_rules'::regclass, 'public.ops_oncall_contacts'::regclass, 'public.ops_alerts'::regclass, 'public.ops_signals'::regclass) and relrowsecurity));
  perform pg_temp.rec('authenticated cannot write any of them', '0',
    (select count(*)::text from unnest(array['public.ops_alert_rules', 'public.ops_oncall_contacts', 'public.ops_alerts', 'public.ops_signals']) t
      where has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE')));
  perform pg_temp.rec('anon cannot read any of them', '0',
    (select count(*)::text from unnest(array['public.ops_alert_rules', 'public.ops_oncall_contacts', 'public.ops_alerts', 'public.ops_signals']) t where has_table_privilege('anon', t, 'SELECT')));
  perform pg_temp.rec('anon executes none of the new functions', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ((n.nspname = 'private' and (p.proname like 'ops\_check\_%' or p.proname in ('ops_sev_rank', 'ops_alert_incident', 'ops_alert_notify', 'ops_evaluate_alerts', 'ops_cron_expected_interval')))
          or (n.nspname = 'public' and p.proname in ('ops_set_alert_rule', 'ops_set_oncall_contact', 'ops_record_signal', 'operations_wall')))
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.rec('authenticated cannot run the evaluator or the feed', 'false|false',
    has_function_privilege('authenticated', 'private.ops_evaluate_alerts(boolean,boolean)', 'EXECUTE')::text || '|' || has_function_privilege('authenticated', 'public.ops_record_signal(text,numeric,text)', 'EXECUTE')::text);
  perform pg_temp.rec('the pre-existing incident trigger functions were not touched by the grants loop', 'true',
    has_function_privilege('authenticated', 'private.ops_incident_set_sla()', 'EXECUTE')::text);

  -- 2. The rules -----------------------------------------------------------------------------------------------
  perform pg_temp.rec('14 rules', '14', (select count(*)::text from public.ops_alert_rules));
  perform pg_temp.rec('every rule has a check function', '0',
    (select count(*)::text from public.ops_alert_rules r where to_regproc('private.ops_check_' || r.code) is null));
  perform pg_temp.rec('the three rules with no feed ship off, each with a reason', '3|3',
    (select count(*) filter (where not enabled)::text || '|' || count(*) filter (where not enabled and off_reason is not null)::text from public.ops_alert_rules));

  -- from here only the rules under test run, so the contact's notices can be counted exactly
  update public.ops_alert_rules set enabled = false, off_reason = 'proof isolation' where code not in ('payment_webhooks_unprocessed', 'edge_function_errors');

  -- 3. Permissions ---------------------------------------------------------------------------------------------
  perform pg_temp.act(v_patient);
  perform pg_temp.rec('a patient cannot read the wall', '42501', pg_temp.try('select public.operations_wall()'));
  perform pg_temp.rec('a patient sees no alert rows', '0', (select count(*)::text from public.ops_alert_rules));
  perform pg_temp.back();
  perform pg_temp.act(v_clin);
  perform pg_temp.rec('a clinician cannot change a rule', '42501', pg_temp.try('select public.ops_set_alert_rule(''queue_starvation'', true, null, null)'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot switch a rule off without a reason', '22023', pg_temp.try('select public.ops_set_alert_rule(''queue_starvation'', false, null, null)'));
  perform pg_temp.rec('an admin cannot add a patient as an on-call contact', '22023', pg_temp.try(format('select public.ops_set_oncall_contact(%L, array[''push''])', v_patient)));
  perform pg_temp.rec('sms is not a contact channel', '23514', pg_temp.try(format('select public.ops_set_oncall_contact(%L, array[''sms''])', v_admin)));
  perform pg_temp.rec('an admin can add a contact', 'ok', pg_temp.try(format('select public.ops_set_oncall_contact(%L, array[''push'',''email''], ''sev2'', 0, true)', v_admin)));
  perform pg_temp.back();
  perform pg_temp.rec('the contact change was audited', '1',
    (select count(*)::text from public.audit_log where action = 'ops_oncall_contact.changed' and actor_id = v_admin));

  -- 4. Behaviour: one breach, one alert, one incident, one notice per channel --------------------------------------
  insert into public.payment_transactions (provider_event_id, event_type, raw_payload, created_at)
    values ('sr5-proof-' || gen_random_uuid(), 'other', '{}'::jsonb, now() - interval '20 minutes') returning id into v_pay;
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('first evaluation raises the payment alert', 'open:1:0', pg_temp.alert_state('payment_webhooks_unprocessed'));
  perform pg_temp.rec('one incident for it', '1', (select count(*)::text from public.ops_incidents where external_reference = 'ops_alert:payment_webhooks_unprocessed:unprocessed'));
  perform pg_temp.rec('the contact got a push and an email, nothing else', '1|1|0', pg_temp.nn(v_admin, 'ops_alert', 'push')::text || '|' || pg_temp.nn(v_admin, 'ops_alert', 'email')::text || '|' || pg_temp.nn(v_admin, 'ops_alert', 'in_app')::text);
  perform pg_temp.rec('the notice carries no detail beyond ids', 'alert_id,rule,severity',
    (select string_agg(k, ',' order by k) from (select jsonb_object_keys(payload) k from public.notifications where recipient_id = v_admin and template = 'ops_alert' limit 3) x));
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('dedup: the next evaluation adds no alert and no notice', 'open:1:0|2|1',
    pg_temp.alert_state('payment_webhooks_unprocessed') || '|' || pg_temp.nn(v_admin, 'ops_alert')::text || '|' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_alert:payment_webhooks_unprocessed:unprocessed'));
  perform pg_temp.rec('a rule is not re-run before its interval', '0',
    ((private.ops_evaluate_alerts(false, false)) ->> 'evaluated'));
  update public.ops_alerts set last_notified_at = now() - interval '31 minutes' where rule_code = 'payment_webhooks_unprocessed';
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('a reminder follows after renotify_minutes, to the same contact', 'open:2:0|4', pg_temp.alert_state('payment_webhooks_unprocessed') || '|' || pg_temp.nn(v_admin, 'ops_alert')::text);
  update public.payment_transactions set processed_at = now() where id = v_pay;
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('one clean evaluation does not resolve (no flapping)', 'open:2:1|0', pg_temp.alert_state('payment_webhooks_unprocessed') || '|' || pg_temp.nn(v_admin, 'ops_all_clear')::text);
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('the second clean evaluation resolves it and sends one quiet in-app all clear', 'resolved:2:2|1|1',
    pg_temp.alert_state('payment_webhooks_unprocessed') || '|' || pg_temp.nn(v_admin, 'ops_all_clear')::text || '|' || pg_temp.nn(v_admin, 'ops_all_clear', 'in_app')::text);
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('a repeat sends nothing more', '1', pg_temp.nn(v_admin, 'ops_all_clear')::text);

  -- 5. No contact configured --------------------------------------------------------------------------------------
  delete from public.ops_oncall_contacts;
  update public.profiles set is_test = false where id = v_other_admin;
  update public.payment_transactions set processed_at = null where id = v_pay;
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('with no contact the active admins are told', 'true', (pg_temp.nn(v_other_admin, 'ops_alert') >= 1)::text);
  perform pg_temp.rec('and a sev1 incident says the list is empty', '1', (select count(*)::text from public.ops_incidents where external_reference = 'ops_alerts_no_contacts' and severity = 'sev1'));
  update public.payment_transactions set processed_at = now() where id = v_pay;

  -- 6. A check that raises --------------------------------------------------------------------------------------
  insert into public.ops_alert_rules (code, title, severity, source, enabled, params, min_interval_seconds, renotify_minutes) values ('boom', 'boom', 'sev2', 'database', true, '{}', 60, 30);
  create function private.ops_check_boom(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb) language plpgsql as $f$ begin raise exception 'proof boom'; end $f$;
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('a failing check is counted, recorded and opens an incident', '1|proof boom|1',
    (v_ev ->> 'failed') || '|' || (select last_error from public.ops_alert_rules where code = 'boom') || '|' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_rule_failed:boom'));
  perform pg_temp.rec('and the other rules were still evaluated', 'true', ((v_ev ->> 'evaluated')::integer >= 1)::text);
  delete from public.ops_alert_rules where code = 'boom';

  -- 7. External rules ------------------------------------------------------------------------------------------
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('a rule that is off raises nothing', 'none', pg_temp.alert_state('edge_function_errors'));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin switches the rule on', 'ok', pg_temp.try('select public.ops_set_alert_rule(''edge_function_errors'', true, null, null)'));
  perform pg_temp.back();
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('on with no signal is a stale-signal breach, not a green', 'open', split_part(pg_temp.alert_state('edge_function_errors'), ':', 1));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot write a signal', '42501', pg_temp.try('select public.ops_record_signal(''edge_error_rate_percent'', 0.2)'));
  perform pg_temp.back();
  perform pg_temp.act_service();
  perform pg_temp.rec('the service role writes a signal', 'ok', pg_temp.try('select public.ops_record_signal(''edge_error_rate_percent'', 0.2, ''proof'')'));
  perform pg_temp.back();
  v_ev := private.ops_evaluate_alerts(false, true);
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('a fresh low value clears it after two clean evaluations', 'resolved', split_part(pg_temp.alert_state('edge_function_errors'), ':', 1));
  perform pg_temp.act_service();
  perform public.ops_record_signal('edge_error_rate_percent', 4.5, 'proof');
  perform pg_temp.back();
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('a high value breaches', 'true', (exists (select 1 from public.ops_alerts where rule_code = 'edge_function_errors' and state = 'open' and dedup_key = 'value'))::text);

  -- 8. Other checks -----------------------------------------------------------------------------------------------
  perform pg_temp.rec('schedule parser, intervals and an unparseable schedule', 'true',
    (private.ops_cron_expected_interval('* * * * *') = interval '1 minute' and private.ops_cron_expected_interval('*/10 * * * *') = interval '10 minutes'
     and private.ops_cron_expected_interval('7 * * * *') = interval '1 hour' and private.ops_cron_expected_interval('0 */2 * * *') = interval '2 hours'
     and private.ops_cron_expected_interval('5 3 * * *') = interval '1 day' and private.ops_cron_expected_interval('15 seconds') = interval '15 seconds'
     and private.ops_cron_expected_interval('0 0 1 * *') is null)::text);
  select cron.schedule('sr5-proof-job', '* * * * *', 'select 1') into v_job;
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    values (v_job, (select coalesce(max(runid), 0) + 1 from cron.job_run_details), 1, 'postgres', 'postgres', 'select 1', 'succeeded', 'ok', now() - interval '31 minutes', now() - interval '31 minutes');
  perform pg_temp.rec('a job whose last success is 31 minutes old breaches a 1 minute schedule', '1',
    (select count(*)::text from private.ops_check_stale_cron('{"lookback_hours":72,"factor":2,"min_slack_minutes":2}', false) where dedup_key = 'job:sr5-proof-job'));
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    values (v_job, (select coalesce(max(runid), 0) + 1 from cron.job_run_details), 1, 'postgres', 'postgres', 'select 1', 'succeeded', 'ok', now() - interval '30 seconds', now() - interval '30 seconds');
  perform pg_temp.rec('a fresh success clears it', '0',
    (select count(*)::text from private.ops_check_stale_cron('{"lookback_hours":72,"factor":2,"min_slack_minutes":2}', false) where dedup_key = 'job:sr5-proof-job'));

  select id into v_rs from public.triage_rule_sets order by version desc limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (v_org, v_patient, 'observation', gen_random_uuid(), 'red', 'R1', v_rs, 'sr5', 1, 'approved', '[{"kind":"page_on_call"}]'::jsonb, false, false, gen_random_uuid()::text) returning id into v_triage;
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, config_version, is_test, sent_at)
    values (v_org, v_patient, v_triage, 'primary', v_clin, 0, 1, false, now() - interval '3 minutes') returning id into v_page;
  perform pg_temp.rec('a page unacknowledged for 3 minutes is inside its first step: no breach', '0', (select count(*)::text from private.ops_check_unacknowledged_page('{}', false)));
  update public.pages set sent_at = now() - interval '9 minutes' where id = v_page;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.rec('past the first step it breaches, with minutes and no patient', 'true',
    (select (count(*) = 1 and bool_and(detail::text not like '%' || v_patient::text || '%') and bool_and((detail ->> 'minutes_waiting')::integer >= 8))::text from private.ops_check_unacknowledged_page('{}', false)));
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_clin where id = v_page;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.rec('acknowledged: no breach', '0', (select count(*)::text from private.ops_check_unacknowledged_page('{}', false)));

  -- 9. The wall --------------------------------------------------------------------------------------------------------
  update public.payment_transactions set processed_at = null where id = v_pay;
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.act(v_admin);
  v_wall := public.operations_wall();
  perform pg_temp.back();
  perform pg_temp.rec('the wall has every section', 'true',
    (v_wall ?& array['generated_at', 'queue', 'tasks_claimed', 'pages', 'doctors_online', 'on_call_covered', 'calls_in_progress', 'calls_waiting', 'tests_this_week', 'notifications', 'payments', 'alerts', 'incidents_open'])::text);
  perform pg_temp.rec('the wall shows the open payment alert and the rules that are off', 'true',
    ((v_wall #>> '{payments,unprocessed}')::integer >= 1 and jsonb_array_length(v_wall #> '{alerts,open}') >= 1 and jsonb_array_length(v_wall #> '{alerts,rules_off}') = (select count(*) from public.ops_alert_rules where not enabled))::text);
  v_txt := v_wall::text;
  perform pg_temp.rec('the wall carries no fixture patient reference or name', 'false', (position(v_patient::text in v_txt) > 0 or position('SR5 patient' in v_txt) > 0)::text);
end $$;

-- 10. SABOTAGE --------------------------------------------------------------------------------------------------------------
do $$
declare v_patient uuid; v_admin uuid;
begin
  select id into v_patient from fx where label = 'patient';
  select id into v_admin from fx where label = 'admin';
  insert into public.ops_alerts (rule_code, dedup_key, severity, detail) values ('db_connections', 'sabotage', 'sev2', '{}') on conflict do nothing;
  -- sabotage 1: RLS off on ops_alerts; a patient could then read alerts
  alter table public.ops_alerts disable row level security;
  perform pg_temp.act(v_patient);
  insert into results values ('sabotaged', 'a patient sees no alert rows', '0', (select count(*)::text from public.ops_alerts));
  perform pg_temp.back();
  alter table public.ops_alerts enable row level security;
  -- sabotage 2: the ops gate opened to everyone; a patient could then read the wall
  create or replace function private.can_view_ops_console() returns boolean language sql as $f$ select true $f$;
  perform pg_temp.act(v_patient);
  insert into results values ('sabotaged', 'a patient cannot read the wall', '42501', pg_temp.try('select public.operations_wall()'));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'SR5 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
