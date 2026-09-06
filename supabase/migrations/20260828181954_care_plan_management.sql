-- Tarragon Health — care-plan management (Care Team / Provider Workspace
-- §5.14: approve / modify / add goal / remove intervention / change
-- frequency / assign tasks / pause programme / discharge, every
-- modification versioned).
--
-- Confirmed before writing this: care_plans has NO clinician-facing editor
-- at all today. acceptRecommendation (clinician/recommendations/actions.ts)
-- inserts a 'draft' row and nothing else in the app ever writes to
-- care_plans — there is no approve/activate action, no goals/interventions
-- concept, no version history beyond created_at/updated_at, and the status
-- enum has no paused/discharged value. This migration is genuinely new
-- schema, not an extension of a half-built feature.
--
-- "Assign tasks" is deliberately NOT a new table here — care_plan_review_
-- prompts (20260717223000) already is exactly that (a system-raised item
-- requiring clinician attention on a plan), and 20260827203614 just wired it
-- into the clinician notification bell. A second, parallel "care plan task"
-- concept would just be the same idea with a different name.

alter type public.care_plan_status add value if not exists 'paused';
alter type public.care_plan_status add value if not exists 'discharged';

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'care_plan_goal_status') then
    create type public.care_plan_goal_status as enum ('open', 'achieved', 'abandoned');
  end if;
end $$;

create table if not exists public.care_plan_goals (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  care_plan_id    uuid not null references public.care_plans (id) on delete cascade,
  description     text not null,
  status          public.care_plan_goal_status not null default 'open',
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint care_plan_goals_description_length check (char_length(description) between 1 and 300)
);

create index if not exists care_plan_goals_plan_idx on public.care_plan_goals (care_plan_id);

-- ---------------------------------------------------------------------------
-- Interventions
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'care_plan_intervention_status') then
    create type public.care_plan_intervention_status as enum ('active', 'removed');
  end if;
end $$;

create table if not exists public.care_plan_interventions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  care_plan_id    uuid not null references public.care_plans (id) on delete cascade,
  description     text not null,
  -- Free text, matching care_plans.target_ranges' own informal style — a
  -- rigid frequency taxonomy would need a founder-set standard list this
  -- codebase doesn't have yet.
  frequency       text,
  status          public.care_plan_intervention_status not null default 'active',
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  removed_at      timestamptz,
  removed_by      uuid references public.profiles (id) on delete set null,
  constraint care_plan_interventions_description_length check (char_length(description) between 1 and 300),
  constraint care_plan_interventions_frequency_length check (char_length(frequency) <= 100)
);

create index if not exists care_plan_interventions_plan_idx on public.care_plan_interventions (care_plan_id);

-- ---------------------------------------------------------------------------
-- Version history — every modification versioned, per the spec line. Not
-- covered by the generic row-change audit trigger: that logs changed COLUMN
-- NAMES only (by design, to avoid leaking PHI into a more broadly-readable
-- table), never a value snapshot, so it cannot answer "what did this plan
-- look like before" — only "that it changed."
-- ---------------------------------------------------------------------------
create table if not exists public.care_plan_versions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  care_plan_id    uuid not null references public.care_plans (id) on delete cascade,
  version_number  integer not null,
  snapshot        jsonb not null,
  changed_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (care_plan_id, version_number)
);

create index if not exists care_plan_versions_plan_idx on public.care_plan_versions (care_plan_id, version_number desc);

-- The OLD row is snapshotted before a real change lands — same no-op
-- suppression as private.audit_row_change (updated_at-only touches don't
-- count), so opening and saving a form with no edits doesn't manufacture a
-- version. version_number starts at 1 for the first real edit; the
-- as-created row itself is version 0 implicitly (its own fields), not
-- snapshotted separately.
create or replace function private.snapshot_care_plan_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
  v_next    integer;
begin
  v_changed := (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at');
  if not v_changed then
    return new;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.care_plan_versions where care_plan_id = old.id;

  insert into public.care_plan_versions
    (organisation_id, care_plan_id, version_number, snapshot, changed_by)
  values (old.organisation_id, old.id, v_next, to_jsonb(old), (select auth.uid()));

  return new;
end;
$$;

drop trigger if exists care_plans_snapshot_version on public.care_plans;
create trigger care_plans_snapshot_version
  before update on public.care_plans
  for each row execute function private.snapshot_care_plan_version();

-- ---------------------------------------------------------------------------
-- RLS — same three-clause read (own / org staff / consented sponsor) as
-- care_plans itself; writes restricted to org staff, matching how care_plans
-- itself restricts writes (only acceptRecommendation and, from now on, the
-- care-plan management UI ever write to these tables).
-- ---------------------------------------------------------------------------
alter table public.care_plan_goals enable row level security;
alter table public.care_plan_interventions enable row level security;
alter table public.care_plan_versions enable row level security;

drop policy if exists care_plan_goals_select on public.care_plan_goals;
create policy care_plan_goals_select on public.care_plan_goals
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );
drop policy if exists care_plan_goals_write on public.care_plan_goals;
create policy care_plan_goals_write on public.care_plan_goals
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

drop policy if exists care_plan_interventions_select on public.care_plan_interventions;
create policy care_plan_interventions_select on public.care_plan_interventions
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );
drop policy if exists care_plan_interventions_write on public.care_plan_interventions;
create policy care_plan_interventions_write on public.care_plan_interventions
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- Versions are staff/sponsor-readable history, never patient-writable and
-- never staff-writable either — the trigger is the only writer.
drop policy if exists care_plan_versions_select on public.care_plan_versions;
create policy care_plan_versions_select on public.care_plan_versions
  for select to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_plan_goals to authenticated;
grant select, insert, update, delete on public.care_plan_interventions to authenticated;
grant select on public.care_plan_versions to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'care_plan_status' and e.enumlabel = 'paused'
  ) then
    raise exception 'care_plan_status.paused was not added';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'care_plan_status' and e.enumlabel = 'discharged'
  ) then
    raise exception 'care_plan_status.discharged was not added';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'care_plan_goals'
  ) then
    raise exception 'care_plan_goals table was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'care_plan_interventions'
  ) then
    raise exception 'care_plan_interventions table was not created';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'care_plan_versions'
  ) then
    raise exception 'care_plan_versions table was not created';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'care_plans' and tg.tgname = 'care_plans_snapshot_version'
      and not tg.tgisinternal
  ) then
    raise exception 'care_plans_snapshot_version trigger was not created';
  end if;
end $$;
