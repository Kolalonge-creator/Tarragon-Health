-- private schema EXECUTE grants have relied on Postgres's default PUBLIC
-- grant since schema creation, because no ALTER DEFAULT PRIVILEGES was ever
-- set for it -- the same class of gap as the historical missing
-- `grant ... to authenticated` on new tables, but for function EXECUTE
-- instead of table DML. Six prior migrations
-- (revoke_public_execute_has_ai_coach_access,
-- revoke_anon_execute_has_ai_coach_access,
-- security_hardening_anon_rpc_revoke, revoke_anon_execute_sensitive_rpcs,
-- revoke_anon_execute_on_security_definer_rpcs,
-- revoke_anon_lab_partner_rpcs / revoke_public_execute_lab_partner_rpcs)
-- each revoked a handful of named functions, but none set a schema-level
-- default, so every function created since -- and several created before,
-- never covered by those point-fixes -- is still anon-executable via PUBLIC
-- today. Confirmed live in the 2026-08-12 DB/RLS integrity audit: ~230 of
-- 264 private.* functions were still anon-executable this way. Not
-- currently reachable through the app's REST API (private is not in
-- PostgREST's exposed schema list -- verified live against the anon key,
-- POST /rest/v1/rpc/hbpm_average returns PGRST202, "not found in schema
-- cache"), but it's a real defense-in-depth gap, inconsistent with this
-- project's own established practice of explicit revokes elsewhere, and one
-- misconfiguration away from mattering -- several of the reachable
-- functions (private.hbpm_average, private.patient_home_bp_target,
-- private.issue_reward_voucher, private.finance_post_journal, among others)
-- take an arbitrary patient/beneficiary uuid with no internal
-- caller-identity check, trusting the grant boundary alone.
--
-- Fix: revoke EXECUTE from PUBLIC on every existing private.* function, and
-- set ALTER DEFAULT PRIVILEGES so future ones are born closed too. Per
-- function, authenticated/service_role are re-granted EXECUTE explicitly
-- only where they already had it -- snapshotted immediately below, before
-- anything is revoked -- so nothing currently working (RLS-policy calls
-- like is_org_staff/can_read_clinical, wrapper RPCs) regresses. Functions
-- authenticated could not already call (mostly pg_cron-only
-- queue_*/expire_*/escalate_* jobs plus a handful of internal helpers,
-- already correctly tightened by past point-fix migrations) stay exactly as
-- locked down as they are today -- this migration only closes the
-- PUBLIC/anon hole, it does not loosen anything.
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
    execute format('revoke execute on function %s from public', r.oid::regprocedure);
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

alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private grant execute on functions to authenticated, service_role;
