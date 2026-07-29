-- Tarragon Health
-- Consumer wearable cloud sync — ingestion boundary schema only.
-- CLAUDE.md "Device & Wearable Integration": Phase 3, diaspora/premium tier,
-- explicitly "not yet built". This migration lays the DB foundation
-- (wearable_connections + wearable_readings per docs/FULL_SPECIFICATION_V4.md
-- §5) so the schema exists ahead of time, but does NOT ship a patient-facing
-- "Connect" flow — none of Apple Health/Oura/WHOOP/Garmin/Fitbit's real
-- OAuth apps have been registered, so a connect button would click through
-- to nothing. Per the project's own "no half-finished implementations"
-- rule, that UI isn't built until real provider credentials exist
-- (packages/shared/src/wearables/providers.ts documents the exact
-- degradation contract for when they do).
--
-- wearable_readings is a genuinely new, separate table from vitals_readings
-- — not a violation of the "no dual source of truth" rule in the Bluetooth
-- clinical-device migration (20260713210000), which is about the *same*
-- clinical measurement (BP/glucose/weight) gaining a second entry path.
-- Passive wearable metrics (steps, sleep stages, HRV, recovery/strain
-- scores) have no vitals_readings.vital_type equivalent at all — there's
-- nothing to duplicate. Any wearable metric that *does* overlap an existing
-- vital_type (heart rate -> pulse, weight, SpO2) should be written to
-- vitals_readings with source='wearable' instead, once sync is actually
-- built — vital_source gains that value now so the enum doesn't need a
-- follow-up migration later.

create type public.wearable_provider as enum ('apple_health', 'oura', 'whoop', 'garmin', 'fitbit');
create type public.wearable_connection_status as enum ('active', 'disconnected', 'error');

alter type public.vital_source add value 'wearable';

create table public.wearable_connections (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  provider          public.wearable_provider not null,
  status            public.wearable_connection_status not null default 'active',
  external_id       text,
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now()
);

-- One active connection per (patient, provider) — matches
-- patient_devices_patient_ble_id_active_idx's re-pairing-is-a-new-row
-- pattern, so reconnect history is preserved rather than overwritten.
create unique index wearable_connections_patient_provider_active_idx
  on public.wearable_connections (patient_id, provider)
  where status = 'active';
create index wearable_connections_patient_idx on public.wearable_connections (patient_id);
create index wearable_connections_org_idx on public.wearable_connections (organisation_id);

alter table public.wearable_connections enable row level security;

create policy wearable_connections_select on public.wearable_connections
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wearable_connections_insert on public.wearable_connections
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wearable_connections_update on public.wearable_connections
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wearable_connections_delete on public.wearable_connections
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.wearable_connections to authenticated;

create table public.wearable_readings (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  connection_id       uuid not null references public.wearable_connections (id) on delete cascade,
  reading_type        text not null,
  value               numeric,
  unit                text,
  recorded_at         timestamptz not null,
  external_reading_id text,
  created_at          timestamptz not null default now()
);

-- Idempotency for a resync/webhook retry, same reasoning as
-- vitals_readings_device_dedupe_idx.
create unique index wearable_readings_dedupe_idx
  on public.wearable_readings (connection_id, external_reading_id)
  where external_reading_id is not null;
create index wearable_readings_connection_idx on public.wearable_readings (connection_id, recorded_at desc);
create index wearable_readings_org_idx on public.wearable_readings (organisation_id);

alter table public.wearable_readings enable row level security;

create policy wearable_readings_select on public.wearable_readings
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.wearable_connections c
      where c.id = wearable_readings.connection_id and c.patient_id = (select auth.uid())
    )
  );

-- Insert-only via the (future) sync/webhook ingestion path, which will run
-- as service-role (same as the mobile device-readings route) — no
-- authenticated insert/update/delete grant, since a patient's own session
-- should never be able to fabricate a reading claiming to be provider-synced
-- data (a manual vitals_readings entry already covers the "I want to log
-- this myself" case).
grant select on public.wearable_readings to authenticated;
