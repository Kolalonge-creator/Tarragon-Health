-- Sweeper heartbeats for the external dead-man's switch (follow-up to OQ-436).
--
-- Problem. public.deadman_status() watches the event pipeline (process-events heartbeat, due deliveries, dead letters, open sev1/sev2
-- incidents). It cannot see the pg_cron sweepers that page a clinician for a red event or re-grade a reading: if `sweep-pages` or
-- `triage-recheck-sweep` stops running (job unscheduled, pg_cron stuck, the function raising on every run), nothing outside the
-- database notices, and the failure looks like "no red events", which is the worst way for it to look.
--
-- What this adds. Three counts and one list of job names in the same jsonb, for an allow-list of safety sweepers:
--   * stale_critical_cron_jobs   an active listed job whose newest run is older than its own max_silence_minutes,
--   * failing_critical_cron_jobs an active listed job whose newest run failed,
--   * missing_critical_cron_jobs a listed job with no active cron.job (renamed, unscheduled or never created),
--   * critical_cron_job_problems the names behind the three counts (job names only, no patient or staff data).
-- Thresholds for turning the counts into ok / degraded / down stay in versioned configuration (ops.deadman_thresholds v2); this
-- function decides nothing, same as before.
--
-- Disk IO. cron.job_run_details is large, has only its primary key and belongs to supabase_admin (see
-- 20261019172300_cron_log_io_budget...). So this NEVER filters that table by jobid or time. It reads only the newest 6000 run ids by
-- primary key range (about three hours of runs at the measured rate), then works on that slice. A job is called stale only when the
-- slice really covers its silence period (the oldest run in the slice is older than the job's max_silence); if a burst of runs
-- shortens the slice below that, the job is not counted, because "unknown" must not page anyone. The daily job
-- (triage-coverage-daily) is deliberately NOT listed: a daily job cannot be judged from a three-hour slice, and ops_check_stale_cron
-- (72 hour lookback) already covers it.
--
-- Convention note: critical_cron_jobs has no organisation_id on purpose. It is platform configuration naming scheduler jobs (like
-- public.automations), holds no tenant or patient data, and is readable only by service_role. Before applying, check list_migrations
-- on the live project for anything recent that this session does not recognise (CLAUDE.md), because CI does not push migrations.
--
-- Additive: one new table (RLS on, no policy, service_role and the definer function only) and one replaced function with the same
-- signature and the same four original keys. ROLLBACK: restore the OQ-436 body of public.deadman_status(integer); drop table
-- public.critical_cron_jobs.
--
-- Ship order: the route parses the new keys as optional (absent = 0), so the app can deploy before or after this migration.

create table public.critical_cron_jobs (
  job_name text primary key check (job_name = btrim(job_name) and job_name <> ''),
  max_silence_minutes integer not null check (max_silence_minutes between 2 and 170),
  why text not null,
  created_at timestamptz not null default now()
);
alter table public.critical_cron_jobs enable row level security;
revoke all on public.critical_cron_jobs from public, anon, authenticated;
grant select on public.critical_cron_jobs to service_role;
comment on table public.critical_cron_jobs is
  'Allow-list of pg_cron safety sweepers watched by public.deadman_status(). max_silence_minutes is PROPOSED by engineering (about two to four times the schedule) and is confirmed by the founder. 170 is the ceiling because the check only reads the newest 6000 run rows.';

insert into public.critical_cron_jobs (job_name, max_silence_minutes, why) values
  ('sweep-pages',                  10, 'every 15 seconds: re-pages an unacknowledged red event'),
  ('sweep-page-followups',         10, 'every 15 seconds: follow-up of an open page'),
  ('sweep-unpaged-red-events',     10, 'every 15 seconds: a red event that never produced a page'),
  ('sweep-unconfirmed-red-alerts', 20, 'every 5 minutes: red alerts nobody has confirmed'),
  ('sweep-free-red-events',        20, 'every 5 minutes: red events on the Free plan'),
  ('paging-health',                10, 'every minute: the paging engine health sweep'),
  ('queue-watchdog',               20, 'every 5 minutes: clinical queue backlog watchdog'),
  ('triage-recheck-sweep',         10, 'every minute: grades a first elevated reading whose repeat never came'),
  ('triage-recheck-backup-push',   10, 'every minute: the backup reminder to measure again'),
  ('triage-vitals-sweep',          40, 'every 10 minutes: vitals readings that missed the event bus'),
  ('triage-glucose-sweep',         40, 'every 10 minutes: glucose readings that missed the event bus')
on conflict (job_name) do nothing;

create or replace function public.deadman_status(p_due_older_than_seconds integer default 300)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_slice_from bigint;
  v_stale text[];
  v_failing text[];
  v_missing text[];
begin
  v_base := jsonb_build_object(
    'generated_at', now(),
    'process_events_heartbeat_age_seconds',
      (select floor(extract(epoch from (now() - h.last_seen_at)))::bigint
         from public.paging_heartbeats h where h.component = 'process_events'),
    'due_unclaimed_deliveries',
      (select count(*) from public.domain_event_deliveries d
        where d.status = 'pending'
          and d.next_attempt_at < now() - make_interval(secs => greatest(coalesce(p_due_older_than_seconds, 300), 0))),
    'dead_letter_deliveries',
      (select count(*) from public.domain_event_deliveries d where d.status = 'dead' and d.updated_at > now() - interval '24 hours'),
    'open_sev1_sev2_incidents',
      (select count(*) from public.ops_incidents i
        where i.severity in ('sev1', 'sev2') and i.status not in ('resolved', 'closed'))
  );

  -- Primary-key range only (see header). A null max means the log is empty: nothing can be judged stale.
  select max(d.runid) - 6000 into v_slice_from from cron.job_run_details d;

  with slice as (
    select d.jobid, d.runid, d.status, coalesce(d.start_time, now()) as started
      from cron.job_run_details d
     where v_slice_from is not null and d.runid > v_slice_from
  ),
  covered as (select min(started) as oldest from slice),
  newest as (
    select distinct on (s.jobid) s.jobid, s.status, s.started from slice s order by s.jobid, s.runid desc
  ),
  judged as (
    select c.job_name, j.jobid is not null as has_job, n.started, n.status,
           (select oldest from covered) as oldest
      from public.critical_cron_jobs c
      left join cron.job j on j.jobname = c.job_name and j.active
      left join newest n on n.jobid = j.jobid
  )
  select
    coalesce(array_agg(job_name order by job_name) filter (
      where has_job and oldest is not null and oldest < now() - make_interval(mins => cc.max_silence_minutes)
        and (started is null or started < now() - make_interval(mins => cc.max_silence_minutes))), '{}'),
    coalesce(array_agg(job_name order by job_name) filter (where has_job and status = 'failed'), '{}'),
    coalesce(array_agg(job_name order by job_name) filter (where not has_job), '{}')
  into v_stale, v_failing, v_missing
  from judged jd join public.critical_cron_jobs cc using (job_name);

  return v_base || jsonb_build_object(
    'stale_critical_cron_jobs', coalesce(array_length(v_stale, 1), 0),
    'failing_critical_cron_jobs', coalesce(array_length(v_failing, 1), 0),
    'missing_critical_cron_jobs', coalesce(array_length(v_missing, 1), 0),
    'critical_cron_job_problems', jsonb_build_object(
      'stale', to_jsonb(v_stale), 'failing', to_jsonb(v_failing), 'missing', to_jsonb(v_missing)));
end;
$$;

revoke all on function public.deadman_status(integer) from public, anon, authenticated;
grant execute on function public.deadman_status(integer) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.deadman_status(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.deadman_status(integer)', 'EXECUTE') then
    raise exception 'deadman_status is callable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.deadman_status(integer)', 'EXECUTE') then
    raise exception 'service_role cannot call deadman_status';
  end if;
  if has_table_privilege('anon', 'public.critical_cron_jobs', 'SELECT') or has_table_privilege('authenticated', 'public.critical_cron_jobs', 'SELECT') then
    raise exception 'critical_cron_jobs is readable by a client role';
  end if;
  if (select count(*) from public.critical_cron_jobs) < 11 then
    raise exception 'critical_cron_jobs was not seeded';
  end if;
end $$;
