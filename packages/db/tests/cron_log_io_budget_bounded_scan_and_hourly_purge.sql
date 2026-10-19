-- Disk IO budget proof (migration *_cron_log_io_budget_bounded_failure_scan_and_hourly_purge.sql).
-- Proves in one rolled-back transaction: record_cron_failures still opens one sev3 incident for an ordinary job and a sev2 for a sweep-type job
-- from a failed run inside the 45 minute window, adds no duplicate on a second pass, and ignores a failed run older than the window;
-- purge_cron_history deletes a succeeded run older than a day, but keeps one younger than a day, keeps a job's LATEST succeeded run however old
-- (so the stale-cron rule and the automations sync still see a daily job), keeps a job's latest run of any status, keeps a failed run 29 days
-- old and deletes one 31 days old; the purge is scheduled hourly; anon cannot execute either function.
-- SABOTAGE: a purge that deletes every succeeded run older than a day with no keep rule; the latest-succeeded check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
-- runids above anything real so "latest" in the proof means latest of the proof's own jobs, and rise in insertion order
create sequence pg_temp.runid_seq start 9100000000;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.run(p_job bigint, p_status text, p_age interval, p_msg text) returns void language sql as
$$ insert into cron.job_run_details (runid, jobid, database, username, command, status, return_message, start_time, end_time)
   values (nextval('pg_temp.runid_seq'), p_job, 'postgres', 'postgres', 'iobudget-proof', p_status, p_msg, now() - p_age, now() - p_age) $$;
create function pg_temp.left_n(p_note text) returns text language sql as
$$ select count(*)::text from cron.job_run_details where command = 'iobudget-proof' and return_message = p_note $$;

do $$
declare v_sweep bigint; i integer;
begin
  select cron.schedule('iobudget-proof-sweep-pages', '0 0 1 1 *', 'select 1') into v_sweep;

  -- job 999101: an old success, then a newer success older than a day (the latest success), then nothing newer
  perform pg_temp.run(999101, 'succeeded', interval '5 days', 'ok-5d');
  perform pg_temp.run(999101, 'succeeded', interval '3 days', 'ok-3d-latest');
  -- job 999102: successes, the newest of them young
  perform pg_temp.run(999102, 'succeeded', interval '2 days', 'ok-2d');
  perform pg_temp.run(999102, 'succeeded', interval '20 hours', 'ok-20h');
  -- job 999103: a latest run that is a failure, with an older success
  perform pg_temp.run(999103, 'succeeded', interval '4 days', 'ok-4d-before-fail');
  perform pg_temp.run(999103, 'failed', interval '3 days', 'fail-3d-latest');
  perform pg_temp.run(999104, 'failed', interval '31 days', 'fail-31d');
  perform pg_temp.run(999104, 'failed', interval '29 days', 'fail-29d');
  -- failures for the incident part
  perform pg_temp.run(999105, 'failed', interval '2 minutes', 'startup trouble');
  perform pg_temp.run(v_sweep, 'failed', interval '2 minutes', 'startup trouble');
  perform pg_temp.run(999106, 'failed', interval '2 hours', 'too old for the window');

  perform private.record_cron_failures();
  perform pg_temp.ck('real', 'an ordinary job failure inside the window opens one sev3 technical incident', '1/sev3/technical',
    (select count(*) || '/' || min(severity::text) || '/' || min(category::text) from public.ops_incidents where external_reference like 'cron-failure:job 999105:%'));
  perform pg_temp.ck('real', 'a sweep-type job failure opens a sev2', 'sev2',
    (select severity::text from public.ops_incidents where external_reference like 'cron-failure:iobudget-proof-sweep-pages:%'));
  perform pg_temp.ck('real', 'a failed run older than the 45 minute window opens nothing', '0',
    (select count(*)::text from public.ops_incidents where external_reference like 'cron-failure:job 999106:%'));
  perform private.record_cron_failures();
  perform pg_temp.ck('real', 'a second pass opens no duplicate', '2',
    (select count(*)::text from public.ops_incidents where external_reference like 'cron-failure:job 999105:%' or external_reference like 'cron-failure:iobudget-proof-sweep-pages:%'));

  -- the purge deletes at most 60,000 rows a call, so drain any backlog first (a no-op on a fresh database)
  for i in 1..30 loop
    exit when private.purge_cron_history() = 0;
  end loop;
  perform pg_temp.ck('real', 'one purge call never deletes more than 60,000 rows', 'true', (private.purge_cron_history() <= 60000)::text);
  perform pg_temp.ck('real', 'an old succeeded run that is not the latest is deleted', '0', pg_temp.left_n('ok-5d'));
  perform pg_temp.ck('real', 'the latest succeeded run of a job is kept however old', '1', pg_temp.left_n('ok-3d-latest'));
  perform pg_temp.ck('real', 'a succeeded run older than a day is deleted when a newer success exists', '0', pg_temp.left_n('ok-2d'));
  perform pg_temp.ck('real', 'a succeeded run younger than a day is kept', '1', pg_temp.left_n('ok-20h'));
  perform pg_temp.ck('real', 'the latest run of a job is kept even when it failed', '1', pg_temp.left_n('fail-3d-latest'));
  perform pg_temp.ck('real', 'the latest success of that job is kept too', '1', pg_temp.left_n('ok-4d-before-fail'));
  perform pg_temp.ck('real', 'a failed run older than 30 days is deleted', '0', pg_temp.left_n('fail-31d'));
  perform pg_temp.ck('real', 'a failed run 29 days old is kept', '1', pg_temp.left_n('fail-29d'));
  perform pg_temp.ck('real', 'the purge is scheduled hourly', '15 * * * *', (select schedule from cron.job where jobname = 'purge-cron-history'));
  perform pg_temp.ck('real', 'anon cannot execute either function', 'false',
    (has_function_privilege('anon', 'private.purge_cron_history()', 'EXECUTE') or has_function_privilege('anon', 'private.record_cron_failures()', 'EXECUTE'))::text);

  -- SABOTAGE: a purge with no keep rule
  create or replace function private.purge_cron_history() returns bigint language plpgsql security definer set search_path = '' as
  $f$ begin delete from cron.job_run_details where status = 'succeeded' and start_time < now() - interval '1 day'; return 0; end $f$;
  perform pg_temp.run(999107, 'succeeded', interval '3 days', 'ok-3d-latest-2');
  perform private.purge_cron_history();
  perform pg_temp.ck('sabotaged', 'the latest succeeded run of a job survives (flips when sabotaged)', '1', pg_temp.left_n('ok-3d-latest-2'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'IO budget proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage flipped % of 1 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
