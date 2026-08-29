-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 1/9:
-- provider network (Diagnostic Organisation -> Locations, Equipment,
-- Radiologists/Technicians).
--
-- WHY: extends the diagnostic ecosystem beyond laboratory testing (spec
-- §59). Deliberately mirrors the lab-provider-network shape exactly
-- (lab_providers/lab_provider_locations, 20260705211315/20260825201412):
-- platform-wide reference data, no organisation_id, readable by any
-- authenticated user, admin-write (plus a new delegable RBAC permission,
-- 'partners.imaging.manage', following the exact
-- has_permission('partners.labs.manage') precedent from
-- 20260718230100_rbac_partner_rls_and_analyst_admin.sql).
--
-- SCOPE DECISION — no imaging_partner account role, no partner self-service
-- portal, in this build. lab_partner was only added long after lab_providers
-- had a real signed partner (Synlab); no imaging partner is signed today (the
-- research pass confirms zero contracted imaging capacity exists — the
-- currently-active breast_imaging/mammography screen_types are entirely
-- self-arranged, patient pays the facility directly and uploads their own
-- result). Adding a scoped-access role now would mean touching
-- private.is_org_staff() — "the highest-leverage security function in the
-- codebase... a single wrong role admitted to it is a platform-wide PHI
-- exposure" per CLAUDE.md — for a role with no real account to exercise it.
-- Admin manages this catalogue directly for now, exactly like lab_providers
-- did before lab_partner existed. Add the partner role/self-service surface
-- later, on a real signed imaging partner, the same way lab_partner was.
--
-- Radiologists/technicians are a plain admin-managed roster
-- (imaging_provider_staff) — reference data about who works at a partner
-- facility, not login accounts. A report's authoring radiologist may or may
-- not be in this roster (self-arranged reports are usually produced by a
-- radiologist with no Tarragon relationship at all) — see imaging_reports
-- (part 6), which also carries a free-text radiologist_name fallback.
--
-- "Modalities" (spec §59.2) is folded into imaging_equipment rather than
-- built as its own table: in practice a piece of equipment IS the modality
-- offered (an MRI machine is both "the MRI modality" and "the equipment"),
-- so a separate join table would just duplicate the same one-to-many
-- relationship imaging_equipment already carries via its `modality` column.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.imaging_modality as enum (
  'xray', 'ultrasound', 'ct', 'mri', 'mammography', 'echocardiography', 'other'
);

create type public.imaging_provider_staff_role as enum ('radiologist', 'technician');

-- ---------------------------------------------------------------------------
-- 2. Diagnostic Organisation (global catalogue, mirrors lab_providers)
-- ---------------------------------------------------------------------------
create table public.imaging_providers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  license_type       text,
  license_number     text,
  license_expires_at timestamptz,
  verified_at        timestamptz,
  verified_by        uuid references public.profiles (id) on delete restrict,
  contact_phone      text,
  contact_email      text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint imaging_providers_contact_phone_e164
    check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$')
);

comment on table public.imaging_providers is
  'A diagnostic imaging organisation (spec §59.2) -- platform-wide reference data, no organisation_id, same posture as lab_providers. No admin-write self-service role exists yet (see migration header); admin manages this table directly.';

create trigger imaging_providers_set_updated_at
  before update on public.imaging_providers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Locations (mirrors lab_provider_locations exactly)
-- ---------------------------------------------------------------------------
create table public.imaging_provider_locations (
  id                  uuid primary key default gen_random_uuid(),
  imaging_provider_id uuid not null references public.imaging_providers (id) on delete cascade,
  name                text not null,
  state               text not null,
  address             text not null,
  contact_phone       text,
  latitude            double precision,
  longitude           double precision,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  constraint imaging_provider_locations_contact_phone_e164
    check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint imaging_provider_locations_latitude_range
    check (latitude is null or (latitude between -90 and 90)),
  constraint imaging_provider_locations_longitude_range
    check (longitude is null or (longitude between -180 and 180))
);

