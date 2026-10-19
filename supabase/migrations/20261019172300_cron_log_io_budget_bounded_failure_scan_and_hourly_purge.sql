-- Disk IO budget fix (Supabase "depleting Disk IO Budget" warning, 2026-10-19).
-- Measured on the live project the same day: cron.job_run_details held ~295,000 rows (176 MB heap) and has only its primary key, and the
-- table belongs to supabase_admin, so no index can be added to it and it cannot be rewritten from SQL. The biggest reader was
-- private.record_cron_failures(): it filtered on status and start_time with no usable index, so each call read the whole table
-- (824 calls, ~1.4M blocks read). private.ops_evaluate_alerts() added ~2.1M more (its stale-cron rule reads the same table; left alone
-- here on purpose, it feeds alerting and gets its own reviewed change).
-- Two changes, no schedule of a clinical job is touched:
--   1. record_cron_failures() walks the log newest-first on the primary key (runid is a sequence, so newest-first is time order) and
--      stops at the first run older than 45 minutes. Same incidents, same severities, same de-duplication; it reads ~1,500 rows, not 295,000.
--   2. purge_cron_history() keeps succeeded runs for 1 day instead of 7, but ALWAYS keeps each job's latest run and latest succeeded run,
--      so ops_check_stale_cron (72 h lookback, last success per job) and sync_automations_from_cron (latest run per job) see exactly what they
--      saw before, including for daily jobs. Failed runs are still kept 30 days. The purge now runs hourly, not daily, so the table
--      holds ~1 day of history instead of 7-8.
-- Rows deleted by this migration: none. The first hourly purge removes the backlog (about 250,000 succeeded runs older than a day) in
-- batches of 50,000, up to 8 batches per run, so a larger backlog finishes on the next run.

create or replace function private.record_cron_failures()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_ref text;
  v_n integer := 0;
  v_sev public.ops_incident_severity;
  v_cutoff timestamptz := now() - interval '45 minutes';
begin
  -- runids rise with time, so the newest 20,000 runs on the primary key cover the 45 minute window many times over (~35 runs a minute);
  -- the window edge is the lowest runid among them that is still inside it. Only those rows are aggregated.
  for r in
    with recent as (
      select d.jobid, d.start_time, d.return_message, d.status
        from cron.job_run_details d
       where d.runid >= coalesce((
               select min(x.runid) from (
                 select t.runid, t.start_time from cron.job_run_details t order by t.runid desc limit 20000
               ) x where x.start_time > v_cutoff
             ), 9223372036854775807)  -- no run inside the window means nothing to report, and nothing to read
    )
    select coalesce(j.jobname, 'job ' || f.jobid) as jobname, f.jobid, count(*) as failures, max(f.start_time) as last_at,
           max(f.return_message) as msg, to_char(date_trunc('hour', f.start_time), 'YYYYMMDDHH24') as hr
      from recent f
      left join cron.job j on j.jobid = f.jobid
     where f.status = 'failed' and f.start_time > v_cutoff
     group by 1, 2, 6
  loop
    v_ref := 'cron-failure:' || r.jobname || ':' || r.hr;
    v_sev := case when r.jobname ~ '(page|claim|task|triage|escalate|notification|process-events)' then 'sev2' else 'sev3' end;
    if exists (select 1 from public.ops_incidents where external_reference = v_ref) then
      update public.ops_incidents
         set summary = r.failures || ' failed run(s) this hour, latest ' || to_char(r.last_at, 'YYYY-MM-DD HH24:MI') || ' UTC: ' || left(coalesce(r.msg, ''), 200)
       where external_reference = v_ref and status not in ('resolved', 'closed');
    else
      insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values ('technical', v_sev, 'Scheduled job failed: ' || r.jobname,
              r.failures || ' failed run(s) this hour, latest ' || to_char(r.last_at, 'YYYY-MM-DD HH24:MI') || ' UTC: ' || left(coalesce(r.msg, ''), 200),
              v_ref, now() + interval '4 hours', now() + interval '24 hours');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function private.purge_cron_history()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint := 0;
  v_batch bigint;
  i integer;
begin
  perform private.record_cron_failures();
  for i in 1..8 loop
    with keep as (
      select max(runid) filter (where status = 'succeeded') as last_ok, max(runid) as last_any
        from cron.job_run_details group by jobid
    )
    delete from cron.job_run_details
     where runid in (
       select d.runid from cron.job_run_details d
        where ((d.status = 'succeeded' and d.start_time < now() - interval '1 day'
                and d.runid not in (select last_ok from keep where last_ok is not null)
                and d.runid not in (select last_any from keep))
            or (d.status = 'failed' and d.start_time < now() - interval '30 days'))
        limit 50000);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < 50000;
  end loop;
  return v_total;
end $$;

revoke all on function private.record_cron_failures() from public, anon, authenticated;
revoke all on function private.purge_cron_history() from public, anon, authenticated;

-- hourly instead of daily at 02:15 (same name, so cron.schedule replaces the existing job)
select cron.schedule('purge-cron-history', '15 * * * *', 'select private.purge_cron_history()');

do $$
begin
  if (select schedule from cron.job where jobname = 'purge-cron-history') is distinct from '15 * * * *' then
    raise exception 'purge-cron-history is not scheduled hourly';
  end if;
  if has_function_privilege('anon', 'private.purge_cron_history()', 'EXECUTE') or has_function_privilege('anon', 'private.record_cron_failures()', 'EXECUTE') then
    raise exception 'anon can execute a cron history function';
  end if;
end $$;
