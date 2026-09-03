-- Tarragon Health — Care Management Engine integration follow-up.
--
-- care_plan_goals.care_plan_id is NOT NULL on the live table (inherited
-- from PR #272's original care_plan_management.sql design, where every
-- goal is scoped to a specific condition care plan from the start). This
-- feature's own patient-self-proposal path (§3.16, care_plan_goals_patient_
-- propose_insert) never supplies care_plan_id — a patient proposing a goal
-- ("walk more", "cut down on salt") has not necessarily picked which
-- condition-specific plan it belongs to yet; a clinician links it to one
-- (or leaves it patient-level) when they review the proposal. A fresh
-- TypeScript regeneration against the live schema surfaced this as a real
-- compile failure in apps/web/src/lib/queries/care-plan-goals.ts, which
-- correctly never sets it.
--
-- Loosening NOT NULL -> nullable is backward compatible with every existing
-- caller (nothing that currently always supplies a value stops working);
-- confirmed 0 live rows exist regardless, so there is no data to migrate.

alter table public.care_plan_goals alter column care_plan_id drop not null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_goals'
      and column_name = 'care_plan_id' and is_nullable = 'NO'
  ) then
    raise exception 'care_plan_goals.care_plan_id is still NOT NULL';
  end if;
  raise notice 'PASS: care_plan_goals.care_plan_id is nullable';
end $$;
