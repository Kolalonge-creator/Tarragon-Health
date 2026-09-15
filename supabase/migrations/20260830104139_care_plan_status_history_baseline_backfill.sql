-- Tarragon Health — one-time baseline snapshot for care_plan_status_history
-- (follow-up to 20260830103524_care_plan_status_history.sql).
--
-- The trigger only fires on a future insert/update — every care_plan that
-- already existed when that migration landed has zero history rows until
-- its NEXT status change. Left alone, that's not just "missing old data" —
-- it actively undercounts the present: a care_plan created months ago and
-- still 'active' today (the common case, not the edge case) would read as
-- not-active in any "who's active as of date X" reconstruction, right up
-- until its next transition. This is a one-time backfill of exactly one row
-- per existing care_plan, timestamped now() (the true moment we started
-- knowing this, not the plan's original created_at — we have no evidence
-- about whatever status changes happened between then and now, so honesty
-- means not claiming to).

insert into public.care_plan_status_history
  (care_plan_id, patient_id, organisation_id, condition, status, changed_at)
select cp.id, cp.patient_id, cp.organisation_id, cp.condition, cp.status, now()
from public.care_plans cp
where not exists (
  select 1 from public.care_plan_status_history csh where csh.care_plan_id = cp.id
);

do $$
declare
  v_care_plans integer;
  v_history_rows integer;
begin
  select count(*) into v_care_plans from public.care_plans;
  select count(*) into v_history_rows from public.care_plan_status_history;
  if v_history_rows < v_care_plans then
    raise exception 'expected every care_plan (%) to have at least one status_history row, got %', v_care_plans, v_history_rows;
  end if;
  raise notice 'PASS: % care_plans, % status-history rows (baseline backfill complete)', v_care_plans, v_history_rows;
end $$;
