-- S51 proof: the assistant_enabled go-live guard, KB source metadata, protocol limits, events and generic templates
-- (migration *_s51_assistant_guard_knowledge_events.sql). Spec B.7; INV-07, INV-14, INV-16.
-- One rolled-back transaction. Sections:
--   1. The guard is born off, fails closed (unknown key, signed-out), and opens for a real patient only when on; an is_test patient is
--      always let through (the test rule), a real patient is not.
--   2. Its three conditions are read from data: approved KB rows (reviewed, owned, FUTURE review date), a REVIEWED passing red-team run, the switch.
--      A lapsed or ownerless row does not count; an unreviewed run does not count.
--   3. assistant_knowledge_sources: retrievable only with an owner and a future review date; lpe owner comes from reviewed_by.
--   4. assistant_protocol_limits returns limits and never the step table.
--   5. Events: the three types exist; the service role can emit, a patient cannot; a missing required key is refused.
--   6. Notification templates: the INV-07 lint still refuses a clinical word in the two new templates; the shipped wording passes.
--   7. Grants: anon has nothing; assistant_config is unreadable by authenticated.
--   8. The existing guard conditions are intact (the patch added a branch, it did not replace the function).
--   9. SABOTAGE: the metadata function is replaced to call everything retrievable; the lapsed-row and ownerless checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.q_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's51g-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'S51 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set is_test = excluded.is_test, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.kb(p_code text, p_owner text, p_due timestamptz, p_reviewed boolean) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.health_education_content (code, title, body, clinician_reviewed, is_active, category, reviewed_by_name, review_due_at, content_version, content_status)
  values (p_code, 'S51 ' || p_code, 'body', p_reviewed, true, 'medicines', p_owner, p_due, 2, 'published') returning id into v;
  return v;
end $f$;
create function pg_temp.cond(p_code text) returns text language sql as
$$ select c ->> 'met' from jsonb_array_elements(private.go_live_conditions('assistant_enabled', null)) c where c ->> 'code' = p_code $$;
create function pg_temp.src(p_uid uuid, p_id uuid, p_field text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select (x ->> %L) from jsonb_array_elements(public.assistant_knowledge_sources(array[%L::uuid])) x', p_field, p_id)) $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_real uuid; v_test uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_real := pg_temp.mkuser(v_org, 'real', false);
  v_test := pg_temp.mkuser(v_org, 'test', true);
  perform pg_temp.setf('real', v_real);
  perform pg_temp.setf('test', v_test);
  perform pg_temp.setf('kb_ok', pg_temp.kb('s51-ok', 'Dr A. Obi', now() + interval '90 days', true));
  perform pg_temp.setf('kb_lapsed', pg_temp.kb('s51-lapsed', 'Dr A. Obi', now() - interval '1 day', true));
  perform pg_temp.setf('kb_noowner', pg_temp.kb('s51-noowner', null, now() + interval '90 days', true));
  perform pg_temp.setf('kb_nodate', pg_temp.kb('s51-nodate', 'Dr A. Obi', null, true));
  perform pg_temp.setf('kb_unreviewed', pg_temp.kb('s51-unrev', 'Dr A. Obi', now() + interval '90 days', false));
  -- a reviewed lpe block, owner from reviewed_by
  insert into public.lpe_content_blocks (key, title, body_md, clinician_reviewed, reviewed_by, reviewed_at, review_due_at, content_version)
    values ('s51_lpe_ok', 'S51 lpe', 'x', true, v_test, now(), now() + interval '60 days', 4);
  perform pg_temp.setf('lpe_ok', (select id from public.lpe_content_blocks where key = 's51_lpe_ok'));
  insert into public.lpe_content_blocks (key, title, body_md, clinician_reviewed, reviewed_by, reviewed_at)
    values ('s51_lpe_nodate', 'S51 lpe nodate', 'x', true, v_test, now());
  perform pg_temp.setf('lpe_nodate', (select id from public.lpe_content_blocks where key = 's51_lpe_nodate'));
end $$;

-- 1. The guard ---------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'the guard is born off', 'false', (select is_on::text from public.go_live_guards where key = 'assistant_enabled'));
select pg_temp.ck('real', 'it is switched by the CMO', 'cmo', (select switch_role from public.go_live_guards where key = 'assistant_enabled'));
select pg_temp.ck('real', 'a real patient sees it closed', 'false', pg_temp.q_as(pg_temp.f('real'), $q$select public.go_live_guard_is_open('assistant_enabled')::text$q$));
select pg_temp.ck('real', 'an is_test patient is let through (test rule)', 'true', pg_temp.q_as(pg_temp.f('test'), $q$select public.go_live_guard_is_open('assistant_enabled')::text$q$));
select pg_temp.ck('real', 'an unknown key is closed for a real patient', 'false', pg_temp.q_as(pg_temp.f('real'), $q$select public.go_live_guard_is_open('assistant_enabled_typo')::text$q$));
select pg_temp.ck('real', 'signed out is closed', 'ERR:42501', pg_temp.q_anon($q$select public.go_live_guard_is_open('assistant_enabled')::text$q$));
select pg_temp.ck('real', 'a bare UPDATE cannot switch the guard on, even for the table owner', '42501',
  pg_temp.try_sql($q$update public.go_live_guards set is_on = true, changed_at = now(), changed_by = (select id from public.profiles limit 1), change_note = 'x' where key = 'assistant_enabled'$q$));

