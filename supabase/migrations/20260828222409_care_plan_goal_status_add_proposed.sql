-- Tarragon Health — Care Management Engine, step 1b.
--
-- Adds 'proposed' to the already-live care_plan_goal_status enum
-- (created by 20260827205255_care_plan_management.sql: 'open'/'achieved'/
-- 'abandoned') ahead of the care_plan_goals reconciliation migration that
-- needs to reference it. STANDALONE migration, matching this codebase's
-- own established discipline (20260716223124_chronic_condition_enum.sql
-- and others): PostgreSQL will not let a value added by
-- ALTER TYPE ... ADD VALUE be *used* (compared, inserted, referenced in a
-- policy expression) in the same transaction it was added in, so nothing
-- downstream that reads this value may live in this same file.

alter type public.care_plan_goal_status add value if not exists 'proposed';
