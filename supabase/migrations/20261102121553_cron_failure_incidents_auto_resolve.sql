-- ===========================================================================
-- Scheduled-job-failed incidents resolve themselves once the job runs clean again.
--
-- WHAT WAS WRONG
--   private.record_cron_failures() (every 10 minutes) opens one ops incident per failing job per hour
--   (external_reference 'cron-failure:<job>:<YYYYMMDDHH24>') and never closes it. Nothing else does either, so
--   on 2026-11-02 the ops desk carried 523 open sev3 "Scheduled job failed" incidents, every one for a job that has
--   had zero failures in the last seven days (most from a single pg_cron outage on 2026-10-19). A desk with 500
--   stale rows hides the real ones; the dead-man's switch and the ops dashboard both read open incidents.
--
-- FIX
--   private.resolve_recovered_cron_failure_incidents(): an open cron-failure incident is resolved when its job has
--   had NO failed run inside the current 45-minute window AND at least one successful run after the incident was
--   detected (or the job no longer exists, so it can never fail again). The resolution is written on the row
--   (root_cause, corrective_action) and the status-change trigger logs it in ops_incident_updates. Called at the
--   end of every record_cron_failures() run, and once here to clear the backlog.
--   An incident whose job is STILL failing stays open and keeps being refreshed, exactly as before.
--
-- record_cron_failures body redefined from the LIVE definition (pg_get_functiondef, 2026-11-02): one line added.
-- ===========================================================================

create or replace function private.resolve_recovered_cron_failure_incidents()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_n integer := 0;
  v_cutoff timestamptz := now() - interval '45 minutes';
  r record;
begin
  for r in
    select i.id, i.detected_at,
           substring(i.external_reference from '^cron-failure:(.*):[0-9]{10}$') as jobname
      from public.ops_incidents i
     where i.external_reference like 'cron-failure:%'
       and i.status not in ('resolved', 'closed')
  loop
    if r.jobname is null then continue; end if;
    -- still failing inside the window: leave it open
    if exists (select 1 from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                where j.jobname = r.jobname and d.status = 'failed' and d.start_time > v_cutoff) then
      continue;
    end if;
    -- recovered: a clean run after the incident, or the job is gone
    if not exists (select 1 from cron.job j where j.jobname = r.jobname)
       or exists (select 1 from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                   where j.jobname = r.jobname and d.status = 'succeeded' and d.start_time > r.detected_at) then
      update public.ops_incidents
         set status = 'resolved',
             root_cause = coalesce(root_cause, 'Transient scheduled-job failure; see the summary for the last error message.'),
             corrective_action = coalesce(corrective_action,
               case when exists (select 1 from cron.job j where j.jobname = r.jobname)
                    then 'Resolved automatically: the job has run successfully since this failure was recorded and has had no failed run in the last 45 minutes.'
                    else 'Resolved automatically: the scheduled job no longer exists, so it cannot fail again.' end),
             updated_at = now()
       where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $function$;
revoke all on function private.resolve_recovered_cron_failure_incidents() from public, anon, authenticated;

create or replace function private.record_cron_failures()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_ref text;
  v_n integer := 0;
  v_sev public.ops_incident_severity;
  v_cutoff timestamptz := now() - interval '45 minutes';
  v_floor bigint;
  v_in_window integer;
begin
  -- runids rise with time, so the newest 20,000 runs on the primary key cover the 45 minute window many times over (~35 runs a minute);
  -- the window edge is the lowest runid among them that is still inside it. Only those rows are aggregated.
  select min(x.runid), count(*) into v_floor, v_in_window
    from (select t.runid, t.start_time from cron.job_run_details t order by t.runid desc limit 20000) x
   where x.start_time > v_cutoff;
  if v_in_window >= 20000 then
    -- the cap itself was reached, so older failures inside the window may not have been read: say so rather than miss them quietly
    v_ref := 'cron-failure-scan-truncated:' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24');
    if not exists (select 1 from public.ops_incidents where external_reference = v_ref) then
      insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values ('technical', 'sev3', 'Scheduled job failure scan hit its row cap',
              'More than 20,000 cron runs in 45 minutes: record_cron_failures() may have missed older failures in the window. Raise the cap in private.record_cron_failures().',
              v_ref, now() + interval '4 hours', now() + interval '24 hours');
    end if;
  end if;
  for r in
    with recent as (
      select d.jobid, d.start_time, d.return_message, d.status
        from cron.job_run_details d
       where d.runid >= coalesce(v_floor, 9223372036854775807)  -- no run inside the window means nothing to report, and nothing to read
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
  -- jobs that have run clean since their incident was opened: close the incident (see resolve_recovered_cron_failure_incidents)
  perform private.resolve_recovered_cron_failure_incidents();
  return v_n;
end $function$;

-- Clear the backlog once, now.
do $$
declare v_n integer;
begin
  v_n := private.resolve_recovered_cron_failure_incidents();
  raise notice 'cron-failure incidents resolved by backfill: %', v_n;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'record_cron_failures') !~ 'resolve_recovered_cron_failure_incidents' then
    raise exception 'FAIL: record_cron_failures does not call the resolver';
  end if;
end $$;
