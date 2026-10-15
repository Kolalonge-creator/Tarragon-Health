-- SR2 (scale-readiness plan, docs/plans/SCALE-READINESS-PLAN.md, Phase 1 item 1).
-- cron.job_run_details was 182 MB of a ~300 MB database (378,273 rows since 2026-07-06, no clean-up), written mostly by the two
-- 15-second sweeps (sweep-pages, process-events) and five every-minute jobs. cron.log_run is a server-wide setting, not per job, and
-- cannot be changed from SQL, so the fix is two jobs, in this order of importance:
--   1. private.record_cron_failures(): a failed cron run opens (or updates) one ops incident per job per hour, BEFORE any history is purged,
--      so history stops being the only trace of a failing sweep. Paging, claim, triage and notification jobs are sev2, the rest sev3.
--      Found live the day this was written: sweep-pages and process-events both failed "job startup timeout" at 2026-10-12 18:30 UTC,
--      i.e. pg_cron could not get a connection (the pooling item in the same phase), and nothing had raised it.
--   2. private.purge_cron_history(): succeeded runs older than 7 days and failed runs older than 30 days are deleted, in batches, daily.
-- Rows touched by this migration: none deleted here; the first purge runs from the schedule. Audit tables are not touched.

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
begin
  for r in
    select coalesce(j.jobname, 'job ' || d.jobid) as jobname, d.jobid, count(*) as failures, max(d.start_time) as last_at,
           max(d.return_message) as msg, to_char(date_trunc('hour', d.start_time), 'YYYYMMDDHH24') as hr
      from cron.job_run_details d
      left join cron.job j on j.jobid = d.jobid
     where d.status = 'failed' and d.start_time > now() - interval '45 minutes'
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
    delete from cron.job_run_details
     where runid in (
       select runid from cron.job_run_details
        where (status = 'succeeded' and start_time < now() - interval '7 days')
           or (status = 'failed' and start_time < now() - interval '30 days')
        limit 50000);
    get diagnostics v_batch = row_count;
    v_total := v_total + v_batch;
    exit when v_batch < 50000;
  end loop;
  return v_total;
end $$;

revoke all on function private.record_cron_failures() from public, anon, authenticated;
revoke all on function private.purge_cron_history() from public, anon, authenticated;

select cron.schedule('record-cron-failures', '*/10 * * * *', 'select private.record_cron_failures()');
select cron.schedule('purge-cron-history', '15 2 * * *', 'select private.purge_cron_history()');

do $$
begin
  if (select count(*) from cron.job where jobname in ('record-cron-failures', 'purge-cron-history')) <> 2 then raise exception 'SR2: both jobs must be scheduled'; end if;
  if has_function_privilege('anon', 'private.purge_cron_history()', 'EXECUTE') or has_function_privilege('authenticated', 'private.purge_cron_history()', 'EXECUTE')
     or has_function_privilege('anon', 'private.record_cron_failures()', 'EXECUTE') or has_function_privilege('authenticated', 'private.record_cron_failures()', 'EXECUTE') then
    raise exception 'SR2: neither function may be executable by anon or authenticated';
  end if;
end $$;
