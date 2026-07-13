-- Tarragon Health
-- Bluetooth clinical device integration (BP cuffs, glucometers, smart
-- scales) — CLAUDE.md "Device & Wearable Integration", FULL_SPECIFICATION_V4
-- §5/§9, Phase 2 (core-tier, sold as device bundles per pricing.ts, not
-- gated by has_feature_access). Ingestion boundary only — TarragonHealth
-- never talks to device firmware directly; the Expo mobile app's native BLE
-- pairs with the device and uploads parsed readings.
--
-- patient_devices: which BLE peripheral a patient has paired. ble_device_id
-- is the OS-level peripheral identifier (CoreBluetooth UUID on iOS, MAC-
-- derived UUID on Android) — device-local, not a globally stable hardware
-- serial, so pairing is per app-install, matching how BLE addressing
-- actually works on both platforms.
--
-- vitals_readings gains source/device_id/external_reading_id rather than a
-- parallel wearable_readings table — per CLAUDE.md: "Device sync is an
-- additive faster path into the same vitals tables patients already log
-- into manually... same downstream escalation logic, same
-- patient_risk_scores, same abnormal-result pipeline. No dual
-- source-of-truth." external_reading_id carries the BLE measurement's own
-- sequence number (Glucose Measurement 0x2A18) or a locally-derived
-- idempotency key (Blood Pressure Measurement 0x2A35 has no sequence
-- number in the spec), so a resync/retry can't double-insert.

create type public.patient_device_type as enum ('bp_cuff', 'glucometer', 'scale');
create type public.patient_device_status as enum ('active', 'unpaired');

create table public.patient_devices (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  device_type       public.patient_device_type not null,
  manufacturer      text,
  model             text,
  ble_device_id     text not null,
  nickname          text,
  status            public.patient_device_status not null default 'active',
  paired_at         timestamptz not null default now(),
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now()
);

-- One active pairing per (patient, peripheral) — re-pairing an unpaired
-- device is a new row, not a resurrection of the old one, so history of
-- past pairings is preserved.
create unique index patient_devices_patient_ble_id_active_idx
  on public.patient_devices (patient_id, ble_device_id)
  where status = 'active';
create index patient_devices_patient_idx on public.patient_devices (patient_id);
create index patient_devices_org_idx on public.patient_devices (organisation_id);

alter table public.patient_devices enable row level security;

create policy patient_devices_select on public.patient_devices
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy patient_devices_insert on public.patient_devices
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy patient_devices_update on public.patient_devices
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy patient_devices_delete on public.patient_devices
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_devices to authenticated;

-- vitals_readings additions ---------------------------------------------

create type public.vital_source as enum ('manual', 'device');

alter table public.vitals_readings
  add column source public.vital_source not null default 'manual',
  add column device_id uuid references public.patient_devices (id) on delete set null,
  add column external_reading_id text;

-- Idempotency: a device resync/retry that replays the same measurement
-- must not create a duplicate reading. Partial (only applies when both
-- columns are populated, i.e. device-sourced rows) so manual entries are
-- unaffected.
create unique index vitals_readings_device_dedupe_idx
  on public.vitals_readings (device_id, external_reading_id)
  where device_id is not null and external_reading_id is not null;

-- No RLS policy changes needed: the existing vitals_readings_insert policy
-- (patient_id = auth.uid() or is_org_staff) already covers a patient
-- inserting a device-sourced reading tied to their own patient_devices row.
