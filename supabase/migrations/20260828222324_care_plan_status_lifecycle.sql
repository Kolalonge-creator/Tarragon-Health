-- Tarragon Health — Care Management Engine, step 1
--
-- care_plans.status only ever modelled draft/active/completed/cancelled — a
-- programme that stops being actively managed had nowhere honest to land.
-- Spec (Care Management Engine §3.19): "A programme should eventually reach
-- ongoing, completed, paused, transferred, declined, discharged. Completed
-- does not necessarily mean cured — it means the programme's defined episode
-- has ended." 'active' already covers 'ongoing'; this adds the four missing
-- terminal/interruption states so a clinician can record what actually
-- happened instead of forcing everything into completed/cancelled.
--
-- STANDALONE migration, matching this codebase's own established discipline
-- (20260716223124_chronic_condition_enum.sql): PostgreSQL will not let a
-- value added by ALTER TYPE ... ADD VALUE be *used* (compared, inserted) in
-- the same transaction it was added in, so nothing downstream that reads
-- these values may live in this same file.
--
--   paused      — care temporarily suspended (e.g. patient request, an
--                  ED/mental-health safety pause on a related programme,
--                  travel) with an intent to resume; not a dropout.
--   transferred — patient's care moved to another provider/facility; the
--                  episode here ends but was not abandoned.
--   declined    — patient explicitly opted out after being offered the plan.
--   discharged  — care team formally closed the episode as no longer needing
--                  active management (distinct from 'completed', which is
--                  used for a plan whose review cycle ran its course).

alter type public.care_plan_status add value if not exists 'paused';
alter type public.care_plan_status add value if not exists 'transferred';
alter type public.care_plan_status add value if not exists 'declined';
alter type public.care_plan_status add value if not exists 'discharged';
