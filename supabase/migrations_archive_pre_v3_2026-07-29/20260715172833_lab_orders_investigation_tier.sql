-- Tarragon Health
-- investigation_tier tracks which investigations pathway
-- (docs/Tarragon_Health_Master_Operating_Plan_v4.md §6) a lab order came
-- through: 1 = scheduled monitoring (automated, off screening_schedules),
-- 2 = doctor-requested (a Tier 2+ doctor ordered it during review),
-- 3 = patient-initiated wellness testing (Phase 2 — not a real ordering
-- path yet, so no existing row backfills to 3). Field exists from Phase 1
-- so Phase 2's self-order catalogue doesn't need its own migration later
-- (master plan §17).
--
-- Default is 2: today the only two ways a lab_orders row comes into
-- existence are the automated scheduled-monitoring path (which sets
-- screening_schedule_id, backfilled/defaulted to 1 below) or a doctor
-- placing an ad hoc order — there is no ambiguity to preserve by forcing
-- every future insert to specify a tier explicitly, unlike doctor_tier.

alter table public.lab_orders
  add column investigation_tier smallint not null default 2
    check (investigation_tier between 1 and 3);

update public.lab_orders
  set investigation_tier = 1
  where screening_schedule_id is not null;

create index lab_orders_investigation_tier_idx
  on public.lab_orders (organisation_id, investigation_tier);