-- 2. Conditions ----------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'it has exactly three conditions', '3', jsonb_array_length(private.go_live_conditions('assistant_enabled', null))::text);
select pg_temp.ck('real', 'approved KB rows is unmet below the minimum (one good row of 20)', 'false', pg_temp.cond('approved_kb_rows'));
select pg_temp.ck('real', 'red-flag evaluation is unmet with no run', 'false', pg_temp.cond('red_flag_tests_passing'));
select pg_temp.ck('real', 'the sign-off condition is the switch itself', 'true', pg_temp.cond('clinical_lead_signoff'));
select pg_temp.ck('real', 'the detail names the count', '2 of 20 needed',
  (select c ->> 'detail' from jsonb_array_elements(private.go_live_conditions('assistant_enabled', null)) c where c ->> 'code' = 'approved_kb_rows'));

-- fill the minimum with good rows: now met
do $$
begin
  for i in 1..19 loop perform pg_temp.kb('s51-fill-' || i, 'Dr A. Obi', now() + interval '30 days', true); end loop;
end $$;
select pg_temp.ck('real', 'approved KB rows is met at the minimum', 'true', pg_temp.cond('approved_kb_rows'));

-- an unreviewed run does not count, a reviewed passing red-team run does
do $$
declare v_sys uuid; v_suite uuid;
begin
  select id into v_sys from public.ai_systems where system_code = 'AI-001';
  select id into v_suite from public.ai_evaluation_suites where ai_system_id = v_sys and kind = 'red_team' limit 1;
  set local session_replication_role = replica;
  insert into public.ai_evaluation_runs (ai_system_id, suite_id, total_cases, passed_cases, failed_cases, outcome, completed_at)
    values (v_sys, v_suite, 7, 7, 0, 'pass', now());
  set local session_replication_role = origin;
end $$;
select pg_temp.ck('real', 'a passing run nobody reviewed does not count', 'false', pg_temp.cond('red_flag_tests_passing'));
do $$
declare v_sys uuid; v_suite uuid;
begin
  select id into v_sys from public.ai_systems where system_code = 'AI-001';
  select id into v_suite from public.ai_evaluation_suites where ai_system_id = v_sys and kind = 'red_team' limit 1;
  set local session_replication_role = replica;
  insert into public.ai_evaluation_runs (ai_system_id, suite_id, total_cases, passed_cases, failed_cases, outcome, completed_at, reviewed_by, reviewed_at)
    values (v_sys, v_suite, 7, 7, 0, 'pass', now(), gen_random_uuid(), now());
  set local session_replication_role = origin;
end $$;
select pg_temp.ck('real', 'a reviewed passing run counts', 'true', pg_temp.cond('red_flag_tests_passing'));
select pg_temp.ck('real', 'the guard is still off: conditions never switch it on by themselves', 'false', (select is_on::text from public.go_live_guards where key = 'assistant_enabled'));

