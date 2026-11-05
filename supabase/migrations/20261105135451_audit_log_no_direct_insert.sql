-- Step 2 of 2 for master architecture assessment finding S2: no signed-in caller writes audit_log directly any more.
--
-- Step 1 (20261105103048_audit_log_writes_through_record_audit_event, PR #1736, live 2026-11-05) added
-- public.record_audit_event / record_audit_events and narrowed the direct INSERT policy to actor_id = auth.uid(), so that a build
-- still inserting directly kept working during the deploy. That build is gone: every session call site now uses the functions, and
-- a standing scan (apps/web/src/lib/audit/audit-log-reader-scan.test.ts) refuses a new session-client insert.
--
-- Checked against live before writing this (2026-11-05):
--   * No SECURITY INVOKER function in any schema inserts into audit_log (all 376 writers are SECURITY DEFINER, owned by postgres,
--     so neither the policy nor the grant applies to them).
--   * No view over audit_log exists that a client could insert through.
--   * Every remaining app insert uses the service-role client (bypasses RLS and grants).
--
-- This migration drops the transitional policy and revokes INSERT from authenticated (and anon, defensively). SELECT is unchanged:
-- the existing read policies still decide who sees which rows.

drop policy if exists audit_log_insert_self_only on public.audit_log;
drop policy if exists audit_log_insert on public.audit_log;

revoke insert on public.audit_log from authenticated, anon;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and cmd in ('INSERT', 'ALL')
  ) then
    raise exception 'audit_log still has an INSERT policy';
  end if;
  if has_table_privilege('authenticated', 'public.audit_log', 'INSERT')
     or has_table_privilege('anon', 'public.audit_log', 'INSERT') then
    raise exception 'a client role can still insert into audit_log';
  end if;
  if not has_function_privilege('authenticated', 'public.record_audit_event(text, text, uuid, uuid, jsonb, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_audit_events(text, jsonb)', 'EXECUTE') then
    raise exception 'the audit writer functions must stay callable by authenticated';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema') and not p.prosecdef
      and p.prosrc ~* 'insert\s+into\s+(public\.)?audit_log'
  ) then
    raise exception 'a SECURITY INVOKER function inserts into audit_log and would now fail';
  end if;
end;
$$;
