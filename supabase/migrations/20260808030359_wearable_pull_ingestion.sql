-- Tarragon Health
-- Finishes the consumer-wearable ingestion path. The webhook route
-- (20260724001850 + api/wearables/webhook) shipped as a deliberate
-- best-effort scaffold: it stored whatever a provider happened to put in the
-- POST body and acked. The half it documented as unbuilt -- "notify -> use
-- the stored access_token to fetch the actual reading" -- is what Fitbit,
-- WHOOP and Oura actually do, so today a real subscription would deliver
-- nothing but a last_synced_at touch. This migration adds the four schema
-- pieces that path needs, plus closes two access holes that only became
-- material once those tokens start being worth something.
--
-- 1. vitals_readings.wearable_connection_id
--    CLAUDE.md's Device & Wearable Integration rule: a wearable metric that
--    HAS a vitals_readings equivalent (heart rate -> pulse, weight, SpO2)
--    goes to vitals_readings with source='wearable', NOT to a parallel
--    table; only metrics with no vital_type at all (steps, sleep, HRV,
--    recovery) belong in wearable_readings. vitals_readings already carries
--    device_id (BLE) and cgm_connection_id (CGM) for exactly this reason but
--    had no column tying a row back to the wearable connection that produced
--    it -- so 'wearable' was a source value with no provenance and, worse,
--    no dedupe key. A provider that redelivers a webhook (all of them retry)
--    would have silently double-written every overlapping reading.
--
-- 2. wearable_connections.sync_cursor
--    last_synced_at answers "when did we last hear from this provider",
--    which a webhook touches even when it carries no data. A pull-based
--    provider (Dexcom has no webhook mechanism at all -- its v3 API is
--    poll-only) needs the different question: "we hold data through when",
--    so a resumed poll asks for the right window instead of refetching from
--    the beginning or skipping a gap. Two questions, two columns.
--
-- 3. wearable_connections.last_sync_error
--    A refresh_token that a patient revoked provider-side fails forever and
--    silently. Recording why makes a dead connection visible instead of just
--    permanently quiet.
--
-- 4. Token columns are no longer readable OR writable by `authenticated`.
--    20260724001850's own comment says the tokens are "service-role
--    read/write only at the app layer; never surfaced to the client" -- but
--    that was an app-layer convention, not a grant. Confirmed against the
--    live project while writing this: `authenticated` held SELECT, INSERT
--    and UPDATE on access_token and refresh_token. Combined with a SELECT
--    policy admitting private.is_org_staff(), any staff account could read
--    every patient's live OAuth token for their Fitbit/WHOOP/Oura/Dexcom
--    account, and a patient could both read and overwrite their own.
--    Column-level grants make the comment true. (Per the platform's standing
--    default-privileges lesson, an added `grant` on specific columns does
--    NOT narrow an existing table-wide grant -- the table-level privilege
--    has to be revoked first, which is why the revoke below is not
--    redundant.)
--
-- 5. Connection rows are no longer patient-writable except for status.
--    The INSERT policy admitted a patient session, and nothing on the
--    platform ever used it -- every real connection is written by the OAuth
--    callback under service-role. Left open it was a genuine hole once
--    webhook ingestion resolves a connection by (provider, external_id):
--    a patient could insert a row claiming provider='fitbit' with someone
--    else's Fitbit ownerId and make that victim's webhook resolution
--    ambiguous, i.e. silently break their sync. Insert and delete narrow to
--    staff; update stays open to the patient (they must be able to
--    disconnect) but the column-level UPDATE grant in 4 limits them to
--    status/last_synced_at/last_sync_error, so the account link and the
--    sync cursor are unreachable from a patient session.

-- 1 --------------------------------------------------------------------
alter table public.vitals_readings
  add column if not exists wearable_connection_id uuid
    references public.wearable_connections (id) on delete set null;

comment on column public.vitals_readings.wearable_connection_id is
  'Set when source=''wearable'': the consumer-wearable connection this reading was pulled from. Provenance + the dedupe key for provider webhook redelivery. Null for every other source.';

-- Same partial-unique idiom as vitals_readings_device_dedupe_idx and
-- vitals_readings_cgm_dedupe_idx: a provider replaying a notification
-- re-derives the same external_reading_id, so the repeat insert is a clean
-- 23505 the ingestion path treats as an idempotent success.
create unique index if not exists vitals_readings_wearable_dedupe_idx
  on public.vitals_readings (wearable_connection_id, external_reading_id)
  where wearable_connection_id is not null and external_reading_id is not null;

