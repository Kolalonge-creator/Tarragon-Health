-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 03 · profile_access — family/multi-profile login delegation
--
-- Additive to family_plan_members (org/subscription bundling, billing-
-- relevant). This table is login-level delegation: an adult dependent can
-- have their own login while an owner/parent retains view (or manage)
-- access to that profile. Deliberately has no organisation_id — access
-- grants are between individuals regardless of org.

create type public.profile_access_level as enum ('view', 'manage');

create table public.profile_access (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  grantee_user_id   uuid not null references public.profiles (id) on delete cascade,
  permission_level  public.profile_access_level not null default 'view',
  granted_by        uuid not null references public.profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profile_access_no_self_grant check (profile_id <> grantee_user_id),
  unique (profile_id, grantee_user_id)
);

create index profile_access_profile_idx on public.profile_access (profile_id);
create index profile_access_grantee_idx on public.profile_access (grantee_user_id);

create trigger profile_access_set_updated_at
  before update on public.profile_access
  for each row execute function private.set_updated_at();

alter table public.profile_access enable row level security;

-- The owning profile grants/revokes; the grantee can see their own grant;
-- admin sees all.
create policy profile_access_select on public.profile_access
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or grantee_user_id = (select auth.uid())
    or private.is_admin()
  );

create policy profile_access_insert on public.profile_access
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and granted_by = (select auth.uid())
  );

create policy profile_access_update on public.profile_access
  for update to authenticated
  using (profile_id = (select auth.uid()) or private.is_admin())
  with check (profile_id = (select auth.uid()) or private.is_admin());

create policy profile_access_delete on public.profile_access
  for delete to authenticated
  using (profile_id = (select auth.uid()) or private.is_admin());

grant select, insert, update, delete on public.profile_access to authenticated;

-- Companion change: let a grantee resolve the profile they've been granted
-- access to (same narrow-addition pattern as
-- 20260706074302_patient_sees_assigned_clinician_name.sql).
drop policy profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (organisation_id is not null and private.is_org_staff(organisation_id))
    or exists (
      select 1 from public.care_plans cp
      where cp.assigned_clinician_id = profiles.id
        and cp.patient_id = (select auth.uid())
    )
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = profiles.id
        and pa.grantee_user_id = (select auth.uid())
    )
  );
