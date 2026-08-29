-- Laboratory Network, part 10: the laboratory dashboard (§56.13) —
-- Orders today / Samples received / Processing / Completed / Rejected /
-- Delayed, scoped to the calling lab_partner's own provider exactly the way
-- lab_partner_orders/lab_partner_turnaround_stats already are.
--
-- "Today" is Lagos calendar time throughout (platform convention — every
-- timezone-sensitive read on this platform is Africa/Lagos, see
-- lib/ai-coach/lagos-day.ts's startOfLagosDayUtc for the TS-side
-- equivalent). Processing and Delayed are current-state counts, not
-- "today" counts — a specimen stuck in processing or a still-open delay
-- alert from yesterday is exactly as actionable today as one from this
-- morning, and scoping those two to "today" would hide a backlog rather
-- than surface it.

create or replace function public.lab_partner_dashboard_stats()
returns table (
  orders_today            bigint,
  samples_received_today  bigint,
  samples_processing      bigint,
  samples_completed_today bigint,
  samples_rejected_today  bigint,
  samples_delayed         bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.lab_orders o
      where o.provider_id = private.lab_partner_provider()
        and (o.ordered_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date),
    (select count(*) from public.lab_specimens s
      where s.provider_id = private.lab_partner_provider()
        and s.received_at is not null
        and (s.received_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date),
    (select count(*) from public.lab_specimens s
      where s.provider_id = private.lab_partner_provider() and s.status = 'processing'),
    (select count(*) from public.lab_specimens s
      where s.provider_id = private.lab_partner_provider()
        and s.completed_at is not null
        and (s.completed_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date),
    (select count(*) from public.lab_specimens s
      where s.provider_id = private.lab_partner_provider()
        and s.rejected_at is not null
        and (s.rejected_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date),
    (select count(*) from public.lab_turnaround_alerts a
      where a.provider_id = private.lab_partner_provider() and a.acknowledged_at is null)
  where private.lab_partner_provider() is not null;
$$;

comment on function public.lab_partner_dashboard_stats() is
  '§56.13 — returns zero rows for a non-lab_partner caller (private.lab_partner_provider() is null), same "empty rather than an error" shape as lab_partner_orders/lab_partner_turnaround_stats.';

revoke all on function public.lab_partner_dashboard_stats() from public, anon;
grant execute on function public.lab_partner_dashboard_stats() to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'lab_partner_dashboard_stats' and pronamespace = 'public'::regnamespace) then
    raise exception 'lab_partner_dashboard_stats was not created';
  end if;
  if has_function_privilege('anon', 'public.lab_partner_dashboard_stats()', 'EXECUTE') then
    raise exception 'anon must not be able to execute lab_partner_dashboard_stats';
  end if;
  if not has_function_privilege('authenticated', 'public.lab_partner_dashboard_stats()', 'EXECUTE') then
    raise exception 'authenticated should be able to execute lab_partner_dashboard_stats';
  end if;
end $$;
