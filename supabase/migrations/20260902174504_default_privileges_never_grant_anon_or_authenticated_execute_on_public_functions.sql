-- The "Supabase migration replay" CI job (`supabase db reset` against a
-- brand-new local Postgres, provisioned by the Supabase CLI's own Docker
-- image) has repeatedly tripped "anon/authenticated must never call X"
-- assertions that pass fine against the live koiplnmbgnqnbywhpjlf project --
-- most recently on PR #340, first at programme_purchases (a table), then
-- again at payments_with_payer_for_fraud_sweep (a function), even though
-- that function's own migration already carries an explicit
-- `revoke ... from public, anon, authenticated` right after creating it.
--
-- Root cause, proven directly on a real CI run rather than guessed at:
-- temporarily replaced that function's closing assertion with a RAISE
-- EXCEPTION that dumps pg_default_acl for schema public. Result (Supabase
-- migration replay run, 2026-09-02):
--   role=postgres type=f acl={postgres=X/postgres,anon=X/postgres,
--     authenticated=X/postgres,service_role=X/postgres}
-- i.e. the Supabase CLI's own local bootstrap -- outside any file in this
-- repo, the same "outside this repo" bootstrap already identified by
-- 20260731232750_default_privileges_never_grant_anon_on_public_tables.sql --
-- sets an explicit default-privilege row for role postgres in schema public
-- that grants EXECUTE on every future FUNCTION to anon and authenticated,
-- not just service_role. That migration only ever closed the equivalent gap
-- for TABLES (`revoke all on tables from anon`); it never covered
-- FUNCTIONS or SEQUENCES, so every function created since without its own
-- explicit per-function revoke is still anon/authenticated-executable by
-- default on a from-scratch reset, and any migration that happens to add
-- its own `has_function_privilege(...)` self-check on such a function will
-- intermittently fail CI depending only on whether that one migration
-- remembered the revoke -- not on any real environment difference, which is
-- why this has looked like unrelated, unconnected failures across several
-- PRs rather than one root cause.
--
-- Unlike tables, this codebase's own established convention for functions
-- is that every exposure is an explicit, per-function decision --
-- payments_with_payer_for_fraud_sweep's own comment says as much ("No grant
-- to authenticated/anon at all"), and the equivalent private-schema fix
-- (20260812003758_revoke_private_schema_execute_from_public.sql) revoked
-- PUBLIC's default execute there too. So this revokes the default from
-- BOTH anon and authenticated (not just anon, unlike the table-level fix,
-- where `authenticated` intentionally keeps its default grant because RLS
-- is the real gate on a table). Any function meant to be callable already
-- has, or will need, its own explicit `grant execute ... to authenticated`
-- -- same discipline already used everywhere in this codebase.
--
-- Sequences get the same treatment for the same reason: the CLI's own
-- bundled revoke script (RevokeDefaultDataApiPrivilegesSql in
-- supabase/cli's apps/cli-go/internal/db/start/start.go) treats tables,
-- sequences and functions as one group when it runs, so if it were skipped
-- or scoped differently than assumed, sequences would carry the same
-- default-grant gap as functions did. Closing it now rather than waiting
-- for a `nextval()`/`setval()` RPC to surface it the same way
-- programme_purchases and payments_with_payer_for_fraud_sweep did.
--
-- This is a from-here-forward fix, same as the tables migration it
-- completes: ALTER DEFAULT PRIVILEGES only changes what gets granted to
-- objects created *after* it runs, by the specifying role. It does not
-- retroactively audit every already-existing public-schema function --
-- that is the same class of sweep 20260812003758 needed for the private
-- schema (~230 of 264 functions were found anon-executable there) and is
-- out of scope for this fix, which exists to make the CI replay job
-- accurately reflect live privilege state, not to re-run that audit for
-- public.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

do $$
declare
  v_current_user text;
  v_session_user text;
  v_proowner text;
  v_proacl text;
  v_default_acl text;
begin
  create function public._default_priv_probe_fn_20260902174504()
    returns void language sql as $probe$ select 1 $probe$;
  create sequence public._default_priv_probe_seq_20260902174504;

  select current_user, session_user into v_current_user, v_session_user;
  select proowner::regrole::text, proacl::text into v_proowner, v_proacl from pg_proc
   where oid = 'public._default_priv_probe_fn_20260902174504()'::regprocedure;
  select string_agg(format('role=%s ns=%s type=%s acl=%s', coalesce(defaclrole::regrole::text,'(none)'), coalesce(defaclnamespace::regnamespace::text,'(db-wide)'), defaclobjtype, defaclacl::text), ' | ')
    into v_default_acl
    from pg_default_acl
   where defaclobjtype = 'f';

  if has_function_privilege('anon', 'public._default_priv_probe_fn_20260902174504()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._default_priv_probe_fn_20260902174504()', 'EXECUTE') then
    drop function public._default_priv_probe_fn_20260902174504();
    drop sequence public._default_priv_probe_seq_20260902174504;
    raise exception 'FAIL: anon/authenticated still get a default EXECUTE privilege on a brand-new public-schema function. DIAG current_user=% session_user=% proowner=% proacl=% default_acl_f(all_ns)=%',
      v_current_user, v_session_user, v_proowner, v_proacl, v_default_acl;
  end if;

  if has_sequence_privilege('anon', 'public._default_priv_probe_seq_20260902174504', 'USAGE')
     or has_sequence_privilege('authenticated', 'public._default_priv_probe_seq_20260902174504', 'USAGE') then
    drop function public._default_priv_probe_fn_20260902174504();
    drop sequence public._default_priv_probe_seq_20260902174504;
    raise exception 'FAIL: anon/authenticated still get a default USAGE privilege on a brand-new public-schema sequence';
  end if;

  drop function public._default_priv_probe_fn_20260902174504();
  drop sequence public._default_priv_probe_seq_20260902174504;
  raise notice 'PASS: anon/authenticated get no default privilege on future public-schema functions or sequences (proved on real probe objects)';
end $$;
