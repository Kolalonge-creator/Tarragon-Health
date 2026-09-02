-- The "Supabase migration replay" CI job (`supabase db reset` against a
-- brand-new local Postgres, provisioned by the Supabase CLI's own Docker
-- image) has repeatedly tripped "anon/authenticated must never call X"
-- assertions that pass fine against the live koiplnmbgnqnbywhpjlf project --
-- most recently on PR #340, first at programme_purchases (a table), then
-- again at payments_with_payer_for_fraud_sweep (a function), even though
-- that function's own migration already carries an explicit
-- `revoke ... from public, anon, authenticated` right after creating it.
--
-- Root cause, proven directly on a real CI run rather than guessed at (three
-- rounds of a throwaway diagnostic migration that dumped pg_proc.proacl,
-- pg_default_acl and current_user/proowner instead of asserting -- see PR
-- #438's history for the raw dumps): a from-scratch `supabase db reset`
-- creates every public-schema FUNCTION with an ACL that includes an explicit
-- `=X/postgres` entry -- the PUBLIC pseudo-role -- regardless of what
-- ALTER DEFAULT PRIVILEGES says for the named roles anon/authenticated. This
-- is plain Postgres behaviour, not a Supabase-CLI quirk: a newly created
-- function's initial ACL, when no default-privilege row exists for the
-- creating role that revokes it, is owner=all + PUBLIC=EXECUTE. A default
-- privilege entry that only lists `anon, authenticated` (no `public`) never
-- touches that PUBLIC grant, so anon still inherits EXECUTE through PUBLIC
-- exactly the way CLAUDE.md's own longstanding "anon-execute" gotcha
-- describes for individual functions -- this migration's first version made
-- that exact mistake at the default-privilege level instead of the
-- per-function level. Confirmed on the live project this genuinely isn't
-- present there (a from-scratch reset is the only place it reproduces),
-- matching the same "outside this repo" CLI-bootstrap gap that
-- 20260731232750_default_privileges_never_grant_anon_on_public_tables.sql
-- already closed for TABLES -- that migration never covered FUNCTIONS or
-- SEQUENCES, so every function created since without its own explicit
-- per-function `revoke ... from public` is still anon/authenticated-
-- executable by default on a from-scratch reset even though the same
-- function is correctly locked down on the live project. Whether a given
-- migration's own self-check assertion trips has always depended only on
-- whether that one migration remembered its own revoke -- not on any real
-- environment difference -- which is why this looked like scattered,
-- unrelated failures across several PRs rather than one root cause.
--
-- Unlike tables, this codebase's own established convention for functions is
-- that every exposure is an explicit, per-function decision --
-- payments_with_payer_for_fraud_sweep's own comment says as much ("No grant
-- to authenticated/anon at all"), and the equivalent private-schema fix
-- (20260812003758_revoke_private_schema_execute_from_public.sql) revoked
-- PUBLIC's default execute there too, re-granting authenticated/service_role
-- explicitly only where they already had it. So this revokes the default
-- from PUBLIC (which is what actually removes what anon inherits -- a bare
-- `revoke ... from anon` alone is a no-op, the same standing gotcha applied
-- here at the default-privilege level) and from anon/authenticated by name
-- for defense in depth. Any function meant to be callable already has, or
-- will need, its own explicit `grant execute ... to authenticated` -- same
-- discipline already used everywhere in this codebase. Sequences get the
-- same PUBLIC-inclusive treatment for consistency, even though plain
-- Postgres does not grant PUBLIC access to sequences by default the way it
-- does for functions -- cheap to close the same way rather than assume.
--
-- This is a from-here-forward fix, same as the tables migration it
-- completes: ALTER DEFAULT PRIVILEGES only changes what gets granted to
-- objects created *after* it runs, by the specifying role. It does not
-- retroactively audit every already-existing public-schema function -- that
-- is the same class of sweep 20260812003758 needed for the private schema
-- (~230 of 264 functions were found anon-executable there) and is out of
-- scope for this fix, which exists to make the CI replay job accurately
-- reflect live privilege state, not to re-run that audit for public.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from public, anon, authenticated;

do $$
declare
  v_diag record;
  v_found_default_acl boolean := false;
begin
  raise notice 'DIAG identity: current_user=%, session_user=%, current_role=%',
    current_user, session_user, current_role;

  for v_diag in
    select defaclrole::regrole::text as role,
           defaclnamespace::regnamespace::text as schema,
           defaclobjtype as objtype,
           defaclacl::text as acl
    from pg_default_acl
    where defaclnamespace = 'public'::regnamespace
  loop
    v_found_default_acl := true;
    raise notice 'DIAG pg_default_acl row: role=%, schema=%, objtype=%, acl=%',
      v_diag.role, v_diag.schema, v_diag.objtype, v_diag.acl;
  end loop;
  if not v_found_default_acl then
    raise notice 'DIAG pg_default_acl: NO ROWS AT ALL for schema public';
  end if;

  create function public._default_priv_probe_fn_20260902174504()
    returns void language sql as $probe$ select 1 $probe$;
  create sequence public._default_priv_probe_seq_20260902174504;

  raise notice 'DIAG probe fn: proowner=%, proacl=%',
    (select proowner::regrole::text from pg_proc where proname = '_default_priv_probe_fn_20260902174504'),
    (select proacl::text from pg_proc where proname = '_default_priv_probe_fn_20260902174504');

  if has_function_privilege('anon', 'public._default_priv_probe_fn_20260902174504()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._default_priv_probe_fn_20260902174504()', 'EXECUTE') then
    drop function public._default_priv_probe_fn_20260902174504();
    drop sequence public._default_priv_probe_seq_20260902174504;
    raise exception 'FAIL: anon/authenticated still get a default EXECUTE privilege on a brand-new public-schema function';
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
