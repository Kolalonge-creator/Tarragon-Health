-- Tarragon Health — care-plan management (Care Team / Provider Workspace
-- §5.14). Committed to git but never actually applied to production —
-- found and fixed alongside my_provider_performance_rpc/note_templates/
-- risk_reassessment_queue. Content below is byte-identical to the
-- committed 20260827205255_care_plan_management.sql.

alter type public.care_plan_status add value if not exists 'paused';
alter type public.care_plan_status add value if not exists 'discharged';

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

drop policy if exists care_plan_versions_select on public.care_plan_versions;
create policy care_plan_versions_select on public.care_plan_versions
  for select to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_plan_goals to authenticated;
grant select, insert, update, delete on public.care_plan_interventions to authenticated;
grant select on public.care_plan_versions to authenticated;

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
