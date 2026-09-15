-- Tarragon Health — backfill migration records for health-education schema
-- objects that exist live but were never captured in a committed migration.
--
-- Found while babysitting PR #281 (unrelated lifestyle-tracking work): the
-- "Supabase migration replay" CI check failed with `type
-- public.health_education_reading_level does not exist` while applying
-- 20260830020209_health_education_feed_language_age_literacy.sql. That
-- migration's own header already documented the cause — it was written
-- against live function bodies (`health_education_feed()`/`_library()`/
-- `_programme_detail()`) whose `reading_level`/`audio_url` columns, the
-- `health_education_reading_level` enum, and the
-- `health_education_programmes`/`health_education_programme_modules`
-- tables were applied directly to the shared remote project by a
-- concurrent session and never committed as a migration — exactly the
-- "live schema object with no migration record at all" failure mode
-- documented in CLAUDE.md. This migration recreates exactly those
-- objects, verified column-for-column, constraint-for-constraint, and
-- policy-for-policy against the live project's pg_catalog/
-- information_schema immediately before writing this file, so a fresh
-- `supabase db reset` (and CI's migration replay) reaches the same schema
-- state production already has. Every statement is guarded so it also
-- no-ops cleanly when applied to the live project, where these objects
-- already exist.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'health_education_reading_level') then
    create type public.health_education_reading_level as enum ('simple', 'detailed', 'clinician');
  end if;
end
$$;

alter table public.health_education_content
  add column if not exists audio_url text,
  add column if not exists reading_level public.health_education_reading_level not null default 'simple';

create table if not exists public.health_education_programmes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  condition public.care_plan_condition,
  category public.health_education_category,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.health_education_programme_modules (
  id uuid primary key default gen_random_uuid(),
  programme_id uuid not null references public.health_education_programmes(id) on delete cascade,
  content_id uuid not null references public.health_education_content(id) on delete restrict,
  module_number integer not null check (module_number > 0),
  title text not null,
  created_at timestamptz not null default now(),
  unique (programme_id, module_number)
);

create index if not exists health_education_programme_modules_content_idx
  on public.health_education_programme_modules (content_id);

alter table public.health_education_programmes enable row level security;
alter table public.health_education_programme_modules enable row level security;

grant select, insert, update, delete on public.health_education_programmes to authenticated;
grant select, insert, update, delete on public.health_education_programme_modules to authenticated;

drop policy if exists health_education_programmes_select on public.health_education_programmes;
create policy health_education_programmes_select on public.health_education_programmes
  for select to authenticated
  using (is_active or private.is_admin());

drop policy if exists health_education_programmes_write on public.health_education_programmes;
create policy health_education_programmes_write on public.health_education_programmes
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists health_education_programme_modules_select on public.health_education_programme_modules;
create policy health_education_programme_modules_select on public.health_education_programme_modules
  for select to authenticated
  using (
    private.is_admin()
    or exists (
      select 1 from public.health_education_programmes p
      where p.id = health_education_programme_modules.programme_id and p.is_active
    )
  );

drop policy if exists health_education_programme_modules_write on public.health_education_programme_modules;
create policy health_education_programme_modules_write on public.health_education_programme_modules
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop trigger if exists health_education_programmes_set_updated_at on public.health_education_programmes;
create trigger health_education_programmes_set_updated_at
  before update on public.health_education_programmes
  for each row execute function private.set_updated_at();
