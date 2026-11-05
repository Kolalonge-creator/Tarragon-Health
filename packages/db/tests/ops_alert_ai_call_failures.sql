-- Proof: the ai_call_failures operations alert rule (migration *_ops_alert_ai_call_failures.sql). One rolled-back transaction.
--
--   1. Shape: the rule is seeded on, sev3, no incident; anon and authenticated cannot execute the check.
--   2. Thresholds: nothing logged is clean; 2 failures is under the minimum volume; 3 failures with nothing reaching the model breach
--      at 100 percent; 1 failure in 10 (10 percent) is clean.
--   3. What counts: a degraded fallback that carries an error_message is a failure; a kill-switch fallback (no error_message) is
--      not, however many there are.
--   4. Test subjects: excluded by default, included when the evaluator runs with p_include_test.
--   5. The evaluator: a breach opens one ai_call_failures alert and, being sev3, no incident.
--   6. SABOTAGE: (a) the check counts every fallback as a failure, (b) the check stops excluding test subjects. Each must flip
--      the matching check.
--
-- Every scenario uses its own vendor, so live rows from real vendors cannot move the counts.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

-- a vendor + system of its own, so each scenario is counted alone. system_code must match ^AI-[0-9]{3}$; the proof takes the
-- unused AI-9xx block (real systems are numbered from AI-001 upward).
create temp sequence proof_ai_code start 900 maxvalue 999;
create function pg_temp.mksystem(p_label text) returns uuid language plpgsql as $f$
declare v_vendor uuid; v_sys uuid; v_code text;
begin
  loop
    v_code := 'AI-' || nextval('proof_ai_code')::text;
    exit when not exists (select 1 from public.ai_systems where system_code = v_code);
  end loop;
  insert into public.ai_vendors (name, vendor_type) values ('Proof vendor ' || p_label || ' ' || gen_random_uuid(), 'model_provider')
  returning id into v_vendor;
  insert into public.ai_systems (system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful, fallback_behaviour, vendor_id)
  values (v_code, 'Proof ' || p_label, 'proof', 'admin',
          (select enum_range(null::public.ai_risk_class))[1], (select enum_range(null::public.ai_autonomy_level))[1], false, 'manual', v_vendor)
  returning id into v_sys;
  return v_sys;
end $f$;

-- a test patient of the proof's own, so CI does not depend on seed data
create function pg_temp.mktestpatient() returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'aifail-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, (select id from public.organisations order by created_at limit 1), 'patient', 'AI failures proof patient',
          '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set is_test = true;
  return v;
end $f$;

-- n rows for a system: status, with or without an error message, about a subject (null = no subject)
create function pg_temp.log(p_sys uuid, p_n integer, p_status text, p_error text default null, p_subject uuid default null)
returns void language sql as $f$
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, status, error_message, subject_profile_id,
                                         fallback_used, fallback_reason)
  select (select id from public.organisations order by created_at limit 1), p_sys,
         case when p_status = 'completed' then 'claude-proof' else 'none:fallback' end, 'proof', p_status::public.ai_interaction_status, p_error, p_subject,
         p_status = 'fallback',
         case when p_status = 'fallback' then coalesce('the AI call failed: ' || p_error, 'switched off by clinical governance') end
    from generate_series(1, p_n)
$f$;

-- the breach row for one system's vendor, or 'none'
create function pg_temp.breach(p_sys uuid, p_test boolean default false) returns text language sql as $f$
  select coalesce((
    select (c.detail ->> 'failed') || '/' || (c.detail ->> 'reached_model') || '@' || (c.detail ->> 'failed_percent')
      from private.ops_check_ai_call_failures((select params from public.ops_alert_rules where code = 'ai_call_failures'), p_test) c
     where c.dedup_key = 'vendor:' || (select v.name from public.ai_vendors v join public.ai_systems s on s.vendor_id = v.id where s.id = p_sys)
  ), 'none')
$f$;

create function pg_temp.scenarios(p_phase text) returns void language plpgsql as $f$
declare v_s uuid; v_patient uuid;
begin
  v_s := pg_temp.mksystem('empty');
  perform pg_temp.rec(p_phase, 'nothing logged is clean', 'none', pg_temp.breach(v_s));

  v_s := pg_temp.mksystem('under');
  perform pg_temp.log(v_s, 2, 'failed', 'Anthropic API key not found');
  perform pg_temp.rec(p_phase, '2 failures is under the minimum volume', 'none', pg_temp.breach(v_s));

  v_s := pg_temp.mksystem('outage');
  perform pg_temp.log(v_s, 3, 'failed', 'Anthropic API key not found');
  perform pg_temp.rec(p_phase, '3 failures and nothing reaching the model breach', '3/0@100.0', pg_temp.breach(v_s));

  v_s := pg_temp.mksystem('blip');
  perform pg_temp.log(v_s, 1, 'failed', 'timeout');
  perform pg_temp.log(v_s, 9, 'completed');
  perform pg_temp.rec(p_phase, '1 failure in 10 is clean', 'none', pg_temp.breach(v_s));

  v_s := pg_temp.mksystem('degraded');
  perform pg_temp.log(v_s, 3, 'fallback', 'model unreachable: 529 overloaded');
  perform pg_temp.rec(p_phase, 'a degraded fallback with an error is a failure', '3/0@100.0', pg_temp.breach(v_s));

  v_s := pg_temp.mksystem('killswitch');
  perform pg_temp.log(v_s, 10, 'fallback');
  perform pg_temp.log(v_s, 3, 'completed');
  perform pg_temp.rec(p_phase, 'kill-switch fallbacks are not failures', 'none', pg_temp.breach(v_s));

  v_patient := pg_temp.mktestpatient();
  v_s := pg_temp.mksystem('testsubject');
  perform pg_temp.log(v_s, 4, 'failed', 'boom', v_patient);
  perform pg_temp.rec(p_phase, 'test subjects are excluded by default', 'none', pg_temp.breach(v_s, false));
  perform pg_temp.rec(p_phase, 'test subjects count when the evaluator includes test', '4/0@100.0', pg_temp.breach(v_s, true));
