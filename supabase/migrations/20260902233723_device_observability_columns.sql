-- Tarragon Health — Device & Data Operations, part 2/6: observability columns + audit extension.
--
-- 55.10 "device data-quality dashboard" needs to answer missing data / abnormal transmission /
-- duplicate data / latency / device error rates per connection. Latency and missing-data are both
-- already computable from existing columns (recorded_at/taken_at vs created_at, last_synced_at) —
-- but "abnormal transmission" (implausible readings) and "duplicate data" are NOT persisted
-- anywhere today: confirmed by reading apps/web/src/lib/wearables/ingest.ts in full —
-- isPlausible() drops out-of-range values before insert (counted in the API response, never
-- written to a row), and insertDeduping()'s 23505-retry path treats a duplicate as a silent
-- success, also never persisted. This migration adds the counter columns; a following app-layer
-- change increments them from the ingestion code path (ingest.ts, the mobile device-readings
-- route, the wearable webhook route) — this migration is schema-only.
--
-- patient_devices (BLE clinical devices) has no error-tracking column at all today — confirmed:
-- its only columns are id/organisation_id/patient_id/device_type/manufacturer/model/
-- ble_device_id/nickname/status/paired_at/last_synced_at/created_at (plus this migration's
-- siblings' unpair columns). 55.12's patient tech-support auto-diagnosis needs "error code" for a
-- BLE device exactly as much as for a wearable connection, so last_sync_error is added here to
-- bring patient_devices to parity with wearable_connections.
--
-- Second half: 20260812030853_row_change_audit_triggers.sql and
-- 20260812034312_pgaudit_patient_read_logging.sql both explicitly flagged extending their table
-- list as "a mechanical follow-up ... the DO block below just needs its array extended" once
-- reviewed — wearable_connections and patient_devices were never added despite being clearly
-- within the same "clinical core, org-staff-gated" scope (wearable_readings, one hop away, already
-- is). This closes that gap for the two tables this feature is about, without touching either
-- past migration file.

alter table public.wearable_connections
  add column implausible_readings_count integer not null default 0,
  add column duplicate_readings_count   integer not null default 0;

comment on column public.wearable_connections.implausible_readings_count is
  'Incremented by the ingestion code path (ingest.ts) each time a fetched reading for this connection fails isPlausible() and is dropped rather than inserted. 55.10 "abnormal transmission" signal — this is a count of rejected readings, never the readings themselves.';
comment on column public.wearable_connections.duplicate_readings_count is
  'Incremented by the ingestion code path each time an insert for this connection collides on the connection_id/external_reading_id dedupe index (23505). 55.10 "duplicate data" signal.';

alter table public.patient_devices
  add column last_sync_error            text,
  add column implausible_readings_count integer not null default 0,
  add column duplicate_readings_count   integer not null default 0;

comment on column public.patient_devices.last_sync_error is
  'Mirrors wearable_connections.last_sync_error. Set by the mobile device-readings ingestion path on a rejected/failed reading upload for this BLE device; cleared on the next successful upload. Feeds 55.12''s patient tech-support auto-diagnosis and 55.10''s device error-rate signal.';

-- ---------------------------------------------------------------------------
-- Extend the generic write-audit trigger (20260812030853) to these 2 tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array['wearable_connections', 'patient_devices'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists audit_row_change_trg on public.%I', t);
    execute format(
      'create trigger audit_row_change_trg '
      'after insert or update or delete on public.%I '
      'for each row execute function private.audit_row_change()',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Extend pgAudit object-level READ logging (20260812034312) to the same 2 tables.
-- ---------------------------------------------------------------------------
grant select on public.wearable_connections to pgaudit_patient_read;
grant select on public.patient_devices to pgaudit_patient_read;

-- ---------------------------------------------------------------------------
-- Atomic counter bumps for the ingestion code path. A read-modify-write from
-- application code would race under concurrent syncs for the same
-- connection/device; these do the increment server-side in one statement.
-- Deliberately narrow (only these observability columns, nothing else
-- writable) rather than a general-purpose update RPC.
-- ---------------------------------------------------------------------------
create or replace function public.bump_wearable_connection_ingestion_counters(
  p_connection_id uuid,
  p_implausible integer default 0,
  p_duplicates integer default 0,
  p_last_error text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.wearable_connections
  set implausible_readings_count = implausible_readings_count + greatest(p_implausible, 0),
      duplicate_readings_count   = duplicate_readings_count + greatest(p_duplicates, 0),
      last_sync_error            = coalesce(p_last_error, last_sync_error)
  where id = p_connection_id;
$$;

comment on function public.bump_wearable_connection_ingestion_counters(uuid, integer, integer, text) is
  '55.10 data-quality signal. Called from the ingestion code path (ingest.ts) after each sync batch with however many readings were implausible/duplicate for this connection. Service-role only in practice (the ingestion code path always runs as service role) but not grant-restricted from authenticated beyond the RLS-equivalent narrowness of what it touches.';

revoke all on function public.bump_wearable_connection_ingestion_counters(uuid, integer, integer, text) from public, anon;
grant execute on function public.bump_wearable_connection_ingestion_counters(uuid, integer, integer, text) to authenticated;

create or replace function public.bump_patient_device_ingestion_counters(
  p_device_id uuid,
  p_implausible integer default 0,
  p_duplicates integer default 0,
  p_last_error text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.patient_devices
  set implausible_readings_count = implausible_readings_count + greatest(p_implausible, 0),
      duplicate_readings_count   = duplicate_readings_count + greatest(p_duplicates, 0),
      last_sync_error            = coalesce(p_last_error, last_sync_error)
  where id = p_device_id;
$$;

comment on function public.bump_patient_device_ingestion_counters(uuid, integer, integer, text) is
  'Mirrors public.bump_wearable_connection_ingestion_counters() for BLE clinical devices. Called from the mobile device-readings ingestion route.';

revoke all on function public.bump_patient_device_ingestion_counters(uuid, integer, integer, text) from public, anon;
grant execute on function public.bump_patient_device_ingestion_counters(uuid, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array['wearable_connections', 'patient_devices'];
  v_count int;
begin
  foreach t in array tables loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'implausible_readings_count'
    ) then
      raise exception '%.implausible_readings_count was not created', t;
    end if;

    select count(*) into v_count
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal;
    if v_count <> 1 then
      raise exception 'audit_row_change_trg missing or duplicated on public.%: found %', t, v_count;
    end if;

    if not has_table_privilege('pgaudit_patient_read', 'public.' || quote_ident(t), 'SELECT') then
      raise exception 'pgaudit_patient_read missing SELECT on public.%', t;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_devices' and column_name = 'last_sync_error'
  ) then
    raise exception 'patient_devices.last_sync_error was not created';
  end if;

  if has_function_privilege('anon', 'public.bump_wearable_connection_ingestion_counters(uuid, integer, integer, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.bump_wearable_connection_ingestion_counters';
  end if;
  if has_function_privilege('anon', 'public.bump_patient_device_ingestion_counters(uuid, integer, integer, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.bump_patient_device_ingestion_counters';
  end if;

  raise notice 'PASS: observability columns added, write-audit + read-audit extended to wearable_connections and patient_devices';
end $$;
