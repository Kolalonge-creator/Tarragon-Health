-- Tarragon Health — Super-Admin RBAC: permissions, custom roles, per-user grants
--
-- ADDITIVE layer over the existing role model. The single `profiles.role` enum
-- keeps driving every existing RLS policy and dashboard route unchanged;
-- `admin` remains the cross-org super-admin (private.is_admin()). This migration
-- adds fine-grained capability grants ON TOP so the super admin can delegate a
-- single specific power (e.g. "add pharmacies") to one member/partner without
-- handing them a whole role, and can define named custom roles = bundles of
-- capabilities. `admin` implicitly holds every capability.
--
-- Nothing here removes or narrows an existing grant — it only ever widens.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Permission catalogue (global, static). One row per capability key.
-- ---------------------------------------------------------------------------
create table if not exists public.permissions (
  key         text primary key,
  label       text not null,
  category    text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Custom roles = named permission bundles. `base_role` is the existing
--    account role used ONLY for dashboard routing / RLS — not a new enum value.
-- ---------------------------------------------------------------------------
create table if not exists public.custom_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  base_role   public.user_role not null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger custom_roles_set_updated_at
  before update on public.custom_roles
  for each row execute function private.set_updated_at();

create table if not exists public.role_permissions (
  custom_role_id  uuid not null references public.custom_roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (custom_role_id, permission_key)
);

-- Assign a custom role to a member (grants that bundle on top of the base role).
alter table public.profiles
  add column if not exists custom_role_id uuid references public.custom_roles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Per-user additive permission grants (individual overrides).
--    revoked_at null = active. One active grant per (profile, permission).
-- ---------------------------------------------------------------------------
create table if not exists public.user_permission_grants (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  granted_by      uuid references public.profiles (id) on delete set null,
  granted_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles (id) on delete set null
);

create unique index if not exists user_permission_grants_active_uniq
  on public.user_permission_grants (profile_id, permission_key)
  where revoked_at is null;

create index if not exists user_permission_grants_profile_idx
  on public.user_permission_grants (profile_id);

-- ---------------------------------------------------------------------------
-- 4. Core authorization helper — the ONE predicate reused everywhere.
--    security definer so it bypasses RLS (no recursion with the grants table's
--    own policies) and reads role/grants straight from base tables.
-- ---------------------------------------------------------------------------
create or replace function private.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- super admin ⇒ holds every capability
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
  -- direct per-user grant (active)
  or exists (
    select 1 from public.user_permission_grants g
    where g.profile_id = (select auth.uid())
      and g.permission_key = perm
      and g.revoked_at is null
  )
  -- inherited from the caller's assigned custom role bundle
  or exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.custom_role_id = p.custom_role_id
    where p.id = (select auth.uid())
      and rp.permission_key = perm
  );
$$;

-- Convenience audit writer for admin/RBAC server actions. Uses the immutable
-- public.audit_log; organisation_id may be null for a cross-org super admin.
create or replace function private.log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_event       jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    private.current_org_id(),
    (select auth.uid()),
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_event, '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS — every new table. Reads are broad (catalogue + role names are not
--    sensitive and the members UI renders them); writes are gated by
--    has_permission so the super admin (and only explicitly-delegated members)
--    can mutate. Direct client writes stay under RLS — no service-role needed.
-- ---------------------------------------------------------------------------
alter table public.permissions            enable row level security;
alter table public.custom_roles           enable row level security;
alter table public.role_permissions       enable row level security;
alter table public.user_permission_grants enable row level security;

-- permissions: everyone authenticated may read the catalogue; only super admin writes.
create policy permissions_select on public.permissions
  for select to authenticated using (true);
create policy permissions_write on public.permissions
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- custom_roles: authenticated read (names shown in member UI); manage gated.
create policy custom_roles_select on public.custom_roles
  for select to authenticated using (true);
create policy custom_roles_insert on public.custom_roles
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('roles.manage'));
create policy custom_roles_update on public.custom_roles
  for update to authenticated
  using (private.is_admin() or private.has_permission('roles.manage'))
  with check (private.is_admin() or private.has_permission('roles.manage'));
