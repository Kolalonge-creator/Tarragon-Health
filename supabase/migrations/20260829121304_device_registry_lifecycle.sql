-- Tarragon Health
-- Connected Medical Device Platform — founder spec "52. CONNECTED MEDICAL
-- DEVICE PLATFORM" (device registry, lifecycle, ownership, quality/
-- calibration, duplicate/failure handling, replacement workflow).
--
-- This is deliberately a THIRD layer, distinct from two existing, narrower
-- tables:
--   - device_catalog (20260825175835): a product CATALOGUE — what model to
--     recommend to a patient. No organisation_id, no serial numbers, no
--     per-unit anything. Global reference data.
--   - patient_devices (20260713210000): a per-patient BLE PAIRING session —
--     one row per (patient, peripheral) pairing event, keyed on the
--     OS-level ble_device_id, which is device-local and resets on every
--     re-pair/app-reinstall (not a stable hardware identity).
--
-- device_units is the missing piece: the actual PHYSICAL DEVICE's identity
-- and lifecycle (manufacturer/model/firmware/serial, validation, ownership,
-- calibration) — independent of any one pairing session, and the thing
-- spec §52.3/52.6/52.11/52.12 are actually about. A purely patient-owned
-- device that Tarragon has never touched typically has NO device_units row
-- at all (there is nothing to register) — patient_devices.device_unit_id is
-- nullable and only populated when Tarragon or a partner actually owns, or
-- has chosen to register, the physical unit. This keeps §52.17's acceptance
-- criterion true: a new compatible model of an already-supported device
-- category needs a device_units row (and, for a genuinely new device_type,
-- one enum value) — never a redesign of patient_devices, vitals_readings,
-- or the ingestion routes.
--
-- Device categories: 'ecg' and 'peak_flow_meter' are added to
-- patient_device_type below for schema completeness (spec §52.2) — same
-- posture as 'apple_health'/'libre' already sitting in wearable_provider
-- ahead of a working integration. Neither has a GATT parser in
-- apps/mobile/src/lib/ble.ts yet: ECG has no single standard clinical GATT
-- characteristic the way BP/glucose/weight/temp/SpO2 do, and peak-flow
-- meters would need the Weight-Scale-shaped work this migration deliberately
-- does not include. A device_units row can exist for either today
-- (inventory/registry tracking); real BLE ingestion is separate follow-up
-- work, same caveat as CLAUDE.md's "never tested against real hardware"
-- note for the five profiles that DO have parsers. Plain ADD VALUE, same as
-- 20260721141233's precedent — additive only, no rename, no data migration.
alter type public.patient_device_type add value if not exists 'ecg';
alter type public.patient_device_type add value if not exists 'peak_flow_meter';

create type public.device_lifecycle_status as enum (
  'registered', 'validated', 'available', 'assigned', 'active', 'inactive', 'retired'
);

create type public.device_ownership as enum (
  'patient_owned', 'tarragon_owned', 'partner_owned'
);

create type public.device_connectivity_status as enum (
  'ok', 'no_data', 'investigating'
);

create type public.device_fault_status as enum (
  'reported', 'troubleshooting', 'resolved', 'replacement_requested', 'replaced'
);

-- ---------------------------------------------------------------------------
-- device_units — the physical-device registry. One row per real, physical
-- unit: manufacturer + model + serial number, its lifecycle state, who owns
-- it, and calibration/validation facts (spec §52.3, §52.4, §52.6, §52.11).
-- ---------------------------------------------------------------------------

