-- Patient Engagement Engine, step 2: personal health goals + milestones.
--
-- No general-purpose goal/milestone table existed before this (patient_weight_goals,
-- the Lifestyle Programme Engine's own goal fields, and the 90-Day Health Reset's
-- 3-milestone tracker are each single-purpose). This is the general one the spec
-- calls for (§16.10-16.12) — a patient can define a goal, log periodic progress
-- against it, and the platform records discrete milestone achievements.

create type public.patient_goal_type as enum (
  'walk_more', 'reduce_weight', 'improve_bp', 'medication_consistency',
  'complete_screening', 'stop_smoking', 'custom'
);

create type public.patient_goal_status as enum ('active', 'achieved', 'abandoned');

create table if not exists public.patient_goals (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  -- Optional link back into the clinical care plan this goal supports (spec: "Goals
  -- should link to the care plan"). Nullable — a lifestyle goal like "walk more" may
  -- not map to any single condition-specific plan.
  care_plan_id     uuid references public.care_plans (id) on delete set null,
  goal_type        public.patient_goal_type not null,
  description      text not null,
  target_value     numeric(10, 2),
  target_unit      text,
  status           public.patient_goal_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  achieved_at      timestamptz,
  constraint patient_goals_description_length check (char_length(description) between 1 and 300)
);

create index if not exists patient_goals_patient_idx on public.patient_goals (patient_id, status);

create table if not exists public.patient_goal_progress (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  goal_id          uuid not null references public.patient_goals (id) on delete cascade,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  logged_date      date not null,
  value            numeric(10, 2) not null,
  created_at       timestamptz not null default now(),
  unique (goal_id, logged_date)
);

create index if not exists patient_goal_progress_goal_idx
  on public.patient_goal_progress (goal_id, logged_date desc);

-- Kept deliberately small and specific rather than a free-text field, so a milestone
-- always has a well-defined meaning the UI can render copy for. Extend via
-- `alter type ... add value` (see the enum-drift warning in CLAUDE.md) rather than
-- widening this to text.
create type public.patient_milestone_type as enum (
  'monitoring_streak_30d',
  'medication_adherence_90pct_month',
  'preventive_assessment_completed',
  'patient_goal_achieved',
  'engagement_recovery'
);

create table if not exists public.patient_milestones (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  milestone_type   public.patient_milestone_type not null,
  detail           jsonb not null default '{}'::jsonb,
  achieved_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists patient_milestones_patient_idx
  on public.patient_milestones (patient_id, achieved_at desc);

alter table public.patient_goals enable row level security;
alter table public.patient_goal_progress enable row level security;
alter table public.patient_milestones enable row level security;

drop policy if exists patient_goals_select on public.patient_goals;
create policy patient_goals_select on public.patient_goals
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_goals_insert on public.patient_goals;
create policy patient_goals_insert on public.patient_goals
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_goals_update on public.patient_goals;
create policy patient_goals_update on public.patient_goals
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_goals_delete on public.patient_goals;
create policy patient_goals_delete on public.patient_goals
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_goal_progress_select on public.patient_goal_progress;
create policy patient_goal_progress_select on public.patient_goal_progress
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_goal_progress_insert on public.patient_goal_progress;
create policy patient_goal_progress_insert on public.patient_goal_progress
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_goal_progress_update on public.patient_goal_progress;
create policy patient_goal_progress_update on public.patient_goal_progress
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_goal_progress_delete on public.patient_goal_progress;
create policy patient_goal_progress_delete on public.patient_goal_progress
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Milestones are system-recorded achievements, not user data — patients read their
-- own, only staff (or the compute function, which runs as security definer and so
-- bypasses RLS entirely) write.
drop policy if exists patient_milestones_select on public.patient_milestones;
create policy patient_milestones_select on public.patient_milestones
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_milestones_staff_write on public.patient_milestones;
create policy patient_milestones_staff_write on public.patient_milestones
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_goals to authenticated;
grant select, insert, update, delete on public.patient_goal_progress to authenticated;
grant select, insert, update, delete on public.patient_milestones to authenticated;

create or replace function private.touch_patient_goal_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists patient_goals_touch_updated_at on public.patient_goals;
create trigger patient_goals_touch_updated_at
  before update on public.patient_goals
  for each row
  execute function private.touch_patient_goal_updated_at();

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_goals'
  ) then
    raise exception 'patient_goals table missing after migration';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_milestones'
  ) then
    raise exception 'patient_milestones table missing after migration';
  end if;
end $$;
