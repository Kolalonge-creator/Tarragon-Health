-- Tarragon Health — Care Management Engine integration follow-up.
--
-- clinician_alerts.severity and .dedup_key (Alert System,
-- 20260828014055_clinician_alerts_taxonomy_lifecycle_ownership.sql) are
-- NOT NULL with no default -- correct, since private.classify_and_assign_
-- clinician_alert() unconditionally overwrites both on every insert
-- regardless of what the client provides ("never client-settable"). But
-- with no default, Supabase's generated Insert type marks them as
-- REQUIRED, even though every one of this platform's 9 real alert
-- generators (5 pre-existing trigger functions the Alert System
-- deliberately never touched, plus the 4 escalate.ts/assess-*.ts call
-- sites PR #276 itself updated) correctly never sets them, relying on the
-- trigger. A fresh regeneration from the live post-migration schema
-- surfaced this as a real typecheck failure across those 4 files.
--
-- Fix: give both an inert default (immediately overwritten by the
-- BEFORE INSERT trigger on every real insert, so this has zero runtime
-- effect) purely so the generated TypeScript type matches what every
-- caller already correctly assumes. Not a security change -- the trigger
-- still unconditionally overwrites both columns regardless of any
-- default or client-supplied value.

alter table public.clinician_alerts
  alter column severity set default 0,
  alter column dedup_key set default '';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts'
      and column_name = 'severity' and column_default is not null
  ) then
    raise exception 'clinician_alerts.severity default was not set';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts'
      and column_name = 'dedup_key' and column_default is not null
  ) then
    raise exception 'clinician_alerts.dedup_key default was not set';
  end if;
  raise notice 'PASS: clinician_alerts.severity/dedup_key have inert defaults, trigger still overwrites both unconditionally';
end $$;