create index imaging_provider_locations_provider_idx
  on public.imaging_provider_locations (imaging_provider_id);

-- ---------------------------------------------------------------------------
-- 4. Equipment (also stands in for "Modalities" -- see header)
-- ---------------------------------------------------------------------------
create table public.imaging_equipment (
  id                   uuid primary key default gen_random_uuid(),
  location_id          uuid not null references public.imaging_provider_locations (id) on delete cascade,
  modality             public.imaging_modality not null,
  name                 text not null,
  manufacturer         text,
  field_strength_tesla numeric(3, 1),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  constraint imaging_equipment_field_strength_positive
    check (field_strength_tesla is null or field_strength_tesla > 0)
);

create index imaging_equipment_location_idx on public.imaging_equipment (location_id);
create index imaging_equipment_modality_idx on public.imaging_equipment (modality) where is_active;

-- ---------------------------------------------------------------------------
-- 5. Radiologists / Technicians roster (reference data, not login accounts)
-- ---------------------------------------------------------------------------
create table public.imaging_provider_staff (
  id                   uuid primary key default gen_random_uuid(),
  imaging_provider_id  uuid not null references public.imaging_providers (id) on delete cascade,
  location_id          uuid references public.imaging_provider_locations (id) on delete set null,
  staff_role           public.imaging_provider_staff_role not null,
  full_name            text not null,
  license_number       text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

create index imaging_provider_staff_provider_idx on public.imaging_provider_staff (imaging_provider_id);

-- ---------------------------------------------------------------------------
-- 6. RBAC permission (mirrors partners.labs.manage / partners.pharmacies.manage)
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description)
values (
  'partners.imaging.manage', 'Manage imaging providers', 'Partners',
  'Add and edit imaging providers, locations, equipment and staff'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. RLS — read open to any authenticated user (global catalogue), write
--    admin or the new delegable permission.
-- ---------------------------------------------------------------------------
alter table public.imaging_providers enable row level security;
alter table public.imaging_provider_locations enable row level security;
alter table public.imaging_equipment enable row level security;
alter table public.imaging_provider_staff enable row level security;

do $$
declare
  rec record;
begin
  for rec in select unnest(array[
    'imaging_providers', 'imaging_provider_locations', 'imaging_equipment', 'imaging_provider_staff'
  ]) as tbl
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated using (true);
    $f$, rec.tbl);

    execute format($f$
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (private.is_admin() or private.has_permission('partners.imaging.manage'));
    $f$, rec.tbl);

    execute format($f$
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (private.is_admin() or private.has_permission('partners.imaging.manage'))
        with check (private.is_admin() or private.has_permission('partners.imaging.manage'));
    $f$, rec.tbl);

    execute format($f$
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_admin() or private.has_permission('partners.imaging.manage'));
    $f$, rec.tbl);

    execute format(
      'grant select, insert, update, delete on public.%I to authenticated;', rec.tbl
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_type where typname in ('imaging_modality', 'imaging_provider_staff_role')) <> 2 then
    raise exception 'imaging enums were not created';
  end if;

  if not exists (select 1 from public.permissions where key = 'partners.imaging.manage') then
    raise exception 'partners.imaging.manage permission was not registered';
  end if;

  if not (
    has_table_privilege('authenticated', 'public.imaging_providers', 'SELECT')
    and has_table_privilege('authenticated', 'public.imaging_provider_locations', 'SELECT')
    and has_table_privilege('authenticated', 'public.imaging_equipment', 'SELECT')
    and has_table_privilege('authenticated', 'public.imaging_provider_staff', 'SELECT')
  ) then
    raise exception 'imaging provider network tables missing the authenticated SELECT grant';
  end if;

  raise notice 'PASS: imaging provider network (providers/locations/equipment/staff) in place';
end $$;
