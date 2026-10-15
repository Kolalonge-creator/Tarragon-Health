-- SR1: one read-only snapshot of the operational facts an external uptime monitor needs, for /api/health/deep.
--
-- WHAT IT IS: public.platform_health_snapshot() returns a jsonb of raw measures (counts and "oldest age in minutes") for
--   * database connections used against max_connections and database size,
--   * the clinical task queue (overdue tasks, oldest open task) and unacknowledged red-event pages,
--   * the notification queue (pending backlog, critical notifications nobody has opened),
--   * the event bus (deliveries due but not done),
--   * webhook backlogs (Paystack payment events received but unprocessed, Zoom events, outbound partner events),
--   * cron freshness (every active job that runs at minute granularity and has not succeeded in twice its interval).
-- It decides nothing: the thresholds live in versioned configuration (packages/shared/src/proposed-config, key
-- ops.health_thresholds) and the route turns measures into ok / degraded / down. Rows flagged is_test are excluded.
--
-- WHO MAY CALL IT: service_role only (the Next.js route authenticates the caller by a shared secret first). It reads
-- no patient data: only counts, ages and job names. Revoked from public (the pseudo-role anon inherits from), anon and
-- authenticated.
--
-- CRON NOTE: for jobs that call net.http_post, a 'succeeded' run only means the request was queued, not that the edge
-- function worked. Function-level health is the edge Sentry reporter plus the backlog measures above (a function that
-- silently stops draining shows up as a growing backlog). cron.job_run_details keeps 7 days (SR2a), far longer than
-- twice any minute-granular interval, so freshness is always answerable.
--
-- ROLLBACK: drop function public.platform_health_snapshot();

create or replace function public.platform_health_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conn_used integer;
  v_conn_max integer;
  v_queue jsonb;
  v_notif jsonb;
  v_events jsonb;
  v_hooks jsonb;
  v_cron jsonb;
begin
  select count(*) into v_conn_used from pg_stat_activity where datname = current_database();
  select setting::integer into v_conn_max from pg_settings where name = 'max_connections';

  select jsonb_build_object(
    'open_tasks', count(*) filter (where state in ('offered_to_lead', 'open', 'escalated')),
    'overdue_tasks', count(*) filter (where state in ('offered_to_lead', 'open', 'escalated') and due_at <= now()),
    'oldest_overdue_task_minutes',
      coalesce(floor(extract(epoch from (now() - min(due_at) filter (where state in ('offered_to_lead', 'open', 'escalated') and due_at <= now()))) / 60), 0)::integer,
    'oldest_open_task_minutes',
      coalesce(floor(extract(epoch from (now() - min(created_at) filter (where state in ('offered_to_lead', 'open', 'escalated')))) / 60), 0)::integer
  ) into v_queue
  from public.clinical_tasks where not is_test;

  v_queue := v_queue || (
    select jsonb_build_object(
      'unacknowledged_pages', count(*),
      'oldest_unacknowledged_page_minutes', coalesce(floor(extract(epoch from (now() - min(sent_at))) / 60), 0)::integer)
    from public.pages
    where parent_page_id is null and acknowledged_at is null and closed_at is null and not is_test);

  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'oldest_pending_minutes', coalesce(floor(extract(epoch from (now() - min(created_at) filter (where status = 'pending'))) / 60), 0)::integer,
    'critical_unopened', count(*) filter (where status = 'sent' and priority = 'critical' and opened_at is null),
    'oldest_critical_unopened_minutes',
      coalesce(floor(extract(epoch from (now() - min(sent_at) filter (where status = 'sent' and priority = 'critical' and opened_at is null))) / 60), 0)::integer
  ) into v_notif
  from public.notifications
  where created_at > now() - interval '14 days';

  select jsonb_build_object(
    'due_deliveries', count(*),
    'oldest_due_delivery_minutes', coalesce(floor(extract(epoch from (now() - min(next_attempt_at))) / 60), 0)::integer
  ) into v_events
  from public.domain_event_deliveries where status = 'pending' and next_attempt_at <= now();

  select jsonb_build_object(
    'payments_unprocessed', (select count(*) from public.payment_transactions where processed_at is null and created_at < now() - interval '5 minutes'),
    'oldest_payment_unprocessed_minutes',
      (select coalesce(floor(extract(epoch from (now() - min(created_at))) / 60), 0)::integer from public.payment_transactions where processed_at is null and created_at < now() - interval '5 minutes'),
    'zoom_unprocessed', (select count(*) from public.zoom_webhook_events where processed_at is null and created_at < now() - interval '5 minutes'),
    'oldest_zoom_unprocessed_minutes',
      (select coalesce(floor(extract(epoch from (now() - min(created_at))) / 60), 0)::integer from public.zoom_webhook_events where processed_at is null and created_at < now() - interval '5 minutes'),
    'outbound_due', (select count(*) from public.integration_outbound_events where status = 'pending' and next_attempt_at <= now() - interval '5 minutes'),
    'outbound_dead_letter', (select count(*) from public.integration_outbound_events where status = 'dead_letter')
  ) into v_hooks;

  select jsonb_build_object(
    'jobs_checked', count(*),
    'stale', coalesce(jsonb_agg(jsonb_build_object('job', jobname, 'minutes_since_success', since_ok, 'expected_every_minutes', every_min))
                        filter (where since_ok is null or since_ok > 2 * every_min + 2), '[]'::jsonb),
    'failed_last_hour', coalesce(sum(failed_1h), 0)
  ) into v_cron
  from (
    select j.jobname,
           case when j.schedule = '* * * * *' then 1 else (regexp_match(j.schedule, '^\*/(\d+) \* \* \* \*$'))[1]::integer end as every_min,
           (select floor(extract(epoch from (now() - max(d.end_time))) / 60)::integer
              from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded') as since_ok,
           (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '1 hour') as failed_1h
      from cron.job j
     where j.active and (j.schedule = '* * * * *' or j.schedule ~ '^\*/\d+ \* \* \* \*$')
  ) s;

  return jsonb_build_object(
    'generated_at', now(),
    'database', jsonb_build_object(
      'connections_used', v_conn_used,
      'connections_max', v_conn_max,
      'size_bytes', pg_database_size(current_database())),
    'queue', v_queue,
    'notifications', v_notif,
    'events', v_events,
    'webhooks', v_hooks,
    'cron', v_cron);
end;
$$;

revoke all on function public.platform_health_snapshot() from public, anon, authenticated;
grant execute on function public.platform_health_snapshot() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.platform_health_snapshot()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.platform_health_snapshot()', 'EXECUTE') then
    raise exception 'SR1: platform_health_snapshot is callable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.platform_health_snapshot()', 'EXECUTE') then
    raise exception 'SR1: service_role cannot call platform_health_snapshot';
  end if;
end $$;
