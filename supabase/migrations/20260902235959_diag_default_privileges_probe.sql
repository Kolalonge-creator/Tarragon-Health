-- TEMPORARY DIAGNOSTIC MIGRATION -- not for merge.
--
-- 20260902174504's own self-test (create a probe function, assert
-- anon/authenticated get no default EXECUTE) fails on a real "Supabase
-- migration replay" CI run even though that migration's ALTER DEFAULT
-- PRIVILEGES already includes `public` in the revoke list (the fix for the
-- standard anon-execute-via-PUBLIC gotcha). This migration dumps the actual
-- role identity and pg_default_acl/pg_proc state during a real CI replay so
-- the root cause can be read directly from the GitHub Actions log, instead
-- of guessed at. See the standing "ALTER DEFAULT PRIVILEGES does not
-- reliably work on this project" finding for the `private` schema -- this
-- either confirms the same mechanism applies to `public`, or finds a new one.
do $$
declare
  v_current_user text := current_user;
  v_session_user text := session_user;
  v_current_role text := current_role;
  r record;
  v_found_default_acl boolean := false;
begin
  raise notice 'DIAG identity: current_user=%, session_user=%, current_role=%',
    v_current_user, v_session_user, v_current_role;

  for r in
    select defaclrole::regrole::text as role,
           defaclnamespace::regnamespace::text as schema,
           defaclobjtype as objtype,
           defaclacl::text as acl
    from pg_default_acl
    where defaclnamespace = 'public'::regnamespace
  loop
    v_found_default_acl := true;
    raise notice 'DIAG pg_default_acl row: role=%, schema=%, objtype=%, acl=%',
      r.role, r.schema, r.objtype, r.acl;
  end loop;

  if not v_found_default_acl then
    raise notice 'DIAG pg_default_acl: NO ROWS AT ALL for schema public -- the ALTER DEFAULT PRIVILEGES in 20260902174504 left no trace';
  end if;

  create function public._diag_probe_fn_20260902235959()
    returns void language sql as $probe$ select 1 $probe$;
  create sequence public._diag_probe_seq_20260902235959;

  raise notice 'DIAG probe fn: proowner=%, proacl=%',
    (select proowner::regrole::text from pg_proc where proname = '_diag_probe_fn_20260902235959'),
    (select proacl::text from pg_proc where proname = '_diag_probe_fn_20260902235959');
  raise notice 'DIAG probe seq: seqowner=%, relacl=%',
    (select relowner::regrole::text from pg_class where relname = '_diag_probe_seq_20260902235959'),
    (select relacl::text from pg_class where relname = '_diag_probe_seq_20260902235959');

  raise notice 'DIAG has_function_privilege(anon, EXECUTE)=%, has_function_privilege(authenticated, EXECUTE)=%',
    has_function_privilege('anon', 'public._diag_probe_fn_20260902235959()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public._diag_probe_fn_20260902235959()', 'EXECUTE');

  -- Second probe: re-issue the same ALTER DEFAULT PRIVILEGES statement using
  -- FOR ROLE CURRENT_USER instead of the hardcoded FOR ROLE postgres, in
  -- case the replay session's creating role differs from the literal string
  -- 'postgres' used in 20260902174504.
  execute format(
    'alter default privileges for role %I in schema public revoke execute on functions from public, anon, authenticated',
    v_current_user
  );

  drop function public._diag_probe_fn_20260902235959();
  drop sequence public._diag_probe_seq_20260902235959;

  create function public._diag_probe_fn2_20260902235959()
    returns void language sql as $probe$ select 1 $probe$;

  raise notice 'DIAG probe fn2 (after FOR ROLE %): proacl=%, has_exec_anon=%, has_exec_authenticated=%',
    v_current_user,
    (select proacl::text from pg_proc where proname = '_diag_probe_fn2_20260902235959'),
    has_function_privilege('anon', 'public._diag_probe_fn2_20260902235959()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public._diag_probe_fn2_20260902235959()', 'EXECUTE');

  drop function public._diag_probe_fn2_20260902235959();
end $$;
