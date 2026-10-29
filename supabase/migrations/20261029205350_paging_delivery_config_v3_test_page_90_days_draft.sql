-- Paging delivery configuration v3 (DRAFT): v2 with the on-call test page valid for 90 days instead of 7.
--
-- WHY. readiness_test_page_days is how recent an acknowledged test page must be for a clinician to count as on-call ready (the objective readiness check
-- in v2 and the rota door). At 7 days each clinician had to re-prove their route every week. The Chief Medical Officer asked for 90 days (three months)
-- for now, to be adjustable from the CMO dashboard later.
--
-- WHAT DIFFERS FROM v2. One value: readiness_test_page_days 7 -> 90. Every other number is identical (the mirror test in packages/shared pins this).
-- Counted first (live, read only, 2026-10-29): paging_delivery_config has version 1 (inactive, retired by signing v2) and version 2 (active, signed).
--
-- NOT SIGNED. This adds the next version as an INACTIVE, UNSIGNED draft; the CMO activates it (activate_paging_delivery_config). The activation check
-- still runs at that moment. A longer window means a route that stops working can go unnoticed for up to 90 days; the monthly fire drills in the
-- signed capacity config (informational test pages, 90 percent within 5 minutes) are the standing check in between.
-- paging-delivery-rules-v3-begin
with seed(r) as (select $json$
{
  "delivered_ack_seconds": 90,
  "delivered_ack_seconds_unconfirmed_route": 180,
  "reconcile_after_seconds": 60,
  "reconcile_lookback_hours": 4,
  "reconcile_per_pass_max": 20,
  "merge_window_minutes": 30,
  "engine_heartbeat_stale_seconds": 120,
  "device_seen_stale_minutes": 10,
  "device_seen_keep": 20,
  "readiness_test_page_days": 90,
  "test_page_min_interval_seconds": 120,
  "page_notification_stuck_seconds": 120,
  "page_notification_retry_stuck_seconds": 660,
  "first_hop_safe_systolic_min": 100,
  "first_hop_safe_systolic_max": 139,
  "first_hop_safe_diastolic_min": 60,
  "first_hop_safe_diastolic_max": 89,
  "objective_readiness_required": 1
}
$json$::jsonb)
insert into public.paging_delivery_config (version, is_active, effective_from, rules)
select (select max(version) + 1 from public.paging_delivery_config), false, current_date, seed.r from seed
where not exists (select 1 from public.paging_delivery_config c where c.rules = seed.r);
-- paging-delivery-rules-v3-end

do $$
declare v3 public.paging_delivery_config%rowtype; v2 public.paging_delivery_config%rowtype;
begin
  select * into v3 from public.paging_delivery_config where rules ->> 'readiness_test_page_days' = '90' order by version desc limit 1;
  select * into v2 from public.paging_delivery_config where version = 2;
  if v3.id is null then raise exception 'paging delivery v3 draft was not created'; end if;
  if v3.is_active or v3.approved_at is not null then raise exception 'paging delivery v3 must be an inactive, unsigned draft'; end if;
  if (v3.rules - 'readiness_test_page_days') is distinct from (v2.rules - 'readiness_test_page_days') then raise exception 'paging delivery v3 differs from v2 in more than readiness_test_page_days'; end if;
end $$;