create policy custom_roles_delete on public.custom_roles
  for delete to authenticated
  using (private.is_admin() or private.has_permission('roles.manage'));

-- role_permissions: same read/manage model as custom_roles.
create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);
create policy role_permissions_write on public.role_permissions
  for all to authenticated
  using (private.is_admin() or private.has_permission('roles.manage'))
  with check (private.is_admin() or private.has_permission('roles.manage'));

-- user_permission_grants: a member sees their own grants; managing them is gated.
create policy user_permission_grants_select on public.user_permission_grants
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_admin()
    or private.has_permission('users.permissions.grant')
  );
create policy user_permission_grants_write on public.user_permission_grants
  for all to authenticated
  using (private.is_admin() or private.has_permission('users.permissions.grant'))
  with check (private.is_admin() or private.has_permission('users.permissions.grant'));

grant select, insert, update, delete on public.permissions            to authenticated;
grant select, insert, update, delete on public.custom_roles           to authenticated;
grant select, insert, update, delete on public.role_permissions       to authenticated;
grant select, insert, update, delete on public.user_permission_grants to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed the capability catalogue. Idempotent (on conflict do nothing).
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  -- Partner management (delegable "add labs / pharmacies / hospitals / …")
  ('partners.labs.manage',        'Manage labs',                'Partners',  'Add and edit lab providers'),
  ('partners.pharmacies.manage',  'Manage pharmacies',          'Partners',  'Add and edit pharmacy partners'),
  ('partners.facilities.manage',  'Manage facilities/hospitals','Partners',  'Add and edit facilities, hospitals and clinics'),
  ('partners.specialists.manage', 'Manage specialists',         'Partners',  'Add and edit specialist providers'),
  ('partners.home_visit.manage',  'Manage home-visit providers','Partners',  'Add and edit home sample-collection providers'),
  ('partners.logistics.manage',   'Manage logistics partners',  'Partners',  'Add and edit courier/delivery partners'),
  -- Tenants / organisations
  ('orgs.hmo.manage',             'Manage HMOs',                'Tenants',   'Create and edit HMO organisations'),
  ('orgs.corporate.manage',       'Manage employers',           'Tenants',   'Create and edit employer/corporate organisations'),
  ('orgs.manage',                 'Manage organisations',       'Tenants',   'Create and edit any organisation'),
  -- User administration
  ('users.provision',             'Provision logins',           'Users',     'Create member and partner login accounts'),
  ('users.roles.assign',          'Assign roles',               'Users',     'Change a member''s account role or custom role'),
  ('users.permissions.grant',     'Grant permissions',          'Users',     'Grant or revoke individual permissions'),
  ('roles.manage',                'Manage custom roles',        'Users',     'Create and edit custom roles (permission bundles)'),
  -- Clinical / operational settings
  ('clinical_staff.manage',       'Manage clinical staff',      'Clinical',  'Add and verify clinical staff records'),
  ('protocols.manage',            'Manage protocols',           'Clinical',  'Manage clinical protocol versions'),
  ('service_regions.manage',      'Manage service regions',     'Operations','Toggle state-level service availability'),
  ('subscriptions.manage',        'Manage subscriptions',       'Operations','Manage subscription plans and add-ons'),
  ('commissions.view',            'View commissions',           'Operations','View the partner commission ledger'),
  ('broadcasts.send',             'Send broadcasts',            'Operations','Send announcements to targeted audiences'),
  ('conditions.manage',           'Manage conditions',          'Operations','Manage chronic-condition programmes'),
  ('health_education.manage',     'Manage health education',    'Operations','Publish and hide health-education content'),
  ('logistics.orders.manage',     'Manage logistics orders',    'Operations','Assign couriers and mark orders delivered'),
  -- Analytics / oversight
  ('analytics.view',              'View platform analytics',    'Analytics', 'Access the company-wide analytics console'),
  ('members.activity.view',       'View member activity',       'Analytics', 'View other members'' activity and read-only dashboards')
on conflict (key) do nothing;