create table public.device_units (
  id                              uuid primary key default gen_random_uuid(),
  organisation_id                 uuid not null references public.organisations (id) on delete restrict,
  device_type                     public.patient_device_type not null,
  manufacturer                    text not null,
  model                           text not null,
  serial_number                   text not null,
  firmware_version                text,
  -- Reuses device_catalog's existing pairing-path enum rather than minting a
  -- parallel "integration method" vocabulary for the same concept.
  integration_method              public.device_catalog_pairing_path not null default 'ble_open_gatt',
  -- Free-form on purpose (mirrors device_catalog's own free-text fields):
  -- a device's measurement set is already implied by device_type for the
  -- five wired-up categories, but ECG/peak-flow (and any future category)
  -- may report several distinct measurements that don't collapse into one
  -- vital_type — this is descriptive registry data, not something the
  -- ingestion path validates against.
  supported_measurements          text[] not null default '{}',
  lifecycle_status                public.device_lifecycle_status not null default 'registered',
  ownership                       public.device_ownership not null default 'patient_owned',
  -- Only meaningful for ownership = 'partner_owned' — a hospital/employer/
  -- insurer's own organisation record providing the unit (spec §52.6).
  owning_partner_organisation_id  uuid references public.organisations (id) on delete set null,
  validated_at                    timestamptz,
  validated_by                    uuid references public.profiles (id) on delete set null,
  calibration_interval_days       integer,
  last_calibrated_at              timestamptz,
  next_calibration_due_at         timestamptz,
  assigned_patient_id             uuid references public.profiles (id) on delete set null,
  assigned_at                     timestamptz,
  retired_at                      timestamptz,
  retired_reason                  text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint device_units_calibration_interval_positive
    check (calibration_interval_days is null or calibration_interval_days > 0),
  -- Bidirectional: a partner_owned unit must name which partner (spec
  -- §52.6 — "the ownership model should be stored" means the actual
  -- partner, not just the category), and no other ownership may carry one.
  constraint device_units_partner_ownership_scope
    check ((ownership = 'partner_owned') = (owning_partner_organisation_id is not null)),
  constraint device_units_assignment_scope
    check (assigned_patient_id is null or lifecycle_status in ('assigned', 'active', 'inactive')),
  constraint device_units_assigned_at_scope
    check ((assigned_patient_id is null) = (assigned_at is null)),
  constraint device_units_retirement_scope
    check ((lifecycle_status = 'retired') = (retired_at is not null))
);

-- Global per manufacturer+model+serial — a real physical unit is registered
-- exactly once, however many times it gets reassigned/re-paired over its
-- life (spec §52.4's lifecycle is what tracks that history on ONE row, not
-- a fresh row per reassignment).
create unique index device_units_manufacturer_model_serial_idx
  on public.device_units (manufacturer, model, serial_number);
create index device_units_org_idx on public.device_units (organisation_id);
create index device_units_assigned_patient_idx
  on public.device_units (assigned_patient_id) where assigned_patient_id is not null;
create index device_units_lifecycle_idx on public.device_units (organisation_id, lifecycle_status);

create trigger device_units_set_updated_at
  before update on public.device_units
  for each row execute function private.set_updated_at();

alter table public.device_units enable row level security;

-- Read: the assigned patient can see their own unit's registry record
-- (manufacturer/model/firmware/validation — the "generated by device X,
-- model Y" provenance spec §52.13 asks for); org staff can see every unit
-- in their organisation. Write: registry/inventory management is a staff
-- function, never patient self-service (spec §52.3's fields — validation
-- status, calibration, ownership — are governance data a patient does not
-- author, mirroring device_catalog's authenticated-read/admin-write split
-- and the Care Coordinator non-clinical-write-access pattern already used
-- for other staff-only workflows in this codebase).
create policy device_units_select on public.device_units
  for select to authenticated
  using (assigned_patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy device_units_insert on public.device_units
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy device_units_update on public.device_units
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy device_units_delete on public.device_units
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- RLS restricts rows, it does not grant table-level access (CLAUDE.md's
-- repeatedly-relearned "freshly created table needs its own grant" lesson).
grant select, insert, update, delete on public.device_units to authenticated;

-- ---------------------------------------------------------------------------
-- patient_devices additions — link a pairing session to a registered
-- physical unit (nullable: most patient-owned devices have none), plus
-- connectivity tracking for the "no data arrived" workflow (spec §52.10).
-- ---------------------------------------------------------------------------

alter table public.patient_devices
  add column device_unit_id uuid references public.device_units (id) on delete set null,
  add column connectivity_status public.device_connectivity_status not null default 'ok',
  add column connectivity_notified_at timestamptz;

create index patient_devices_device_unit_idx
  on public.patient_devices (device_unit_id) where device_unit_id is not null;

-- ---------------------------------------------------------------------------
-- device_fault_reports — the "My BP machine isn't working" workflow (spec
-- §52.12): patient reports a problem, staff troubleshoot, and either resolve
-- it in place or link a replacement device_units row. Points at
-- patient_devices (always exists once paired, including for a purely
-- patient-owned device with no device_units row) so a patient can always
-- file a report; device_unit_id is populated whenever the pairing has one.
-- ---------------------------------------------------------------------------

create table public.device_fault_reports (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  patient_device_id           uuid references public.patient_devices (id) on delete set null,
  device_unit_id              uuid references public.device_units (id) on delete set null,
  reported_by                 uuid not null references public.profiles (id) on delete restrict,
  description                 text not null,
  status                      public.device_fault_status not null default 'reported',
  resolution_notes            text,
  replacement_device_unit_id  uuid references public.device_units (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  resolved_at                 timestamptz,
  constraint device_fault_reports_description_not_blank check (btrim(description) <> ''),
  constraint device_fault_reports_resolved_scope
    check ((status in ('resolved', 'replaced')) = (resolved_at is not null)),
  constraint device_fault_reports_replacement_scope
    check (status = 'replaced' or replacement_device_unit_id is null)
);

create index device_fault_reports_patient_idx on public.device_fault_reports (patient_id, created_at desc);
create index device_fault_reports_org_status_idx on public.device_fault_reports (organisation_id, status);

create trigger device_fault_reports_set_updated_at
  before update on public.device_fault_reports
  for each row execute function private.set_updated_at();

alter table public.device_fault_reports enable row level security;

-- A patient can file and read their own reports; org staff can read/manage
-- every report in their organisation. Status transitions (troubleshooting ->
-- resolved/replacement_requested/replaced) are staff-driven — a patient
-- cannot mark their own report resolved, matching how every other
-- staff-adjudicated workflow in this schema is app/DB gated.
create policy device_fault_reports_select on public.device_fault_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy device_fault_reports_insert on public.device_fault_reports
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and reported_by = (select auth.uid()))
    or private.is_org_staff(organisation_id)
  );

create policy device_fault_reports_update on public.device_fault_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy device_fault_reports_delete on public.device_fault_reports
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.device_fault_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — proves the migration did what it claims rather than just
-- hoping (CLAUDE.md's reusable removal/addition pattern, applied here to an
-- addition).
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'patient_device_type' and e.enumlabel = 'ecg'
  ) then
    raise exception 'device_registry_lifecycle: patient_device_type is missing ecg';
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'patient_device_type' and e.enumlabel = 'peak_flow_meter'
  ) then
    raise exception 'device_registry_lifecycle: patient_device_type is missing peak_flow_meter';
  end if;

  if to_regclass('public.device_units') is null then
    raise exception 'device_registry_lifecycle: device_units was not created';
  end if;

  if to_regclass('public.device_fault_reports') is null then
    raise exception 'device_registry_lifecycle: device_fault_reports was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_devices'
      and column_name = 'device_unit_id'
  ) then
    raise exception 'device_registry_lifecycle: patient_devices.device_unit_id was not added';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'device_units' and policyname = 'device_units_select'
  ) then
    raise exception 'device_registry_lifecycle: device_units RLS policy missing';
  end if;
end $$;
