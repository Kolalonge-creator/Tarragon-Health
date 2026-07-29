-- ============================================================================
-- LPE Phase 4 (follow-up) — HMO/employer lifestyle outcomes (spec §13).
-- A security_invoker view over the RLS'd enrollment/review tables: org staff
-- (HMO/employer admins are org staff) see aggregate outcomes for their org.
-- Derived read-model — no new source of truth. Aggregates only; per-member
-- detail stays behind the underlying tables' own RLS.
-- ============================================================================
create or replace view public.lpe_programme_outcomes
with (security_invoker = true) as
select
  e.organisation_id,
  e.condition,
  count(*)                                             as enrolled,
  count(*) filter (where e.status = 'active')          as active,
  count(*) filter (where e.status = 'paused')          as paused,
  count(*) filter (where e.status = 'maintenance')     as maintenance,
  count(*) filter (where e.status = 'completed')       as completed,
  count(*) filter (where e.status = 'disengaged')      as disengaged,
  -- reviews overdue across the org's enrollments for this condition
  (
    select count(*) from public.lpe_reviews r
    join public.lpe_enrollments e2 on e2.id = r.enrollment_id
    where e2.organisation_id = e.organisation_id
      and e2.condition = e.condition
      and r.status = 'pending'
      and r.due_date < current_date
  )                                                    as reviews_overdue
from public.lpe_enrollments e
group by e.organisation_id, e.condition;

grant select on public.lpe_programme_outcomes to authenticated;
