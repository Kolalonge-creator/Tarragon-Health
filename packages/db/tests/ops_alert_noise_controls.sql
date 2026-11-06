-- Proof: operations alert noise controls (migration *_ops_alert_noise_controls.sql). One rolled-back transaction.
--
--   1. raise_after 2: the first breaching evaluation opens nothing; the second opens one alert and sends once.
--   2. A clean evaluation in between resets the count: breach, clean, breach opens nothing.
--   3. reopen_quiet_minutes 30: an alert that cleared moments ago is reopened on the next confirmed breach, no new row, no send.
--   4. The gate still opens: an alert that cleared more than 30 minutes ago is followed by a NEW alert and a send.
--   5. Live config: db_connections is 90 percent / raise_after 2 / reopen_quiet 30; infrastructure sev2 rules remind every 240
--      minutes or slower; queue_starvation and sev1 rules are unchanged.
--   6. SABOTAGE: the same scenarios with the two params removed (the behaviour before this migration). The hold and the quiet
--      reopen checks must flip.
--
-- The proof uses a rule of its own (proof_noise) whose check reads a temp switch, and switches every other rule off for the
-- transaction, so live data cannot move the counts.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create temp table proof_breach(on_now boolean not null) on commit drop;
insert into proof_breach values (false);
grant all on proof_breach to public;

create function private.ops_check_proof_noise(p jsonb, p_test boolean) returns table(dedup_key text, detail jsonb)
language sql stable as $$ select 'k', '{}'::jsonb from pg_temp.proof_breach where on_now $$;

update public.ops_alert_rules set enabled = false, off_reason = coalesce(off_reason, 'proof') where enabled;
insert into public.ops_alert_rules (code, title, severity, source, enabled, params, min_interval_seconds, renotify_minutes, open_incident, off_reason)
values ('proof_noise', 'Proof rule', 'sev3', 'database', true, '{}'::jsonb, 60, 240, false, null);

create function pg_temp.eval(p_on boolean) returns void language plpgsql as $f$
begin
  update proof_breach set on_now = p_on;
  perform private.ops_evaluate_alerts(false, true);
end $f$;

create function pg_temp.rows() returns integer language sql as $$ select count(*)::integer from public.ops_alerts where rule_code = 'proof_noise' $$;
create function pg_temp.open_rows() returns integer language sql as $$ select count(*)::integer from public.ops_alerts where rule_code = 'proof_noise' and state = 'open' $$;
create function pg_temp.sends() returns integer language sql as $$ select coalesce(sum(notify_count), 0)::integer from public.ops_alerts where rule_code = 'proof_noise' $$;

create function pg_temp.scenarios(p_phase text, p_params jsonb) returns void language plpgsql as $f$
begin
  delete from public.ops_alerts where rule_code = 'proof_noise';
  update public.ops_alert_rules set params = p_params, breach_streaks = '{}'::jsonb where code = 'proof_noise';

  -- 1. hold, then open
  perform pg_temp.eval(true);
  perform pg_temp.rec(p_phase, 'first breach is held', '0', pg_temp.open_rows()::text);
  perform pg_temp.eval(true);
  perform pg_temp.rec(p_phase, 'second breach opens one alert', '1', pg_temp.open_rows()::text);
  perform pg_temp.rec(p_phase, 'second breach sends once', '1', pg_temp.sends()::text);

  -- clear it (two clean evaluations)
  perform pg_temp.eval(false);
  perform pg_temp.eval(false);
  perform pg_temp.rec(p_phase, 'two clean evaluations resolve', '0', pg_temp.open_rows()::text);

  -- 3. flap straight back: quiet reopen of the same row, no send
  perform pg_temp.eval(true);
  perform pg_temp.eval(true);
  perform pg_temp.rec(p_phase, 'a flap reopens the same alert (no new row)', '1', pg_temp.rows()::text);
  perform pg_temp.rec(p_phase, 'a flap is open again', '1', pg_temp.open_rows()::text);
  perform pg_temp.rec(p_phase, 'a flap sends nothing', '1', pg_temp.sends()::text);

  -- 4. the gate opens: cleared more than 30 minutes ago, so a new breach is a new alert and a send
  perform pg_temp.eval(false);
  perform pg_temp.eval(false);
  update public.ops_alerts set resolved_at = now() - interval '31 minutes' where rule_code = 'proof_noise';
  perform pg_temp.eval(true);
  perform pg_temp.eval(true);
  perform pg_temp.rec(p_phase, 'after the quiet window a new alert opens', '2', pg_temp.rows()::text);
  perform pg_temp.rec(p_phase, 'after the quiet window it sends', '2', pg_temp.sends()::text);

  -- 2. a clean evaluation resets the count
  perform pg_temp.eval(false);
  perform pg_temp.eval(false);
  update public.ops_alerts set resolved_at = now() - interval '31 minutes' where rule_code = 'proof_noise';
  perform pg_temp.eval(true);
  perform pg_temp.eval(false);
  perform pg_temp.eval(true);
  perform pg_temp.rec(p_phase, 'breach, clean, breach opens nothing', '0', pg_temp.open_rows()::text);
end $f$;

select pg_temp.scenarios('real', '{"raise_after": 2, "reopen_quiet_minutes": 30}'::jsonb);
-- a test-mode run keeps its own streak and never resets the live count
delete from public.ops_alerts where rule_code = 'proof_noise';
update public.ops_alert_rules set params = '{"raise_after": 3}'::jsonb, breach_streaks = '{}'::jsonb where code = 'proof_noise';
select pg_temp.eval(true);
update proof_breach set on_now = false;
select private.ops_evaluate_alerts(true, true);
select pg_temp.rec('real', 'a test-mode run leaves the live streak alone', '1',
  (select breach_streaks ->> 'k' from public.ops_alert_rules where code = 'proof_noise'));

select pg_temp.scenarios('sabotage', '{}'::jsonb);

-- 5. live config
select pg_temp.rec('real', 'db_connections params', '{"max_percent": 90, "raise_after": 2, "reopen_quiet_minutes": 30}',
  (select params::text from public.ops_alert_rules where code = 'db_connections'));
select pg_temp.rec('real', 'infrastructure sev2 rules remind every 4 hours or slower', '0',
  (select count(*)::text from public.ops_alert_rules
    where code in ('db_connections', 'notification_failure_rate', 'payment_webhooks_unprocessed', 'zoom_webhooks_unprocessed',
                   'stale_cron', 'zoom_join_fallback', 'edge_function_errors') and renotify_minutes < 240));
select pg_temp.rec('real', 'queue_starvation cadence unchanged', '30', (select renotify_minutes::text from public.ops_alert_rules where code = 'queue_starvation'));
select pg_temp.rec('real', 'sev1 rules unchanged (none slower than 60)', '0',
  (select count(*)::text from public.ops_alert_rules where severity = 'sev1' and renotify_minutes > 60));

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'ops alert noise proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  if not exists (select 1 from results where phase = 'sabotage' and check_name = 'first breach is held' and expected <> actual) then
    raise exception 'VACUOUS TEST: removing raise_after was not caught';
  end if;
  if not exists (select 1 from results where phase = 'sabotage' and check_name = 'a flap sends nothing' and expected <> actual) then
    raise exception 'VACUOUS TEST: removing reopen_quiet_minutes was not caught';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results order by phase, check_name;

rollback;
