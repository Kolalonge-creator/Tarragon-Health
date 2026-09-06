-- The "Supabase migration replay" CI job (`supabase db reset` against a
-- brand-new local Postgres, provisioned by the Supabase CLI's own Docker
-- image) has repeatedly tripped "anon/authenticated must never call X"
-- assertions that pass fine against the live koiplnmbgnqnbywhpjlf project --
-- most recently on PR #340, first at programme_purchases (a table), then
-- again at payments_with_payer_for_fraud_sweep (a function), even though
-- that function's own migration already carries an explicit
-- `revoke ... from public, anon, authenticated` right after creating it.
--
-- Root cause, proven directly on a real CI run rather than guessed at (seven
-- rounds of throwaway diagnostic migrations across this PR's history that
-- dumped pg_proc.proacl, pg_default_acl, current_user/proowner, and finally
-- pg_event_trigger -- see PR #438's history for the raw dumps): this has
-- NOTHING to do with ALTER DEFAULT PRIVILEGES being misconfigured. The
-- Supabase CLI's own local bootstrap installs several event triggers that
-- fire on every `ddl_command_end`:
--   issue_pg_graphql_access (fn grant_pg_graphql_access)
--   issue_pg_cron_access    (fn grant_pg_cron_access)
--   issue_pg_net_access     (fn grant_pg_net_access)
-- These exist so a table/function created by a plain migration is
-- automatically reachable through pg_graphql/pg_cron/pg_net without a
-- manual grant -- deliberate Supabase platform behaviour, not a bug. But
-- they run AFTER the CREATE FUNCTION statement completes, in the same
-- transaction, and unconditionally (re-)grant PUBLIC/anon/authenticated
-- access to the object they just saw created. ALTER DEFAULT PRIVILEGES only
-- controls the object's ACL at the moment of creation -- it has already lost
-- by the time these event triggers fire a moment later. Three different
-- attempts confirmed this empirically: a plain `revoke ... from
-- anon, authenticated`, then also revoking from PUBLIC by name, then even
-- forcing an explicit PUBLIC aclitem to exist first via GRANT-then-REVOKE --
-- all three produced the identical final ACL
-- `{=X/postgres,postgres=X/postgres,service_role=X/postgres}` on a freshly
-- created probe function. What DOES work, confirmed on the same real CI run:
-- an explicit, PER-OBJECT `revoke ... from public, anon, authenticated`
-- issued AFTER creation -- because nothing runs after that to re-grant it.
-- This is exactly this codebase's own already-established convention
-- (payments_with_payer_for_fraud_sweep's own comment: "No grant to
-- authenticated/anon at all", and the private-schema sweep in
-- 20260812003758_revoke_private_schema_execute_from_public.sql) -- it was
-- never actually broken, just not universally followed. Confirmed on the
-- live koiplnmbgnqnbywhpjlf project this class of failure doesn't
-- reproduce, most likely because these event triggers either aren't present
-- there in the same form or every existing function already carries its own
-- per-function revoke from historical migration discipline -- not because
-- ALTER DEFAULT PRIVILEGES behaves any differently there.
--
-- ALTER DEFAULT PRIVILEGES is kept below anyway, for the cases it still
-- helps: it correctly narrows the underlying pg_default_acl row so
-- anon/authenticated are no longer named there by the Supabase CLI's own
-- bootstrap (confirmed via direct pg_default_acl dumps), which is real
-- defense in depth for any code path that inspects that catalog directly
-- rather than an object's actual resulting ACL, and matches the equivalent,
-- already-shipped, working TABLES fix
-- (20260731232750_default_privileges_never_grant_anon_on_public_tables.sql)
-- -- tables are not created via a CREATE-then-event-trigger-grants sequence
-- the same way, so that fix's mechanism is unaffected by this discovery.
-- Sequences get the same treatment for consistency, even though plain
-- Postgres does not grant PUBLIC access to sequences by default the way it
-- does for functions.
--
-- This migration cannot, and no longer tries to, make ALTER DEFAULT
-- PRIVILEGES alone prevent anon/authenticated access on a brand-new public-
-- schema function -- that is structurally impossible while these event
-- triggers exist, on this CLI's local bootstrap. Any function meant to be
-- non-callable by anon/authenticated needs its own explicit
-- `revoke execute on function ... from public, anon, authenticated` issued
-- immediately after `CREATE FUNCTION`, every time -- same discipline already
-- used everywhere in this codebase. The self-test below proves that this
-- discipline, not ALTER DEFAULT PRIVILEGES, is what actually closes the gap,
-- so a future migration copying this pattern doesn't fall into the same
-- trap this one started in.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from public, anon, authenticated;

do $$
declare
  v_naive_still_executable boolean;
begin
  -- Sabotage-proves the root cause itself: a brand-new function with NO
  -- explicit per-object revoke is executable by anon/authenticated
  -- regardless of the ALTER DEFAULT PRIVILEGES statements above -- this is
  -- expected, documented behaviour (the event-trigger re-grant), not a
  -- failure. If this ever stops being true (e.g. a future Supabase CLI
  -- release changes the event-trigger behaviour), this assertion will start
  -- failing loudly, which is exactly the signal that it's safe to revisit
  -- whether the per-function revoke discipline below is still required.
  create function public._default_priv_probe_naive_20260902174504()
    returns void language sql as $probe$ select 1 $probe$;

  v_naive_still_executable := has_function_privilege('anon', 'public._default_priv_probe_naive_20260902174504()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._default_priv_probe_naive_20260902174504()', 'EXECUTE');

  drop function public._default_priv_probe_naive_20260902174504();

  if not v_naive_still_executable then
    raise exception 'UNEXPECTED: a brand-new public-schema function with no explicit per-object revoke is no longer anon/authenticated-executable -- the event-trigger re-grant this migration documents may no longer apply. Safe to revisit whether the per-function revoke discipline below is still required.';
  end if;

  -- Proves the actual mitigation: an explicit per-object revoke, issued
  -- immediately after creation, reliably closes it -- because nothing runs
  -- after it to re-grant. This is the pattern every function/sequence going
  -- forward must follow.
  create function public._default_priv_probe_fn_20260902174504()
    returns void language sql as $probe$ select 1 $probe$;
  create sequence public._default_priv_probe_seq_20260902174504;
  revoke execute on function public._default_priv_probe_fn_20260902174504() from public, anon, authenticated;
  revoke usage, select on sequence public._default_priv_probe_seq_20260902174504 from public, anon, authenticated;

  if has_function_privilege('anon', 'public._default_priv_probe_fn_20260902174504()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._default_priv_probe_fn_20260902174504()', 'EXECUTE') then
    drop function public._default_priv_probe_fn_20260902174504();
    drop sequence public._default_priv_probe_seq_20260902174504;
    raise exception 'FAIL: anon/authenticated still get EXECUTE on a public-schema function even after an explicit per-object revoke';
  end if;

  if has_sequence_privilege('anon', 'public._default_priv_probe_seq_20260902174504', 'USAGE')
     or has_sequence_privilege('authenticated', 'public._default_priv_probe_seq_20260902174504', 'USAGE') then
    drop function public._default_priv_probe_fn_20260902174504();
    drop sequence public._default_priv_probe_seq_20260902174504;
    raise exception 'FAIL: anon/authenticated still get USAGE on a public-schema sequence even after an explicit per-object revoke';
  end if;

  drop function public._default_priv_probe_fn_20260902174504();
  drop sequence public._default_priv_probe_seq_20260902174504;
  raise notice 'PASS: an explicit per-object revoke immediately after CREATE reliably locks a public-schema function/sequence down from anon/authenticated (proved on real probe objects)';
end $$;
