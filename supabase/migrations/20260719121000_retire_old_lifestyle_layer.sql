-- ============================================================================
-- Retire the pre-LPE lifestyle coaching layer (PR #65) — superseded by the
-- Lifestyle Programme Engine (lpe_* tables, migration 20260719120000).
--
-- ⚠️ APPLY AT MERGE, NOT MID-BRANCH. The shared remote is used by main-dev and
-- other feature branches that still reference these tables until this branch
-- merges; dropping them early would break those. This file is committed so the
-- drop travels with the branch and runs when the branch lands.
--
-- Safe: pre-launch, no live patient data in these tables.
-- ============================================================================

-- Daily reminder cron jobs (registered by the old migration).
do $$ begin perform cron.unschedule('lifestyle-checkin-reminders-daily'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('lifestyle-review-reminders-daily');  exception when others then null; end $$;

-- Functions (triggers drop with their tables via CASCADE, but drop the
-- standalone cron functions explicitly).
drop function if exists private.queue_lifestyle_checkin_reminders() cascade;
drop function if exists private.queue_lifestyle_review_reminders() cascade;
drop function if exists private.schedule_lifestyle_checkins() cascade;
drop function if exists private.ensure_lifestyle_review() cascade;
drop function if exists private.stamp_lifestyle_review_completion() cascade;
drop function if exists private.roll_lifestyle_review() cascade;

-- Tables (CASCADE drops their triggers, policies, FKs).
drop table if exists public.lifestyle_checkins             cascade;
drop table if exists public.lifestyle_reviews             cascade;
drop table if exists public.lifestyle_programme_enrolments cascade;
drop table if exists public.lifestyle_programmes          cascade;
drop table if exists public.lifestyle_goals               cascade;
drop table if exists public.lifestyle_assessments         cascade;

-- Enums.
drop type if exists public.lifestyle_review_status;
drop type if exists public.lifestyle_checkin_status;
drop type if exists public.lifestyle_enrolment_status;
drop type if exists public.lifestyle_goal_status;
drop type if exists public.lifestyle_programme_domain;
drop type if exists public.lifestyle_domain;

-- NOTE: the `lifestyle_coaching` entitlement feature flag + add-on rows are
-- intentionally KEPT — they gate the new LPE surfaces (re-pointed in Phase 3).
