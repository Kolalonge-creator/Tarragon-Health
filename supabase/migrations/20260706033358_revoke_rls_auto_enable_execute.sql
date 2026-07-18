-- rls_auto_enable() is an event-trigger function (fires on CREATE TABLE in
-- public schema); it is never meant to be invoked directly. Leaving default
-- EXECUTE grants in place exposes it as a public RPC endpoint
-- (/rest/v1/rpc/rls_auto_enable) with no legitimate use, flagged by Supabase's
-- security advisor.
revoke execute on function public.rls_auto_enable() from public;
