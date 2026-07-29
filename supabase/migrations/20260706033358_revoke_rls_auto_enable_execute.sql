-- rls_auto_enable() is an event-trigger function (fires on CREATE TABLE in
-- public schema); it is never meant to be invoked directly. Leaving default
-- EXECUTE grants in place exposes it as a public RPC endpoint
-- (/rest/v1/rpc/rls_auto_enable) with no legitimate use, flagged by Supabase's
-- security advisor.
--
-- 2026-07-29: made conditional. public.rls_auto_enable() is never created by any
-- committed migration in this repository -- it was created directly against the
-- original remote database and the DDL was never committed, so this REVOKE only
-- ever succeeded because that out-of-band function happened to exist there.
-- Replaying this history into a fresh project failed here with
-- "failed to execute statement". Guarding on pg_proc keeps the hardening intent
-- where the function exists and makes it a correct no-op where it does not.
--
-- NOTE: consequently a rebuilt database has NO rls_auto_enable event trigger.
-- If that auto-enable-RLS-on-new-table behaviour is still wanted, it must be
-- written as a real migration -- do not reconstruct it from this comment.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and p.pronargs = 0
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public';
  end if;
end
$$;
