-- Follow-up to 20260830233204_medication_logs_safety_hardening.sql: the same
-- client-trusted-timestamp gap exists on vitals_readings.taken_at and
-- symptoms.reported_at (both `not null default now()`, neither ever forced
-- server-side — private.stamp_acting_supporter, which both tables' insert
-- triggers already call, only ever touches logged_by_profile_id).
--
-- This is NOT a mechanical copy of the medication_logs fix, because these
-- two tables are not the same shape:
--
-- * symptoms.reported_at has no legitimate reason to differ from insert
--   time — symptomLogSchema (apps/web/src/lib/validation/symptoms.ts) never
--   carries a timestamp field, no UI on either platform lets a patient
--   backdate a symptom, and no DB test relies on it differing. Forced
--   unconditionally, same as medication_logs.logged_at.
--
-- * vitals_readings.taken_at is genuinely different and must NOT be forced
--   unconditionally. vitals_readings.source (vital_source enum: manual,
--   device, wearable, cgm, fhir_import) exists precisely because a
--   non-manual reading's taken_at is real clinical data distinct from "when
--   it reached our DB" -- a Bluetooth BP cuff, a CGM, a wearable sync, or a
--   FHIR historical import all legitimately backdate taken_at to when the
--   measurement actually happened (apps/web/src/app/api/mobile/
--   device-readings, .../cgm-readings, .../lib/wearables/ingest.ts, and the
--   FHIR import review flow all set it from the real source payload).
--   Forcing clock_timestamp() table-wide would silently corrupt every one
--   of those readings' true observation time. Scoped to source = 'manual'
--   only, where no such legitimate need exists -- confirmed by checking:
--   apps/web/src/lib/validation/vitals.ts's taken_at field is optional and
--   never actually rendered by vitals-form.tsx (no datetime input exists in
--   the manual-entry UI on either platform), so this closes a real,
--   unexercised spoofing surface without removing any working capability.
--
--   packages/db/tests/sponsor_care_status_and_funding.sql's "gone quiet"
--   check deliberately backdates a *manual* reading 40 days to simulate lapsed
--   engagement without waiting 40 real days -- private.queue_sponsor_
--   quiet_nudges() reads max(taken_at) with no source filter, so that test
--   fixture is switched to source = 'device' in the same commit as this
--   migration: semantically identical for what the test actually exercises,
--   and no longer blocked by the trigger below.

-- ---------------------------------------------------------------------------
-- symptoms.reported_at: no legitimate backdating use case, force it.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_symptom_timestamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.reported_at := clock_timestamp();
  return new;
end;
$$;

create trigger symptoms_stamp_timestamp
  before insert on public.symptoms
  for each row execute function private.stamp_symptom_timestamp();

-- ---------------------------------------------------------------------------
-- vitals_readings.taken_at: force it ONLY for source = 'manual'. Every other
-- source's taken_at is real, legitimately-backdated clinical data and must
-- pass through untouched.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_manual_vitals_timestamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'manual' then
    new.taken_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger vitals_readings_stamp_manual_timestamp
  before insert on public.vitals_readings
  for each row execute function private.stamp_manual_vitals_timestamp();

-- ---------------------------------------------------------------------------
-- Assert
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'symptoms_stamp_timestamp'
       and tgrelid = 'public.symptoms'::regclass
       and not tgisinternal
  ) then
    raise exception 'symptoms is missing its server-side reported_at stamp';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'vitals_readings_stamp_manual_timestamp'
       and tgrelid = 'public.vitals_readings'::regclass
       and not tgisinternal
  ) then
    raise exception 'vitals_readings is missing its server-side manual-source taken_at stamp';
  end if;
end $$;
