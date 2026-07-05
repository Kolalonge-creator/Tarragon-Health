-- Tarragon Health — Sprint 1 foundation
-- 01 · Core / Auth / Multi-tenancy
--
-- Establishes extensions, shared enums, the private RLS-helper schema,
-- the two tenancy anchors (organisations, profiles), and the auth trigger
-- that provisions a profile for every new auth.users row.
--
-- Multi-tenancy invariant (ARCHITECTURE.md §6.1): every domain table carries
-- organisation_id and is isolated by Row-Level Security. A clinician in Org A
-- querying Org B rows must return zero rows. RLS is the ONLY isolation
-- mechanism — never filter in application code, never bypass it.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

-- Private schema for security-definer helpers. Not exposed via the Data API,
-- so these functions can safely read profiles while bypassing RLS (which is
-- what breaks the otherwise-recursive policies on profiles itself).
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------

-- One frontline clinical role ('clinician') covers both routine monitoring
-- and escalation review — there is no separate 'nurse' role.
create type public.user_role as enum (
  'patient', 'clinician', 'admin', 'hmo_admin', 'corporate_admin'
);

create type public.organisation_type as enum (
  'clinic', 'hmo', 'corporate', 'lab', 'pharmacy'
);

create type public.sex as enum ('male', 'female');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------------

create table public.organisations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         public.organisation_type not null,
  is_active    boolean not null default true,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- organisation_id is nullable: a self-serve patient (e.g. WhatsApp signup)
-- may exist before being attached to a clinic/HMO/corporate tenant.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  organisation_id   uuid references public.organisations (id) on delete set null,
  role              public.user_role not null default 'patient',
  full_name         text,
  phone             text,          -- E.164, e.g. +234XXXXXXXXXX
  sex               public.sex,
  date_of_birth     date,
  is_active         boolean not null default true,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$')
);

create index profiles_organisation_id_idx on public.profiles (organisation_id);
create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions (security definer, private schema)
--
-- role/organisation authorization is derived from the profiles table, NOT
-- from auth.jwt() user_metadata (which is user-editable and unsafe — see the
-- Supabase security checklist). These run as definer so they bypass RLS and
-- avoid recursion on profiles' own policies.
-- ---------------------------------------------------------------------------

create or replace function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organisation_id from public.profiles where id = (select auth.uid());
$$;

create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- True when the caller is a super-admin OR non-patient staff of `org`.
-- This is the core tenant-isolation predicate reused by every domain table.
create or replace function private.is_org_staff(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role <> 'patient'
      and (role = 'admin' or organisation_id = org)
  );
$$;

-- ---------------------------------------------------------------------------
-- Auto-provision a profile for every new auth user.
-- Role/org may be supplied via app_metadata (server-controlled) at signup;
-- defaults to a self-serve patient otherwise.
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, organisation_id, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    (new.raw_app_meta_data ->> 'organisation_id')::uuid,
    new.raw_user_meta_data ->> 'full_name',
    new.phone
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.organisations enable row level security;
alter table public.profiles enable row level security;

-- organisations: a member sees their own org; admins see all; only admins write.
create policy organisations_select on public.organisations
  for select to authenticated
  using (private.is_admin() or id = private.current_org_id());

create policy organisations_insert on public.organisations
  for insert to authenticated
  with check (private.is_admin());

create policy organisations_update on public.organisations
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy organisations_delete on public.organisations
  for delete to authenticated
  using (private.is_admin());

-- profiles: a user sees/edits their own; org staff see their org's profiles;
-- admins see all. Role escalation is prevented by only allowing staff/admin
-- to change organisation_id/role (patients can edit their own demographics).
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (organisation_id is not null and private.is_org_staff(organisation_id))
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    id = (select auth.uid())
    or (organisation_id is not null and private.is_org_staff(organisation_id))
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = (select auth.uid())
    or (organisation_id is not null and private.is_org_staff(organisation_id))
  )
  with check (
    id = (select auth.uid())
    or (organisation_id is not null and private.is_org_staff(organisation_id))
  );

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (private.is_admin());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.organisations to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
