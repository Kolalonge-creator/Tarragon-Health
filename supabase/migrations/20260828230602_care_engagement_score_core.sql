-- Patient Engagement Engine, step 1: the Care Engagement Score itself.
--
-- Named "care_engagement_*" (not "engagement_*") deliberately: /analytics/engagement
-- already means org-wide DAU/WAU/retention (private.patient_engagement_events(), see
-- 20260820183248_analytics_engagement_real_activity_not_pageviews.sql). This is a
-- different, per-patient concept ("is this one person keeping up with their own care")
-- and needs a name that can't be confused with the product-analytics dashboard.
--
-- Multi-dimensional by design (spec: "do not reduce the patient to a single simplistic
-- score") — composite_score is the average of whichever dimensions are actually
-- applicable to this patient (nulls, e.g. no medications prescribed, are excluded
-- rather than counted against them). Append-only history, same shape as
-- patient_risk_scores: each nightly run inserts a new row, "current" = latest by
-- computed_at. Every dimension is derived from data that already exists elsewhere
-- (vitals_readings, appointments, medication_adherence_checkins/_alerts,
-- screening_schedules/vaccination_schedules, care_plan_goals, care_messages,
-- private.patient_engagement_events()) — no parallel tracking tables.

create type public.care_engagement_level as enum (
  'highly_engaged', 'engaged', 'at_risk', 'disengaged', 'unreachable'
);

create type public.patient_behavioral_segment as enum (
  'highly_motivated', 'needs_reminders', 'low_health_literacy',
  'inconsistent', 'access_constrained', 'digitally_disengaged'
);

create table if not exists public.care_engagement_scores (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  monitoring_adherence_score    numeric(5, 2) check (monitoring_adherence_score between 0 and 100),
  appointment_attendance_score  numeric(5, 2) check (appointment_attendance_score between 0 and 100),
  medication_adherence_score    numeric(5, 2) check (medication_adherence_score between 0 and 100),
  lifestyle_score                numeric(5, 2) check (lifestyle_score between 0 and 100),
  prevention_score               numeric(5, 2) check (prevention_score between 0 and 100),
  app_usage_score                 numeric(5, 2) check (app_usage_score between 0 and 100),
  message_responsiveness_score    numeric(5, 2) check (message_responsiveness_score between 0 and 100),
  care_plan_completion_score      numeric(5, 2) check (care_plan_completion_score between 0 and 100),
  composite_score                 numeric(5, 2) not null check (composite_score between 0 and 100),
  engagement_level                public.care_engagement_level not null,
  segments                        public.patient_behavioral_segment[] not null default '{}',
  -- Per-dimension raw counts/windows the score was derived from, so a clinician or a
  -- future audit can see *why* a number came out the way it did, not just the number
  -- (spec: "identify barrier", not just "compute score").
  inputs                          jsonb not null default '{}'::jsonb,
  computed_at                     timestamptz not null default now(),
  created_at                      timestamptz not null default now()
);

create index if not exists care_engagement_scores_patient_idx
  on public.care_engagement_scores (patient_id, computed_at desc);
create index if not exists care_engagement_scores_org_idx
  on public.care_engagement_scores (organisation_id);

alter table public.care_engagement_scores enable row level security;

drop policy if exists care_engagement_scores_select on public.care_engagement_scores;
create policy care_engagement_scores_select on public.care_engagement_scores
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- System-computed via a security definer function; staff may also insert/update
-- (e.g. a manual recompute or correction), patients never write their own score.
drop policy if exists care_engagement_scores_staff_write on public.care_engagement_scores;
create policy care_engagement_scores_staff_write on public.care_engagement_scores
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_engagement_scores to authenticated;

-- Latest score per patient — what the patient dashboard and the clinician worklist
-- actually read. security_invoker so it rides the base table's RLS rather than
-- introducing its own access rule (same pattern as public.patient_care_gaps).
create or replace view public.patient_current_care_engagement
with (security_invoker = true) as
select distinct on (ces.patient_id) ces.*
from public.care_engagement_scores ces
order by ces.patient_id, ces.computed_at desc;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_engagement_scores'
      and column_name = 'composite_score'
  ) then
    raise exception 'care_engagement_scores.composite_score missing after migration';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_engagement_scores'
      and policyname = 'care_engagement_scores_select'
  ) then
    raise exception 'care_engagement_scores_select policy missing after migration';
  end if;
end $$;
