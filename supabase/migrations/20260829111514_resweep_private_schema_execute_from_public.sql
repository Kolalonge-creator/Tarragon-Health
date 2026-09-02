-- Re-closes the anon-inherits-EXECUTE-via-PUBLIC gap in the `private` schema. Migration
-- 20260812003758_revoke_private_schema_execute_from_public.sql fixed this for every private.*
-- function that existed on 2026-08-12 and added `alter default privileges in schema private
-- revoke execute on functions from public` so it believed future functions would be born closed.
--
-- Found live-drifted again 2026-08-29 while building the anon-EXECUTE CI check
-- (scripts/release-integrity/check-anon-security-definer-execute.mjs): ~90 private.* functions
-- created since 08-12 are anon-executable, of which ~14 are actually invokable directly (the rest
-- are trigger functions -- RETURNS TRIGGER/EVENT_TRIGGER -- which Postgres refuses to call
-- outside trigger context regardless of grant, so they carry the grant but aren't reachable).
-- Confirmed still not reachable via the app's REST API (private is not in PostgREST's exposed
-- schema list), so this is defense-in-depth rather than an active breach -- but one of the
-- invokable functions, private.real_patient_ids(), returns every real patient's UUID with no
-- filter and no internal caller check, trusting the grant boundary alone.
--
-- IMPORTANT correction to the 08-12 migration's own assumption: `alter default privileges ...
-- revoke execute on functions from public` does NOT reliably prevent the implicit PUBLIC EXECUTE
-- grant on this project. Verified three independent ways in the same investigation that found
-- this drift: (1) the existing 08-12 default-acl entry for private/postgres, committed 17 days
-- ago, does not stop a brand new function from getting PUBLIC; (2) re-issuing the same two ALTER
-- DEFAULT PRIVILEGES statements immediately before CREATE FUNCTION, in the same transaction,
-- still results in PUBLIC in the function's proacl; (3) a brand-new scratch schema, created and
-- given its own fresh default-privileges entry in the same transaction, shows the identical
-- result. Root cause not identified (Postgres 17.6; no event trigger or pg_cron job found that
-- would explain it) -- but empirically, ALTER DEFAULT PRIVILEGES is not a working preventive
-- control here for this bug, only the CI check is. Do not add an equivalent ALTER DEFAULT
-- PRIVILEGES statement for the public schema expecting it to prevent recurrence there either.
--
-- Fix: re-run the same sweep as 08-12 -- revoke EXECUTE from PUBLIC on every private.* function,
-- re-granting authenticated/service_role only where they already had it, so nothing currently
-- working regresses. Going forward, the CI check (now scoped to both public and private, see the
-- same commit) is what actually catches the next drift, since the schema default cannot be
-- trusted to.
--
-- Also revokes directly from anon, not just public: private.has_permission(text) -- the RBAC
-- check called from dozens of RLS policies across the platform as `private.is_admin() or
-- private.has_permission(...)` -- turned up with a DIRECT anon=X grant in its proacl, not just
-- the inherited PUBLIC one, and traces to no migration anywhere in git history (the same
-- no-migration-record failure mode CLAUDE.md documents for private.guard_profiles_self_update()).
-- `revoke ... from public` alone does not touch a direct grant, so the sweep below revokes from
-- both. Functional risk was low either way (has_permission scopes to auth.uid(), which is null
-- for anon, so it always resolved to false) but it's the same category of bug and the CI check
-- would otherwise have to carry a permanent, unexplained allowlist entry for it.
do $$
declare
  r record;
  v_auth_before int;
  v_svc_before int;
  v_auth_after int;
  v_svc_after int;
  v_anon_after int;
begin
  select
    count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE'))
  into v_auth_before, v_svc_before
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prokind = 'f';

  for r in
    select p.oid,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_had,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as svc_had
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', r.oid::regprocedure);
    if r.auth_had then
      execute format('grant execute on function %s to authenticated', r.oid::regprocedure);
    end if;
    if r.svc_had then
      execute format('grant execute on function %s to service_role', r.oid::regprocedure);
    end if;
  end loop;

  select
    count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
    count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE')),
    count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))
  into v_auth_after, v_svc_after, v_anon_after
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prokind = 'f';

  if v_auth_after <> v_auth_before then
    raise exception 'authenticated execute count changed: % -> % (should be identical)', v_auth_before, v_auth_after;
  end if;
  if v_svc_after <> v_svc_before then
    raise exception 'service_role execute count changed: % -> % (should be identical)', v_svc_before, v_svc_after;
  end if;
  if v_anon_after <> 0 then
    raise exception 'anon can still execute % private functions after revoke (should be 0)', v_anon_after;
  end if;
end $$;
