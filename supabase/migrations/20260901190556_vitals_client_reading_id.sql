-- Offline-first vitals logging (mobile) — the phone writes a reading to a
-- local SQLite queue the instant it's entered, with zero network round-trip,
-- and flushes it later via POST /api/mobile/vitals. That flush can retry
-- blind after a dropped connection (the client can't always tell whether the
-- previous attempt actually landed), so it needs an idempotency key.
--
-- Mirrors the existing device-reading dedupe pattern
-- (vitals_readings_device_dedupe_idx on device_id/external_reading_id from
-- 20260713210000_patient_devices_and_vitals_source.sql) but scoped to
-- patient_id instead of device_id, since an offline manual entry has no
-- device row to key off.
alter table public.vitals_readings
  add column client_reading_id uuid;

create unique index vitals_readings_client_dedupe_idx
  on public.vitals_readings (patient_id, client_reading_id)
  where client_reading_id is not null;

-- No RLS policy change needed: this is a plain column + partial unique index,
-- and the existing vitals_readings_insert policy already covers a patient
-- inserting their own row regardless of which columns are populated.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vitals_readings' and column_name = 'client_reading_id'
  ) then
    raise exception 'client_reading_id column was not created';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'vitals_readings_client_dedupe_idx'
  ) then
    raise exception 'vitals_readings_client_dedupe_idx was not created';
  end if;
end $$;
