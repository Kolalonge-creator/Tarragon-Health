-- Proof for 20260924215642_fix_account_lockouts_anon_execute_and_backfill_migration_record.sql
-- and its same-day follow-up 20260924221235_fix_set_updated_at_search_path_regression.sql.
--
-- Two things to prove, both found by a live Release Integrity CI failure:
--
-- 1. public.is_account_locked / public.is_account_locked_by_phone must not be
--    anon-executable (the anon-inherits-EXECUTE-via-PUBLIC gotcha — see the
--    supabase-anon-execute-gotcha memory; this is at least the 6th time this
--    class of bug has shipped). `authenticated` must retain EXECUTE.
--
-- 2. private.set_updated_at() — the shared updated_at trigger reused by
--    ~280 tables platform-wide — must keep `search_path` pinned. The first
--    version of migration 20260924215642 redefined this shared function
--    while copying in unrelated table-specific functions and silently
--    dropped the pin; caught by /code-review high before merge, fixed same
--    day. This proof exists so that class of mistake (touching a shared
--    function as a side effect of an unrelated migration) fails CI loudly
--    instead of shipping again.
--
-- Both checks include a sabotage step: deliberately break the property,
-- confirm the assertion that should catch it actually does, then restore —
-- a check that cannot fail is not a check.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/account_lockouts_anon_execute_and_search_path.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

do $$
declare
  v_search_path_pinned boolean;
begin
  -- =========================================================================
  -- 1. anon must not execute either function; authenticated must.
  -- =========================================================================
  if has_function_privilege('anon', 'public.is_account_locked(text)', 'execute') then
    raise exception 'REGRESSION: anon can execute public.is_account_locked — the anon-execute gotcha is back';
  end if;
  if has_function_privilege('anon', 'public.is_account_locked_by_phone(text)', 'execute') then
    raise exception 'REGRESSION: anon can execute public.is_account_locked_by_phone — the anon-execute gotcha is back';
  end if;
  if not has_function_privilege('authenticated', 'public.is_account_locked(text)', 'execute') then
    raise exception 'authenticated lost EXECUTE on public.is_account_locked';
  end if;
  if not has_function_privilege('authenticated', 'public.is_account_locked_by_phone(text)', 'execute') then
    raise exception 'authenticated lost EXECUTE on public.is_account_locked_by_phone';
  end if;

  -- Sabotage: prove the check above would actually catch the regression it
  -- exists to catch, not just pass vacuously.
  grant execute on function public.is_account_locked(text) to anon;
  if not has_function_privilege('anon', 'public.is_account_locked(text)', 'execute') then
    raise exception 'sabotage setup failed — grant to anon did not take, this proof is not discriminating';
  end if;
  revoke execute on function public.is_account_locked(text) from anon;
  if has_function_privilege('anon', 'public.is_account_locked(text)', 'execute') then
    raise exception 'sabotage cleanup failed — anon still has EXECUTE after revoke';
  end if;

  -- =========================================================================
  -- 2. private.set_updated_at() must keep search_path pinned — this is the
  --    shared trigger ~280 tables' own updated_at triggers depend on.
  -- =========================================================================
  select array_to_string(proconfig, ',') like '%search_path=%'
    into v_search_path_pinned
    from pg_proc
    where pronamespace = 'private'::regnamespace and proname = 'set_updated_at';

  if v_search_path_pinned is not true then
    raise exception 'REGRESSION: private.set_updated_at() lost its search_path pin — this affects every table using it as an updated_at trigger';
  end if;

  -- Sabotage: prove this check discriminates too, by reproducing the exact
  -- regression (redefine without the pin), checking it's caught, then
  -- restoring the correct definition.
  create or replace function private.set_updated_at()
  returns trigger
  language plpgsql
  as $sabotage$
  begin
    new.updated_at = now();
    return new;
  end;
  $sabotage$;

  select array_to_string(proconfig, ',') like '%search_path=%'
    into v_search_path_pinned
    from pg_proc
    where pronamespace = 'private'::regnamespace and proname = 'set_updated_at';
  if v_search_path_pinned is true then
    raise exception 'sabotage setup failed — redefining without search_path did not actually drop it, this proof is not discriminating';
  end if;

  create or replace function private.set_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
  as $restore$
  begin
    new.updated_at = now();
    return new;
  end;
  $restore$;

  select array_to_string(proconfig, ',') like '%search_path=%'
    into v_search_path_pinned
    from pg_proc
    where pronamespace = 'private'::regnamespace and proname = 'set_updated_at';
  if v_search_path_pinned is not true then
    raise exception 'sabotage cleanup failed — private.set_updated_at() was not restored with search_path pinned';
  end if;

  raise notice 'account_lockouts_anon_execute_and_search_path: all checks passed';
end $$;

rollback;