-- 2, 3 -----------------------------------------------------------------
alter table public.wearable_connections
  add column if not exists sync_cursor timestamptz,
  add column if not exists last_sync_error text;

comment on column public.wearable_connections.sync_cursor is
  'High-water mark: readings are held through this instant. Distinct from last_synced_at (last contact of any kind, including a data-free webhook ping). Drives the resume window for pull-based providers such as Dexcom.';
comment on column public.wearable_connections.last_sync_error is
  'Last ingestion/refresh failure for this connection, or null when healthy. A provider-side token revocation otherwise fails silently forever.';

-- 4 --------------------------------------------------------------------
-- Verified against the live project before writing this: `authenticated`
-- held SELECT, INSERT *and* UPDATE on access_token and refresh_token. Read
-- was the exposure; write would have let a patient session plant a token of
-- their choosing on a connection. Tokens become service-role-only at the
-- privilege level, not merely by convention — every column except the three
-- token columns is re-granted.
revoke select, insert, update on public.wearable_connections from authenticated;

grant select (
  id, organisation_id, patient_id, provider, status, external_id,
  connected_at, last_synced_at, last_sync_error, sync_cursor, created_at
) on public.wearable_connections to authenticated;

grant insert (
  id, organisation_id, patient_id, provider, status, external_id,
  connected_at, last_synced_at, last_sync_error, sync_cursor, created_at
) on public.wearable_connections to authenticated;

grant update (
  status, last_synced_at, last_sync_error
) on public.wearable_connections to authenticated;

-- 5 --------------------------------------------------------------------
drop policy if exists wearable_connections_insert on public.wearable_connections;
create policy wearable_connections_insert on public.wearable_connections
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists wearable_connections_delete on public.wearable_connections;
create policy wearable_connections_delete on public.wearable_connections
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- No trigger accompanies this. An earlier draft added one to narrow which
-- columns a patient session may move ("RLS admits broadly, a trigger
-- narrows", as private.enforce_vitals_reading_source_lock does) — but that
-- pattern exists there because the rule depends on the OLD row's state
-- (its source). Here the rule is purely "which columns", which is precisely
-- what the column-level UPDATE grant above already expresses, declaratively
-- and without a function whose correctness depends on the subtlety that
-- current_user inside a SECURITY DEFINER function is the owner rather than
-- the caller. A patient may now change only status/last_synced_at/
-- last_sync_error on their own row, and nothing else, because those are the
-- only columns they hold UPDATE on.

-- Provable, not hopeful ------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vitals_readings'
      and column_name = 'wearable_connection_id'
  ) then
    raise exception 'vitals_readings.wearable_connection_id missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'vitals_readings_wearable_dedupe_idx'
  ) then
    raise exception 'vitals_readings_wearable_dedupe_idx missing';
  end if;

  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'wearable_connections'
      and column_name in ('sync_cursor', 'last_sync_error')
  ) <> 2 then
    raise exception 'wearable_connections sync_cursor/last_sync_error missing';
  end if;

  -- The point of the revoke: tokens must be unreadable by the API role
  -- while the non-sensitive columns stay readable.
  if has_column_privilege('authenticated', 'public.wearable_connections', 'access_token', 'SELECT') then
    raise exception 'authenticated can still read wearable_connections.access_token';
  end if;
  if has_column_privilege('authenticated', 'public.wearable_connections', 'refresh_token', 'SELECT') then
    raise exception 'authenticated can still read wearable_connections.refresh_token';
  end if;
  if not has_column_privilege('authenticated', 'public.wearable_connections', 'status', 'SELECT') then
    raise exception 'authenticated lost SELECT on wearable_connections.status';
  end if;

  -- Tokens must be unwritable as well as unreadable.
  if has_column_privilege('authenticated', 'public.wearable_connections', 'access_token', 'UPDATE')
     or has_column_privilege('authenticated', 'public.wearable_connections', 'access_token', 'INSERT') then
    raise exception 'authenticated can still write wearable_connections.access_token';
  end if;

  -- And a patient must not be able to move the account link or the cursor.
  if has_column_privilege('authenticated', 'public.wearable_connections', 'external_id', 'UPDATE') then
    raise exception 'authenticated can still update wearable_connections.external_id';
  end if;
  if has_column_privilege('authenticated', 'public.wearable_connections', 'sync_cursor', 'UPDATE') then
    raise exception 'authenticated can still update wearable_connections.sync_cursor';
  end if;
  if not has_column_privilege('authenticated', 'public.wearable_connections', 'status', 'UPDATE') then
    raise exception 'authenticated lost UPDATE on wearable_connections.status (disconnect would break)';
  end if;
end;
$$;
