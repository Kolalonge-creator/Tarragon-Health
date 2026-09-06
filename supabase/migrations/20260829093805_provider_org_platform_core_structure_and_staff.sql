-- Tarragon Health — module 28, part 1: the organisation itself.
--
-- Modules 4/5 gave the clinical network a provider DIRECTORY (facilities,
-- lab_providers, pharmacy_partners, specialist_providers — curated, admin-
-- maintained rows Tarragon patients book against) and Tarragon's own
-- clinical workspace (clinical_staff, the doctor-tier ladder). Neither lets
-- a partner organisation log in and run itself. Module 28 is that: a
-- hospital, clinic, diagnostic centre, pharmacy or specialist practice gets
-- its own tenancy (an organisations row of type 'provider_org'), its own
-- structure (locations, departments, staff, services, resources), and its
-- own staff logins — without needing a separate disconnected administrative
-- system for every location (28.13's own acceptance line).
--
-- Deliberately does NOT build: a parallel appointment/booking engine (the
-- one at 20260828000637 already generalised `appointments` into "the
-- universal appointment object" for TARRAGON's own care-team visits — a
-- provider organisation's own operational bookings, for patients who may
-- not even hold a Tarragon account, are a different transaction and mixing
-- them into that table would blur exactly the line I9/is_org_staff exists
-- to hold); the full specialist-matching/referral-ranking engine (an
-- explicit standing guardrail — see CLAUDE.md); or NAFDAC-registered device
-- commerce (a separate, explicitly shelved decision). What IS built:
-- structure, staff, service catalogue, resource/hours configuration, a
-- referral/order QUEUE for work already routed to a claimed directory row
-- (28.8/28.9 — downstream operations, not the matching engine itself), a
-- settlement ledger (28.10) and org-level analytics (28.11/28.12).
--
-- Everything here is gated on private.module_enabled('provider_org_platform'),
-- which ships false, exactly like module 27.

-- ---------------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.provider_org_type as enum (
    'hospital', 'clinic', 'diagnostic_centre', 'pharmacy', 'specialist_practice'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.provider_org_onboarding_status as enum (
    'application', 'verification', 'credentialing', 'configuring', 'active', 'suspended', 'terminated'
  );
exception when duplicate_object then null; end $$;

comment on type public.provider_org_onboarding_status is
  '28.2 onboarding pipeline stage. Distinct from provider_organisations.is_operational, the switch the org''s own RPCs check — an org can sit at any stage and still be non-operational; is_operational only ever turns true once onboarding reaches active AND a superadmin has activated provider_org_platform.';

-- 28.4. A seat only ever holds the powers its job needs — same discipline
-- as the payer_admin_role ladder in module 27 and the clinical doctor-tier
-- ladder: authority is carried by this column, never by account role.
do $$ begin
  create type public.provider_org_role as enum (
    'owner', 'clinical_lead', 'operations_manager', 'finance_manager',
    'hr_admin', 'clinician', 'receptionist'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.provider_org_resource_type as enum ('room', 'equipment');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. provider_organisations — 1:1 extension of an organisations row, same
--    pattern as insurers gained for module 27 except an insurer extends an
--    EXISTING general-purpose table (insurers already existed); a provider
--    organisation needs a brand new tenancy row, so this is the anchor.
-- ---------------------------------------------------------------------------
create table public.provider_organisations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null unique references public.organisations (id) on delete cascade,
  org_type          public.provider_org_type not null,
  legal_name        text not null,
  display_name      text,
  registration_number text,
  onboarding_status public.provider_org_onboarding_status not null default 'application',
  is_operational    boolean not null default false,
  activated_at      timestamptz,
  activated_by      uuid references public.profiles (id) on delete set null,
  min_cohort_size   integer not null default 10,
  contact_email     text,
  contact_phone     text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint provider_organisations_phone_e164
    check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint provider_organisations_min_cohort_size_floor check (min_cohort_size >= 5),
  -- Same invariant as insurers_active_requires_live: operational status can
  -- never race ahead of the onboarding pipeline actually reaching 'active'.
  constraint provider_organisations_operational_requires_active
    check (not is_operational or onboarding_status = 'active')
);

comment on table public.provider_organisations is
  '28.1/28.2. The org-level extension of an organisations row of type provider_org — one row per partner hospital/clinic/diagnostic centre/pharmacy/specialist practice. is_operational is a per-organisation switch layered UNDER the platform-wide provider_org_platform module gate: both must be true for this org''s own staff to reach anything.';

create index provider_organisations_status_idx on public.provider_organisations (onboarding_status);

create trigger provider_organisations_set_updated_at
  before update on public.provider_organisations
  for each row execute function private.set_updated_at();

-- The organisations row itself must actually be typed provider_org — a
-- provider_organisations row hung off a 'clinic'/'hmo'/'direct_consumer' org
-- would let a provider org's staff-scoping predicate reach a Tarragon
-- tenant's other tables through a shared organisation_id.
create or replace function private.provider_organisations_type_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.organisation_type;
begin
  select type into v_type from public.organisations where id = new.organisation_id;
  if v_type is distinct from 'provider_org' then
    raise exception 'organisation % is type % — provider_organisations requires type provider_org', new.organisation_id, v_type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger provider_organisations_type_guard
  before insert or update of organisation_id on public.provider_organisations
  for each row execute function private.provider_organisations_type_guard();

-- ---------------------------------------------------------------------------
-- 3. Staff (28.4) — one generic account role (profiles.role =
--    'provider_org_staff'), authority carried per-seat by org_role. Mirrors
--    payer_administrators' shape and its role guard exactly.
-- ---------------------------------------------------------------------------
create table public.provider_org_members (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  org_role        public.provider_org_role not null default 'receptionist',
  job_title       text,
  is_active       boolean not null default true,
  invited_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organisation_id, profile_id)
);

comment on table public.provider_org_members is
  '28.4. A profile with role=provider_org_staff and no active row here reaches nothing in this org — membership plus org_role is the grant, never the account role or which dashboard exists. A receptionist and a clinical_lead hold the same account role; only this row''s org_role differs.';

create index provider_org_members_profile_idx on public.provider_org_members (profile_id) where is_active;
create index provider_org_members_org_idx on public.provider_org_members (organisation_id) where is_active;

create trigger provider_org_members_set_updated_at
  before update on public.provider_org_members
  for each row execute function private.set_updated_at();

create or replace function private.provider_org_members_role_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = new.profile_id;
  if v_role is null then
    raise exception 'no such profile' using errcode = '23503';
  end if;
  if v_role not in ('provider_org_staff', 'admin') then
    raise exception 'a provider organisation seat needs an account with role provider_org_staff (this one is %)', v_role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger provider_org_members_role_guard
  before insert or update of profile_id on public.provider_org_members
  for each row execute function private.provider_org_members_role_guard();

-- ---------------------------------------------------------------------------
-- 4. Scoping predicates — every provider-org policy/RPC goes through these.
-- ---------------------------------------------------------------------------
create or replace function private.is_provider_org_staff_for(
  p_organisation uuid,
  p_roles public.provider_org_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or (
      private.module_enabled('provider_org_platform')
      and exists (
        select 1
        from public.provider_org_members m
        join public.profiles p on p.id = m.profile_id
        join public.provider_organisations po on po.organisation_id = m.organisation_id
        where m.profile_id = (select auth.uid())
          and m.organisation_id = p_organisation
          and m.is_active
          and p.is_active
          and p.role = 'provider_org_staff'
          and po.is_operational
          and (p_roles is null or m.org_role = 'owner' or m.org_role = any (p_roles))
      )
    );
$$;

comment on function private.is_provider_org_staff_for(uuid, public.provider_org_role[]) is
  'True when the caller may act for this provider organisation. Requires provider_org_platform to be enabled AND this specific org to be is_operational — the platform-wide switch and the per-organisation onboarding gate both have to be on. Superadmin passes unconditionally so an org can be configured before either gate opens.';

revoke all on function private.is_provider_org_staff_for(uuid, public.provider_org_role[]) from public;

alter table public.provider_organisations enable row level security;
alter table public.provider_org_members enable row level security;

create policy provider_organisations_select on public.provider_organisations
  for select to authenticated
  using (private.is_admin() or private.is_provider_org_staff_for(organisation_id));

create policy provider_organisations_manage on public.provider_organisations
  for all to authenticated
  using (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner']::public.provider_org_role[]))
  with check (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner']::public.provider_org_role[]));

grant select, insert, update, delete on public.provider_organisations to authenticated;
revoke all on public.provider_organisations from anon;

create policy provider_org_members_select on public.provider_org_members
  for select to authenticated
  using (
    private.is_admin()
    or profile_id = (select auth.uid())
    or private.is_provider_org_staff_for(organisation_id)
  );

create policy provider_org_members_manage on public.provider_org_members
  for all to authenticated
  using (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner', 'hr_admin']::public.provider_org_role[]))
  with check (private.is_admin() or private.is_provider_org_staff_for(organisation_id, array['owner', 'hr_admin']::public.provider_org_role[]));

grant select, insert, update, delete on public.provider_org_members to authenticated;
revoke all on public.provider_org_members from anon;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org  uuid;
  v_prov uuid;
begin
  if not has_table_privilege('authenticated', 'public.provider_organisations', 'SELECT')
     or not has_table_privilege('authenticated', 'public.provider_org_members', 'SELECT') then
    raise exception 'FAIL: missing authenticated grants on the new provider-org tables';
  end if;
  if has_table_privilege('anon', 'public.provider_organisations', 'SELECT') then
    raise exception 'FAIL: anon can read provider_organisations';
  end if;

  if pg_get_functiondef('private.is_provider_org_staff_for(uuid,public.provider_org_role[])'::regprocedure)
       not like '%module_enabled(''provider_org_platform'')%' then
    raise exception 'FAIL: is_provider_org_staff_for does not gate on the module switch';
  end if;
  if pg_get_functiondef('private.is_provider_org_staff_for(uuid,public.provider_org_role[])'::regprocedure)
       not like '%is_operational%' then
    raise exception 'FAIL: is_provider_org_staff_for does not gate on org-level is_operational';
  end if;

  -- The type guard discriminates: an organisations row of the WRONG type
  -- must be refused, and the right type must be accepted, inside one
  -- rolled-back simulation.
  begin
    insert into public.organisations (name, type) values ('ASSERT Wrong Type Org', 'clinic') returning id into v_org;
    begin
      insert into public.provider_organisations (organisation_id, org_type, legal_name)
      values (v_org, 'clinic', 'Assertion Wrong Type');
      raise exception 'FAIL: provider_organisations accepted an organisation of type clinic';
    exception
      when check_violation then null;
    end;

    insert into public.organisations (name, type) values ('ASSERT Provider Org', 'provider_org') returning id into v_org;
    insert into public.provider_organisations (organisation_id, org_type, legal_name)
    values (v_org, 'hospital', 'Assertion Right Type')
    returning id into v_prov;

    if v_prov is null then
      raise exception 'FAIL: provider_organisations refused a correctly-typed organisation';
    end if;

    raise exception 'ROLLBACK_ASSERTIONS';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_ASSERTIONS' then raise; end if;
  end;

  if exists (select 1 from public.organisations where name like 'ASSERT %') then
    raise exception 'FAIL: assertion fixtures survived — should have rolled back';
  end if;

  raise notice 'PASS: provider organisation structure + staff scoping in place, type-guard proved to discriminate';
end $$;
