-- SR2 proof: jobs that share a start time are spread over different minutes (migration *_sr2_stagger_cron_start_times.sql).
-- Proves in one rolled-back transaction: nine jobs scheduled '*/5' end on at least five distinct schedules, the first keeps '*/5', none
-- gets a period other than 5 minutes; three jobs sharing a daily time keep their hour and move forward by 0, 1 and 2 minutes; the
-- 15-second and every-minute jobs are not touched; a second run changes nothing; anon and authenticated cannot execute the function.
-- SABOTAGE: all nine jobs put back on '*/5' with the function not called; the distinct-schedule check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

do $$
declare i integer; v_min_before text; v_min_after text; v_ids bigint[];
begin
  -- park every real job that the function would touch so only the proof's rows are in play
  perform cron.alter_job(jobid, active := false) from cron.job where schedule in ('*/5 * * * *', '*/15 * * * *', '*/10 * * * *', '0 */4 * * *') or schedule ~ '^[0-9]+ [0-9]+ \* \* \*$';
  for i in 1..9 loop perform cron.schedule('sr2-proof-five-' || i, '*/5 * * * *', 'select 1'); end loop;
  for i in 1..3 loop perform cron.schedule('sr2-proof-daily-' || i, '20 6 * * *', 'select 1'); end loop;
  perform cron.schedule('sr2-proof-minute', '* * * * *', 'select 1');
  perform cron.schedule('sr2-proof-fifteen-seconds', '15 seconds', 'select 1');
  v_min_before := (select string_agg(jobname || '=' || schedule, ',' order by jobname) from cron.job where jobname in ('sr2-proof-minute', 'sr2-proof-fifteen-seconds'));

  perform private.stagger_cron_schedules();

  perform pg_temp.ck('real', 'nine */5 jobs end on at least five distinct schedules', 'true',
    ((select count(distinct schedule) from cron.job where jobname like 'sr2-proof-five-%') >= 5)::text);
  perform pg_temp.ck('real', 'the first */5 job keeps its schedule', '*/5 * * * *', (select schedule from cron.job where jobname = 'sr2-proof-five-1'));
  perform pg_temp.ck('real', 'every moved */5 job still runs every 5 minutes', '0',
    (select count(*)::text from cron.job where jobname like 'sr2-proof-five-%' and schedule !~ '^([0-4]-59/5|\*/5) \* \* \* \*$'));
  perform pg_temp.ck('real', 'daily jobs keep hour 6 and move 0, 1 and 2 minutes', '20,21,22',
    (select string_agg(split_part(schedule, ' ', 1), ',' order by jobname) from cron.job where jobname like 'sr2-proof-daily-%'));
  perform pg_temp.ck('real', 'daily jobs keep their hour', '6',
    (select string_agg(distinct split_part(schedule, ' ', 2), ',') from cron.job where jobname like 'sr2-proof-daily-%'));
  v_min_after := (select string_agg(jobname || '=' || schedule, ',' order by jobname) from cron.job where jobname in ('sr2-proof-minute', 'sr2-proof-fifteen-seconds'));
  perform pg_temp.ck('real', 'the every-minute and 15-second jobs are not touched', v_min_before, v_min_after);
  perform pg_temp.ck('real', 'a second run changes nothing', '0', private.stagger_cron_schedules()::text);
  perform pg_temp.ck('real', 'anon and authenticated cannot execute the function', 'false/false',
    has_function_privilege('anon', 'private.stagger_cron_schedules()', 'EXECUTE')::text || '/' || has_function_privilege('authenticated', 'private.stagger_cron_schedules()', 'EXECUTE')::text);

  -- SABOTAGE: everything back on the same start
  perform cron.alter_job(jobid, schedule := '*/5 * * * *') from cron.job where jobname like 'sr2-proof-five-%';
  perform pg_temp.ck('sabotaged', 'nine */5 jobs end on at least five distinct schedules (flips when sabotaged)', 'true',
    ((select count(distinct schedule) from cron.job where jobname like 'sr2-proof-five-%') >= 5)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'SR2 stagger proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage flipped % of 1 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
