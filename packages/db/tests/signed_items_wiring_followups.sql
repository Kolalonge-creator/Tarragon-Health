-- ===========================================================================
-- Proof: 20261102135233_ai023_runtime_governed.sql, 20261102135251_glucose_wording_guard_names_its_real_reader.sql,
--        20261102135310_community_overdue_check_runs_in_pg_cron.sql
-- PROVES 1. AI-023 is runtime_governed and ai_runtime_config reports it; this migration did not change is_enabled (asserted
--           by comparing with the flag's own value rather than a literal, since the CMO owns that switch).
--        2. The glucose wording guard no longer names a function that does not exist.
--        3. The community-overdue pg_cron job exists at */10 and private.community_overdue_run() writes a fresh heartbeat
--           (last_ok true, last_run_at now). SABOTAGE: with community_overdue_work broken, the run reports ok=false and
--           the heartbeat records last_ok=false (the failure is visible, not silent).
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================
begin;
create temp table siw (check_name text, observed text, expected text, verdict text);
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin insert into siw values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end); end $$;
do $$
declare v jsonb; v_src text;
begin
  perform pg_temp.chk('1a AI-023 runtime_governed', 'true', (select runtime_governed::text from public.ai_systems where system_code = 'AI-023'));
  perform pg_temp.chk('1b ai_runtime_config reports governed', 'true', (public.ai_runtime_config('AI-023')->>'runtime_governed'));
  perform pg_temp.chk('2 glucose guard enforced_in names no phantom function', 'false', ((select enforced_in from public.go_live_guards where key = 'glucose_fast_sugar_wording') @> array['glucose_fast_sugar_wording_in_force'])::text);
  perform pg_temp.chk('3a community-overdue job scheduled every 10 minutes', '*/10 * * * *', (select schedule from cron.job where jobname = 'community-overdue' and active));
  v := private.community_overdue_run();
  perform pg_temp.chk('3b run reports ok', 'true', v->>'ok');
  perform pg_temp.chk('3c heartbeat fresh and ok', 'true', (select (last_ok and last_run_at > now() - interval '1 minute')::text from public.community_job_runs where job = 'overdue'));
  -- SABOTAGE: break the work reader; the run must say so and the heartbeat must record the failure
  v_src := pg_get_functiondef('public.community_overdue_work'::regproc);
  execute 'create or replace function public.community_overdue_work() returns jsonb language plpgsql security definer set search_path to '''' as $f$ begin raise exception ''sabotage''; end $f$';
  v := private.community_overdue_run();
  perform pg_temp.chk('3d SABOTAGE broken reader: run reports ok=false', 'false', v->>'ok');
  perform pg_temp.chk('3e SABOTAGE heartbeat records last_ok=false', 'false', (select last_ok::text from public.community_job_runs where job = 'overdue'));
  execute v_src;
end $$;
select * from siw order by check_name;
do $$
declare n integer; begin select count(*) into n from siw where verdict = 'FAIL'; if n > 0 then raise exception 'signed items wiring proof: % check(s) FAILED', n; end if; end $$;
rollback;
