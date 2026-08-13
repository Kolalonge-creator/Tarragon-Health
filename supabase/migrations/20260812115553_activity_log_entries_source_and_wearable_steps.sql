-- Synced step counts never reached the step counter the patient actually sees.
--
-- The phone reads daily step totals from Apple Health / Health Connect (and
-- the cloud providers do the same through their own adapters), uploads them,
-- and public.ingest_readings routes them to wearable_readings because "steps"
-- has no vitals_readings equivalent. But the patient-facing "0 of 7,500 steps
-- today" meter, the activity goal and everything keyed off them read
-- activity_log_entries, which until now was written ONLY by the manual
-- "log your steps" form. Nothing bridged the two tables: no trigger, no view,
-- and no application code reads wearable_readings at all. So a patient could
-- walk 10,000 steps, have them sync perfectly, and still be shown zero.
--
-- Row counts at the time of writing: wearable_readings 0, activity_log_entries
-- 0, patient_devices 0. Nobody has hit this yet because nothing has ever
-- synced — which is also why it went unnoticed. No backfill step is therefore
-- needed, only the forward path.

-- 1. Where an activity entry came from.
--
-- Reuses the existing vital_source enum (manual, device, wearable, cgm,
-- fhir_import) rather than inventing a parallel one, so "how did this number
-- get here" has a single vocabulary across vitals_readings and
-- activity_log_entries. Phone/platform syncs are 'wearable' here, matching
-- what ingest_readings already writes to vitals_readings for the same batch —
-- 'device' stays reserved for a paired BLE clinical device, per CLAUDE.md's
-- ingestion-boundary rule.
--
-- Defaulting to 'manual' is correct for every existing row: the only writer
-- until now was the patient's own form.
alter table public.activity_log_entries
  add column if not exists source public.vital_source not null default 'manual';

comment on column public.activity_log_entries.source is
  'How this entry was recorded. manual = the patient typed it; wearable = synced from Apple Health / Health Connect / a connected provider. A sync never overwrites a manual entry.';

-- 2. The one supported way a sync writes a day''s step total.
--
-- Upsert rather than insert, because a day''s step count legitimately grows
-- through the day: the same calendar day is re-synced repeatedly and each
-- total supersedes the last. (This is also why the caller must drive this from
-- the incoming samples rather than from ingest''s insert result — that path
-- dedupes on external_reading_id = 'steps:<date>', so every re-sync of the
-- same day after the first is discarded as a duplicate, and only the first,
-- smallest total of the morning would ever have landed.)
--
-- The DO UPDATE ... WHERE source <> 'manual' is the collision rule: if the
-- patient typed a step count for that day themselves, the sync leaves it
-- alone rather than silently overwriting what a person entered. It returns
-- true when it wrote and null when it deferred to a manual entry, so the
-- caller can tell the difference instead of guessing.
--
-- ON CONFLICT names the predicate as well as the columns because
-- activity_log_entries_steps_per_day_uidx is a partial unique index
-- (one steps row per patient per day) and cannot be inferred by columns alone.
create or replace function public.record_wearable_step_count(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_logged_on date,
  p_step_count integer
) returns boolean
language sql
set search_path = public, pg_temp
as $$
  insert into public.activity_log_entries (
    patient_id, organisation_id, entry_type, step_count, logged_on, source
  )
  values (p_patient_id, p_organisation_id, 'steps', p_step_count, p_logged_on, 'wearable')
  on conflict (patient_id, logged_on) where entry_type = 'steps'
  do update set
    step_count = excluded.step_count,
    logged_at  = now()
  where activity_log_entries.source <> 'manual'
  returning true;
$$;

comment on function public.record_wearable_step_count(uuid, uuid, date, integer) is
  'Records a synced daily step total, replacing an earlier synced total for the same day. Returns null (writes nothing) when a manual entry already exists for that day. Service-role only: a patient session must not be able to fabricate a step count attributed to a device.';

-- A patient session must never call this — it would let anyone write an
-- arbitrary step count attributed to a sync, bypassing the manual-entry path
-- and its RLS. EXECUTE is inherited through the PUBLIC pseudo-role, so the
-- revoke must name PUBLIC, not anon (see the standing note in CLAUDE.md:
-- revoking "from anon" leaves the PUBLIC grant in place and the function
-- still callable).
revoke execute on function public.record_wearable_step_count(uuid, uuid, date, integer) from public;
grant execute on function public.record_wearable_step_count(uuid, uuid, date, integer) to service_role;

-- Prove it, rather than hope. Runs in the migration''s own transaction and
-- rolls its fixtures back.
do $$
declare
  v_org uuid;
  v_patient uuid;
  v_wrote boolean;
  v_count integer;
begin
  -- anon and authenticated must not hold EXECUTE, directly or via PUBLIC.
  if has_function_privilege('anon', 'public.record_wearable_step_count(uuid, uuid, date, integer)', 'EXECUTE') then
    raise exception 'anon can execute record_wearable_step_count';
  end if;
  if has_function_privilege('authenticated', 'public.record_wearable_step_count(uuid, uuid, date, integer)', 'EXECUTE') then
    raise exception 'authenticated can execute record_wearable_step_count';
  end if;
  if not has_function_privilege('service_role', 'public.record_wearable_step_count(uuid, uuid, date, integer)', 'EXECUTE') then
    raise exception 'service_role cannot execute record_wearable_step_count';
  end if;

  select id into v_org from public.organisations limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org limit 1;
  if v_org is null or v_patient is null then
    raise notice 'no org/profile available; skipping behavioural assertions';
    return;
  end if;

  -- A fresh day writes.
  v_wrote := public.record_wearable_step_count(v_patient, v_org, date '1999-01-02', 1200);
  if v_wrote is not true then
    raise exception 'expected a first sync to write';
  end if;

  -- A later, larger total for the same day replaces it rather than erroring
  -- or duplicating.
  v_wrote := public.record_wearable_step_count(v_patient, v_org, date '1999-01-02', 9412);
  if v_wrote is not true then
    raise exception 'expected a re-sync of the same day to update';
  end if;
  select step_count into v_count
    from public.activity_log_entries
    where patient_id = v_patient and logged_on = date '1999-01-02' and entry_type = 'steps';
  if v_count <> 9412 then
    raise exception 'expected the later total to win, got %', v_count;
  end if;
  select count(*) into v_count
    from public.activity_log_entries
    where patient_id = v_patient and logged_on = date '1999-01-02' and entry_type = 'steps';
  if v_count <> 1 then
    raise exception 'expected exactly one steps row for the day, got %', v_count;
  end if;

  -- A manual entry is never overwritten by a sync.
  insert into public.activity_log_entries
    (patient_id, organisation_id, entry_type, step_count, logged_on, source)
  values (v_patient, v_org, 'steps', 3000, date '1999-01-03', 'manual');
  v_wrote := public.record_wearable_step_count(v_patient, v_org, date '1999-01-03', 8888);
  if v_wrote is not null then
    raise exception 'expected a sync to defer to a manual entry, got %', v_wrote;
  end if;
  select step_count into v_count
    from public.activity_log_entries
    where patient_id = v_patient and logged_on = date '1999-01-03' and entry_type = 'steps';
  if v_count <> 3000 then
    raise exception 'a sync overwrote a manual entry: %', v_count;
  end if;

  delete from public.activity_log_entries
    where patient_id = v_patient and logged_on in (date '1999-01-02', date '1999-01-03');
end $$;
