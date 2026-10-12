-- SR2 proof: scheduled-job history is purged on the 7/30-day rule, and a failed run opens an ops incident first
-- (migration *_sr2_cron_history_purge_and_failure_incidents.sql).
-- Proves in one rolled-back transaction: a succeeded run older than 7 days and a failed run older than 30 days are deleted; a succeeded
-- run 6 days old and a failed run 29 days old are kept; a recent failed run of an ordinary job opens ONE sev3 technical incident and a
-- second pass adds no duplicate; a failed run of a sweep-type job opens a sev2; the purge itself records failures before deleting; the
-- two jobs are scheduled; anon and authenticated cannot execute either function.
-- SABOTAGE: purge_cron_history replaced by one that deletes everything older than a day; the keep checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.run(p_job bigint, p_status text, p_age interval, p_msg text) returns void language sql as
$$ insert into cron.job_run_details (jobid, database, username, command, status, return_message, start_time, end_time)
   values (p_job, 'postgres', 'postgres', 'sr2-proof', p_status, p_msg, now() - p_age, now() - p_age) $$;
create function pg_temp.left_n(p_note text) returns text language sql as
$$ select count(*)::text from cron.job_run_details where command = 'sr2-proof' and return_message = p_note $$;

do $$
declare v_sweep bigint; v_n integer; v_inc_before integer;
begin
  select cron.schedule('sr2-proof-sweep-pages', '0 0 1 1 *', 'select 1') into v_sweep;
  perform pg_temp.run(999001, 'succeeded', interval '8 days',  'old-ok');
  perform pg_temp.run(999001, 'succeeded', interval '6 days',  'new-ok');
  perform pg_temp.run(999001, 'failed',    interval '31 days', 'old-fail');
  perform pg_temp.run(999001, 'failed',    interval '29 days', 'new-fail');
  perform pg_temp.run(999002, 'failed',    interval '2 minutes', 'startup trouble');
  perform pg_temp.run(v_sweep, 'failed',   interval '2 minutes', 'startup trouble');

  select count(*) into v_inc_before from public.ops_incidents where external_reference like 'cron-failure:%';
  perform private.record_cron_failures();
  perform pg_temp.ck('real', 'an ordinary job failure opens one sev3 technical incident',
    '1/sev3/technical', (select count(*) || '/' || min(severity::text) || '/' || min(category::text) from public.ops_incidents where external_reference like 'cron-failure:job 999002:%'));
  perform pg_temp.ck('real', 'a sweep-type job failure opens a sev2', 'sev2',
    (select severity::text from public.ops_incidents where external_reference like 'cron-failure:sr2-proof-sweep-pages:%'));
  perform private.record_cron_failures();
  perform pg_temp.ck('real', 'a second pass opens no duplicate', '2',
    ((select count(*) from public.ops_incidents where external_reference like 'cron-failure:%') - v_inc_before)::text);

  perform private.purge_cron_history();
  perform pg_temp.ck('real', 'a succeeded run older than 7 days is deleted', '0', pg_temp.left_n('old-ok'));
  perform pg_temp.ck('real', 'a failed run older than 30 days is deleted', '0', pg_temp.left_n('old-fail'));
  perform pg_temp.ck('real', 'a succeeded run 6 days old is kept', '1', pg_temp.left_n('new-ok'));
  perform pg_temp.ck('real', 'a failed run 29 days old is kept', '1', pg_temp.left_n('new-fail'));
  perform pg_temp.ck('real', 'the purge keeps the incident the failure opened', '2',
    ((select count(*) from public.ops_incidents where external_reference like 'cron-failure:%') - v_inc_before)::text);
  perform pg_temp.ck('real', 'both jobs are scheduled', '2', (select count(*)::text from cron.job where jobname in ('record-cron-failures', 'purge-cron-history')));
  perform pg_temp.ck('real', 'anon and authenticated cannot execute either function', 'false/false',
    (has_function_privilege('anon', 'private.purge_cron_history()', 'EXECUTE') or has_function_privilege('anon', 'private.record_cron_failures()', 'EXECUTE'))::text || '/' ||
    (has_function_privilege('authenticated', 'private.purge_cron_history()', 'EXECUTE') or has_function_privilege('authenticated', 'private.record_cron_failures()', 'EXECUTE'))::text);

  -- SABOTAGE: a purge that deletes everything older than a day
  create or replace function private.purge_cron_history() returns bigint language plpgsql security definer set search_path = '' as
  $f$ begin delete from cron.job_run_details where start_time < now() - interval '1 day'; return 0; end $f$;
  perform pg_temp.run(999001, 'succeeded', interval '6 days', 'new-ok2');
  perform pg_temp.run(999001, 'failed',    interval '29 days', 'new-fail2');
  perform private.purge_cron_history();
  perform pg_temp.ck('sabotaged', 'a 6-day succeeded run survives (flips when sabotaged)', '1', pg_temp.left_n('new-ok2'));
  perform pg_temp.ck('sabotaged', 'a 29-day failed run survives (flips when sabotaged)', '1', pg_temp.left_n('new-fail2'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'SR2 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase desc, check_name;
rollback;
