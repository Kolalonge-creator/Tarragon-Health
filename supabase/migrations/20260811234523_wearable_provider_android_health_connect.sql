-- Tarragon Health
-- Adds the Android peer to the Apple Health ingestion path
-- (apps/mobile/src/lib/health-connect.ts, api/mobile/health-samples/route.ts).
--
-- Same device-local shape as apple_health per CLAUDE.md's Device & Wearable
-- Integration section: Health Connect has no cloud OAuth API either, so the
-- phone reads it and uploads through the same route, distinguished by a
-- `provider` field rather than a second endpoint.
--
-- This is the only schema change the Android bridge needs. It deliberately
-- does NOT add a token-based sync-cursor column for Health Connect's own
-- getChanges()/changesToken API — wearable_connections.sync_cursor is
-- timestamptz (added by 20260808030359_wearable_pull_ingestion.sql for
-- Apple Health/Dexcom's own timestamp-window resume pattern), and an opaque
-- changes-token doesn't fit that column. The Android bridge reuses the
-- exact same timestamp-window incremental sync Apple Health already does
-- (readRecords between last-synced and now) instead, which needed no schema
-- change at all — see the design notes in the mobile background-sync work
-- this migration ships alongside.
alter type public.wearable_provider add value if not exists 'android_health_connect';

-- Provable, not hopeful ------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'wearable_provider'
      and e.enumlabel = 'android_health_connect'
  ) then
    raise exception 'wearable_provider is missing the android_health_connect value';
  end if;
end;
$$;