-- 3. Source metadata -----------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'a reviewed, owned row with a future date is retrievable', 'true', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_ok'), 'retrievable'));
select pg_temp.ck('real', 'it carries owner', 'Dr A. Obi', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_ok'), 'owner'));
select pg_temp.ck('real', 'it carries version', '2', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_ok'), 'version'));
select pg_temp.ck('real', 'a lapsed row is not retrievable', 'false', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_lapsed'), 'retrievable'));
select pg_temp.ck('real', 'a row with no owner is not retrievable', 'false', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_noowner'), 'retrievable'));
select pg_temp.ck('real', 'a row with no review date is not retrievable', 'false', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_nodate'), 'retrievable'));
select pg_temp.ck('real', 'an unreviewed row is not retrievable', 'false', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_unreviewed'), 'retrievable'));
select pg_temp.ck('real', 'an lpe block is owned by its reviewer', 'S51 test', pg_temp.src(pg_temp.f('real'), pg_temp.f('lpe_ok'), 'owner'));
select pg_temp.ck('real', 'an lpe block with a date is retrievable', 'true', pg_temp.src(pg_temp.f('real'), pg_temp.f('lpe_ok'), 'retrievable'));
select pg_temp.ck('real', 'an lpe block with no date is not retrievable', 'false', pg_temp.src(pg_temp.f('real'), pg_temp.f('lpe_nodate'), 'retrievable'));
select pg_temp.ck('real', 'anon cannot read source metadata', 'ERR:42501', pg_temp.q_anon($q$select public.assistant_knowledge_sources(array[gen_random_uuid()])::text$q$));

-- 4. Protocol limits: limits only ----------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('test');
begin
  insert into public.protocols (code, version, status, definition, approved_by, approved_at)
  values ('s51_proof', 1, 'approved',
    '{"code":"s51_proof","version":1,"status":"approved","params":{"staleAfterDays":14,"minReadings":3},"steps":[{"id":"step1","proposal":{"drugName":"SECRETDRUG"}}]}'::jsonb,
    v_admin, now());
end $$;
select pg_temp.ck('real', 'a patient reads the approved limits', 'true',
  pg_temp.q_as(pg_temp.f('real'), $q$select (public.assistant_protocol_limits()::text like '%staleAfterDays%')::text$q$));
select pg_temp.ck('real', 'the step table never leaves', 'false',
  pg_temp.q_as(pg_temp.f('real'), $q$select (public.assistant_protocol_limits()::text like '%SECRETDRUG%' or public.assistant_protocol_limits()::text like '%steps%')::text$q$));
select pg_temp.ck('real', 'anon cannot read limits', 'ERR:42501', pg_temp.q_anon($q$select public.assistant_protocol_limits()::text$q$));

-- 5. Events ---------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'three assistant event types exist', '3', (select count(*)::text from public.event_types where event_type like 'assistant.%'));
select pg_temp.ck('real', 'the service role can emit assistant.handoff', 'ok',
  case when pg_temp.q_service(format($q$select public.emit_domain_event('assistant.handoff', %L::uuid, '{"conversation_id":"c1","target":"symptom_checker"}'::jsonb, 's51-proof-1', %L::uuid)::text$q$, pg_temp.f('org'), pg_temp.f('real'))) like 'ERR:%' then 'refused' else 'ok' end);
select pg_temp.ck('real', 'a patient cannot emit an event', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('real'), format($q$select public.emit_domain_event('assistant.message', %L::uuid, '{"conversation_id":"c1","tier":"routine"}'::jsonb, 's51-proof-2', %L::uuid)::text$q$, pg_temp.f('org'), pg_temp.f('real'))));
select pg_temp.ck('real', 'a payload missing a required key is refused', 'refused',
  case when pg_temp.q_service(format($q$select public.emit_domain_event('assistant.red_flag_detected', %L::uuid, '{"conversation_id":"c1"}'::jsonb, 's51-proof-3', %L::uuid)::text$q$, pg_temp.f('org'), pg_temp.f('real'))) like 'ERR:%' then 'refused' else 'ok' end);

-- 6. Templates and the INV-07 lint -------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'both templates exist with in-app and push wording', '4',
  (select count(*)::text from public.notification_template_locales where template_key in ('assistant_daily_nudge', 'assistant_weekly_reflection') and locale = 'en'));
select pg_temp.ck('real', 'the lint refuses a clinical word in the daily nudge template', '23514',
  pg_temp.try_sql($q$insert into public.notification_template_locales (template_key, locale, channel, subject, body) values ('assistant_daily_nudge', 'en', 'email', 'Hello', 'Your blood pressure reading is ready')$q$));
select pg_temp.ck('real', 'the shipped wording has no violation', '0',
  (select count(*)::text from public.notification_template_locales l where l.template_key like 'assistant_%' and cardinality(private.notification_text_violations(coalesce(l.subject, '') || ' ' || l.body)) > 0));

-- 7. Grants ---------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'authenticated cannot read assistant_config', 'ERR:42501', pg_temp.q_as(pg_temp.f('real'), 'select count(*)::text from public.assistant_config'));
select pg_temp.ck('real', 'anon cannot execute the conditions helper', 'false', has_function_privilege('anon', 'private.go_live_conditions_assistant(uuid)', 'EXECUTE')::text);

-- 8. The existing guard conditions are intact -----------------------------------------------------------------------------------------
select pg_temp.ck('real', 'clinical_operations_enabled still has its conditions', 'true',
  (jsonb_array_length(private.go_live_conditions('clinical_operations_enabled', null)) >= 4)::text);
select pg_temp.ck('real', 'scribe_enabled still has its conditions', 'true',
  (jsonb_array_length(private.go_live_conditions('scribe_enabled', null)) >= 2)::text);
select pg_temp.ck('real', 'an unknown key still fails closed', 'unknown_guard',
  (private.go_live_conditions('no_such_guard', null) -> 0 ->> 'code'));

-- 9. SABOTAGE: everything retrievable ---------------------------------------------------------------------------------------------
create or replace function public.assistant_knowledge_sources(p_ids uuid[]) returns jsonb language sql stable security definer set search_path = '' as
$$ select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'retrievable', true, 'owner', h.reviewed_by_name)), '[]'::jsonb) from public.health_education_content h where h.id = any (p_ids) $$;
select pg_temp.ck('sabotaged', 'a lapsed row is not retrievable', 'false', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_lapsed'), 'retrievable'));
select pg_temp.ck('sabotaged', 'a row with no owner is not retrievable', 'false', pg_temp.src(pg_temp.f('real'), pg_temp.f('kb_noowner'), 'retrievable'));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S51 guard proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
