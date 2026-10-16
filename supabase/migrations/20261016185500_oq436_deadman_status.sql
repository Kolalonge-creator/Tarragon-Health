-- OQ-436: the read-only status an EXTERNAL dead-man's switch polls.
--
-- Everything that watches process-events (sweep_paging_health, queue_watchdog, the reconciler) runs under the same pg_cron
-- and pg_net as process-events itself, so if that dies nothing notices. public.deadman_status() gives an outside caller
-- (the /api/health/deadman route, called every 5 minutes by a GitHub Actions workflow and optionally a third-party monitor)
-- four facts, as counts and ages only, no patient or staff identifier:
--   * seconds since the process_events heartbeat (null = never recorded),
--   * count of event deliveries due (pending, next_attempt_at older than p_due_older_than_seconds) and not claimed,
--   * count of dead-lettered deliveries,
--   * count of open sev1/sev2 ops incidents (status not resolved or closed).
-- It decides nothing: thresholds are versioned PROPOSED config (ops.deadman_thresholds); the route turns measures into a verdict.
-- Purely additive: one new function. service_role only (revoked from public, the pseudo-role anon inherits through).
-- ROLLBACK: drop function public.deadman_status(integer);

create or replace function public.deadman_status(p_due_older_than_seconds integer default 300)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'process_events_heartbeat_age_seconds',
      (select floor(extract(epoch from (now() - h.last_seen_at)))::bigint
         from public.paging_heartbeats h where h.component = 'process_events'),
    'due_unclaimed_deliveries',
      (select count(*) from public.domain_event_deliveries d
        where d.status = 'pending'
          and d.next_attempt_at < now() - make_interval(secs => greatest(coalesce(p_due_older_than_seconds, 300), 0))),
    'dead_letter_deliveries',
      (select count(*) from public.domain_event_deliveries d where d.status = 'dead'),
    'open_sev1_sev2_incidents',
      (select count(*) from public.ops_incidents i
        where i.severity in ('sev1', 'sev2') and i.status not in ('resolved', 'closed'))
  );
$$;

revoke all on function public.deadman_status(integer) from public, anon, authenticated;
grant execute on function public.deadman_status(integer) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.deadman_status(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.deadman_status(integer)', 'EXECUTE') then
    raise exception 'OQ-436: deadman_status is callable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.deadman_status(integer)', 'EXECUTE') then
    raise exception 'OQ-436: service_role cannot call deadman_status';
  end if;
end $$;