end $f$;

do $$
declare v_s uuid; v_ev jsonb;
begin
  -- 1. Shape
  perform pg_temp.rec('real', 'the rule is seeded on, sev3, without an incident', 'true|sev3|false',
    (select enabled::text || '|' || severity::text || '|' || open_incident::text from public.ops_alert_rules where code = 'ai_call_failures'));
  perform pg_temp.rec('real', 'anon and authenticated cannot execute the check', 'false|false',
    has_function_privilege('anon', 'private.ops_check_ai_call_failures(jsonb,boolean)', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'private.ops_check_ai_call_failures(jsonb,boolean)', 'EXECUTE')::text);

  -- 2-4. Thresholds, what counts, test subjects
  perform pg_temp.scenarios('real');

  -- 5. The evaluator, with only this rule running
  delete from public.ops_alerts where rule_code = 'ai_call_failures';
  update public.ops_alert_rules set enabled = false, off_reason = 'proof isolation' where code <> 'ai_call_failures';
  update public.ops_alert_rules set last_evaluated_at = null where code = 'ai_call_failures';
  v_s := pg_temp.mksystem('evaluator');
  perform pg_temp.log(v_s, 5, 'failed', 'Anthropic API key not found');
  v_ev := private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('real', 'the evaluator raises an ai_call_failures alert', 'open',
    coalesce((select state from public.ops_alerts a join public.ai_vendors v on a.dedup_key = 'vendor:' || v.name
               join public.ai_systems s on s.vendor_id = v.id where s.id = v_s and a.rule_code = 'ai_call_failures'), 'none'));
  perform pg_temp.rec('real', 'sev3 opens no incident', '0',
    (select count(*)::text from public.ops_incidents where external_reference like 'ops_alert:ai_call_failures:%'));
end $$;

-- 6. Sabotage (a): every fallback counted as a failure. The kill-switch scenario must flip.
create or replace function private.ops_check_ai_call_failures(p jsonb, p_test boolean)
returns table(dedup_key text, detail jsonb) language sql stable security definer set search_path to '' as $$
  with w as (
    select coalesce(v.name, 'Unknown vendor') as vendor,
           count(*) filter (where l.status in ('completed', 'blocked')) as reached,
           count(*) filter (where l.status in ('failed', 'fallback')) as failed
      from public.ai_interaction_log l join public.ai_systems s on s.id = l.ai_system_id
      left join public.ai_vendors v on v.id = s.vendor_id left join public.profiles sp on sp.id = l.subject_profile_id
     where l.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 60))
       and (p_test or not coalesce(sp.is_test, false))
     group by 1)
  select 'vendor:' || vendor, jsonb_build_object('vendor', vendor, 'reached_model', reached, 'failed', failed,
         'failed_percent', round(100.0 * failed / nullif(reached + failed, 0), 1))
    from w where reached + failed >= coalesce((p ->> 'min_volume')::integer, 3)
     and 100.0 * failed / nullif(reached + failed, 0) > coalesce((p ->> 'max_failed_percent')::numeric, 25);
$$;
select pg_temp.scenarios('sabotage_fallback');

-- 6. Sabotage (b): test subjects no longer excluded. The default-exclusion scenario must flip.
create or replace function private.ops_check_ai_call_failures(p jsonb, p_test boolean)
returns table(dedup_key text, detail jsonb) language sql stable security definer set search_path to '' as $$
  with w as (
    select coalesce(v.name, 'Unknown vendor') as vendor,
           count(*) filter (where l.status in ('completed', 'blocked')) as reached,
           count(*) filter (where l.status = 'failed' or (l.status = 'fallback' and l.error_message is not null)) as failed
      from public.ai_interaction_log l join public.ai_systems s on s.id = l.ai_system_id
      left join public.ai_vendors v on v.id = s.vendor_id
     where l.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 60))
     group by 1)
  select 'vendor:' || vendor, jsonb_build_object('vendor', vendor, 'reached_model', reached, 'failed', failed,
         'failed_percent', round(100.0 * failed / nullif(reached + failed, 0), 1))
    from w where reached + failed >= coalesce((p ->> 'min_volume')::integer, 3)
     and 100.0 * failed / nullif(reached + failed, 0) > coalesce((p ->> 'max_failed_percent')::numeric, 25);
$$;
select pg_temp.scenarios('sabotage_test');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'ai_call_failures proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  if not exists (select 1 from results where phase = 'sabotage_fallback' and check_name = 'kill-switch fallbacks are not failures' and expected <> actual) then
    raise exception 'VACUOUS TEST: counting kill-switch fallbacks as failures was not caught';
  end if;
  if not exists (select 1 from results where phase = 'sabotage_test' and check_name = 'test subjects are excluded by default' and expected <> actual) then
    raise exception 'VACUOUS TEST: dropping the test-subject exclusion was not caught';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results order by phase, check_name;

rollback;
