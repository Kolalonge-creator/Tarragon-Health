-- wearable_connections has had correct RLS policies since 20260714140000
-- (select/update: patient_id = auth.uid() OR is_org_staff; insert: is_org_staff;
-- delete: is_org_staff) but was never given the matching table-level grant to
-- `authenticated` — the same "RLS restricts rows, it does not grant table
-- access" gap this project has hit repeatedly (see
-- reference_authenticated_table_grants_root_cause). Only DELETE ended up
-- granted (likely a partial manual fix at some point); SELECT/INSERT/UPDATE
-- never were.
--
-- Confirmed live-broken by reading the actual call sites, not just the grant
-- table: apps/web/src/lib/queries/wearable-connections.ts uses the browser
-- (authenticated-session) Supabase client for both `useWearableConnections`
-- (a SELECT) and `useDisconnectWearable` (an UPDATE of status to
-- 'disconnected') — patients hit a permission error on both every time,
-- since neither SELECT nor UPDATE was ever granted. INSERT stays
-- unaffected by this migration's read path change, but is added here too
-- since the RLS policy for it already exists and nothing should rely on the
-- current accidental lockout.
grant select, insert, update on public.wearable_connections to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'wearable_connections'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'wearable_connections did not get authenticated SELECT';
  end if;

  if not exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'wearable_connections'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'wearable_connections did not get authenticated UPDATE';
  end if;
end $$;
