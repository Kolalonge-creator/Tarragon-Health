-- Proof for 20260925093358_revoke_anon_execute_finance_create_recognition_schedule.sql
--
-- Release Integrity CI (check-anon-security-definer-execute.mjs) flagged
-- private.finance_create_recognition_schedule(text, uuid, uuid, uuid, text,
-- currency, bigint, date, date, bigint) as anon-executable — the well-
-- documented "anon inherits EXECUTE via the PUBLIC pseudo-role" gotcha (see
-- the supabase-anon-execute-gotcha memory, recurred at least 6 times now).
-- Its originating migration (20260725230030_finance_revenue_recognition.sql)
-- never revoked the default PUBLIC grant, so anon inherited EXECUTE through
-- PUBLIC rather than any direct grant.
--
-- Proves: anon cannot execute the function, authenticated still can, and a
-- sabotage step (re-granting to anon, then re-revoking) confirms the check
-- actually discriminates rather than passing vacuously.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/finance_create_recognition_schedule_anon_execute.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

do $$
declare
  v_signature constant text :=
    'private.finance_create_recognition_schedule(text, uuid, uuid, uuid, text, public.currency, bigint, date, date, bigint)';
begin
  if has_function_privilege('anon', v_signature, 'execute') then
    raise exception 'REGRESSION: anon can execute %  — the anon-execute-via-PUBLIC gotcha is back', v_signature;
  end if;
  if not has_function_privilege('authenticated', v_signature, 'execute') then
    raise exception 'authenticated lost EXECUTE on %', v_signature;
  end if;

  -- Sabotage: prove the check above would actually catch the regression it
  -- exists to catch, not just pass vacuously.
  execute format('grant execute on function %s to anon', v_signature);
  if not has_function_privilege('anon', v_signature, 'execute') then
    raise exception 'sabotage setup failed — grant to anon did not take, this proof is not discriminating';
  end if;
  execute format('revoke execute on function %s from anon', v_signature);
  if has_function_privilege('anon', v_signature, 'execute') then
    raise exception 'sabotage cleanup failed — anon still has EXECUTE after revoke';
  end if;

  raise notice 'finance_create_recognition_schedule_anon_execute: all checks passed';
end $$;

rollback;
