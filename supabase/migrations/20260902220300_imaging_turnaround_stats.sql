-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 9/9:
-- turnaround tracking (spec §59.14: appointment waiting time, scan
-- completion, report turnaround, clinical acknowledgement).
--
-- All four checkpoints already live directly on imaging_orders (part 3) as
-- plain timestamps stamped once by private.stamp_imaging_order_lifecycle /
-- private.handle_imaging_report_abnormal_pathway and then frozen -- no join
-- to imaging_reports is needed. Mirrors public.lab_provider_turnaround_stats
-- (20260730215234) exactly, including small-cell suppression (n < 5) so a
-- single slow case can't read as a verdict on a provider with barely any
-- volume yet -- there is no imaging-partner self-view RPC (unlike labs'
-- lab_partner_turnaround_stats) because no imaging_partner account role
-- exists yet (see part 1's header).

create or replace function public.imaging_provider_turnaround_stats(p_days integer default 90)
returns table (
  provider_id                       uuid,
  provider_name                     text,
  n                                 integer,
  avg_wait_hours                    numeric,
  avg_scan_completion_hours         numeric,
  avg_report_turnaround_hours       numeric,
  avg_clinical_acknowledgement_hours numeric,
  pct_report_over_72h               numeric,
  suppressed                        boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select
      o.provider_id,
      p.name as provider_name,
      extract(epoch from (o.attended_at - o.booked_at)) / 3600.0 as wait_hours,
      extract(epoch from (o.performed_at - o.attended_at)) / 3600.0 as scan_hours,
      extract(epoch from (o.reported_at - o.performed_at)) / 3600.0 as report_hours,
      extract(epoch from (o.reviewed_at - o.result_returned_at)) / 3600.0 as ack_hours
    from public.imaging_orders o
    join public.imaging_providers p on p.id = o.provider_id
    where o.created_at > now() - (p_days * interval '1 day')
      and o.status <> 'cancelled'
      and (private.is_admin() or private.has_permission('partners.imaging.manage'))
  )
  select
    provider_id,
    provider_name,
    count(*)::int as n,
    round(avg(wait_hours)::numeric, 1) as avg_wait_hours,
    round(avg(scan_hours)::numeric, 1) as avg_scan_completion_hours,
    round(avg(report_hours)::numeric, 1) as avg_report_turnaround_hours,
    round(avg(ack_hours)::numeric, 1) as avg_clinical_acknowledgement_hours,
    round((100.0 * count(*) filter (where report_hours > 72) / nullif(count(report_hours), 0))::numeric, 1) as pct_report_over_72h,
    count(*) < 5 as suppressed
  from base
  group by provider_id, provider_name;
$$;

comment on function public.imaging_provider_turnaround_stats(integer) is
  'Admin/partners.imaging.manage-only aggregate turnaround view, mirroring public.lab_provider_turnaround_stats. suppressed=true (n<5) means the small sample is hidden from cross-provider comparison, same posture as the lab equivalent.';

revoke all on function public.imaging_provider_turnaround_stats(integer) from public, anon;
grant execute on function public.imaging_provider_turnaround_stats(integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.imaging_provider_turnaround_stats(integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute imaging_provider_turnaround_stats';
  end if;
  raise notice 'PASS: imaging_provider_turnaround_stats in place';
end $$;
