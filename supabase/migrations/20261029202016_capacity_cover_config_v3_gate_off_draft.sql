-- Capacity and cover configuration v3 (DRAFT): v2 with the intake gate NOT enforced.
--
-- WHY. v2 switches three things on at once: the intake gate (gate_enforce), the 11 hour hard rest rule (hard_rest_enforce) and fire drills
-- (drill_enabled). The gate cannot be signed until the on_call_cover_ok guard is on, and that guard cannot be switched on until the ops desk has a
-- primary and a deputy and a fresh resilience checklist (migration 20261020173800, signed config checklist_gates_readiness = 1). None of that
-- exists yet, so v2 cannot be signed. v3 lets the CMO sign the rest rule and the drill rules now, with sales left open, and move to an enforcing
-- version later from the same sign-off hub.
--
-- WHAT DIFFERS FROM v2. One value: gate_enforce 1 -> 0. Every other number is identical (the mirror test in packages/shared pins this).
--
-- Counted first (live, read only, 2026-10-29): capacity_cover_config has version 1 (active, unsigned, all three switches off) and version 2
-- (inactive, unsigned). This adds version 3 as an INACTIVE, UNSIGNED draft; nothing is activated and no existing row is touched. The next version
-- number is taken from the table, never typed.
--
-- What signing v3 would do, so the reader knows: it retires v1 (the version in force), turns on the 11 hour hard rest rule (a rota change or swap that
-- leaves under 11 hours of rest then needs the CMO's written override) and the monthly fire drills, and leaves new care pack sales open.
-- capacity-cover-rules-v3-begin
with seed(r) as (select $json$
{
  "gate_enforce": 0,
  "min_lead_headroom": 3,
  "rota_horizon_hours": 72,
  "rota_gap_tolerance_hours": 0,
  "oldest_task_max_class": 5,
  "override_max_hours": 24,
  "override_reason_min_chars": 20,
  "reason_min_chars": 20,
  "surge_max_hours": 12,
  "surge_widen_min_class": 4,
  "surge_routine_window_multiplier": 2,
  "pause_max_hours": 24,
  "pause_confirm_minutes": 240,
  "pause_hold_min_class": 6,
  "hard_rest_enforce": 1,
  "rest_hours": 11,
  "overnight_start_hour": 22,
  "overnight_end_hour": 7,
  "rest_min_overnight_pages": 1,
  "rest_override_max_days": 3,
  "cover_offer_pages": 2,
  "cover_offer_lookahead_hours": 36,
  "drill_enabled": 1,
  "drill_interval_days": 30,
  "drill_roster_lookahead_days": 30,
  "drill_min_gap_minutes": 10,
  "drill_busy_hours": 6,
  "drill_ack_target_seconds": 300,
  "drill_ack_target_pct": 90,
  "drill_missed_after_minutes": 60,
  "drill_hour_start": 8,
  "drill_hour_end": 20,
  "drill_max_per_run": 2
}
$json$::jsonb)
insert into public.capacity_cover_config (version, is_active, effective_from, rules)
select (select max(version) + 1 from public.capacity_cover_config), false, current_date, seed.r from seed
where not exists (select 1 from public.capacity_cover_config c where c.rules = seed.r);
-- capacity-cover-rules-v3-end

do $$
declare v3 public.capacity_cover_config%rowtype; v2 public.capacity_cover_config%rowtype;
begin
  select * into v3 from public.capacity_cover_config where rules ->> 'gate_enforce' = '0' and rules ->> 'hard_rest_enforce' = '1' and rules ->> 'drill_enabled' = '1' order by version desc limit 1;
  select * into v2 from public.capacity_cover_config where version = 2;
  if v3.id is null then raise exception 'capacity v3 draft was not created'; end if;
  if v3.is_active or v3.approved_at is not null then raise exception 'capacity v3 must be an inactive, unsigned draft'; end if;
  if (v3.rules - 'gate_enforce') is distinct from (v2.rules - 'gate_enforce') then raise exception 'capacity v3 differs from v2 in more than gate_enforce'; end if;
end $$;
