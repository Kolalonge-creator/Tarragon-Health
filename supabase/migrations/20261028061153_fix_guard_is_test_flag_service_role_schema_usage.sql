-- Fixes: the service role could not set profiles.is_test / clinical_staff.is_test ("permission denied for schema private",
-- 42501), although private.guard_is_test_flag() says in its own comment that a service context may set the flag.
--
-- Cause: the function is SECURITY INVOKER and its first test was ONE expression,
--   if (select auth.uid()) is null or private.is_admin() then
-- plpgsql plans an expression as a whole, so Postgres checked USAGE on schema private for the calling role before it
-- evaluated the left side. service_role has no USAGE on schema private (authenticated has, since
-- 20260914212425), so the short-circuit never got the chance to run. The trigger is BEFORE INSERT OR UPDATE OF is_test,
-- so only a service-role statement that names is_test in its SET list (the browser E2E journey 2 fixture,
-- apps/web/e2e-browser/journeys/journey-helpers.ts createJourneyPatient) ever hit it. Found from the failing
-- "Browser E2E (Playwright)" job: the error was thrown by the spec's beforeAll hook.
--
-- Fix: test the service context in its own statement and return before the private reference is ever planned, the same
-- shape private.guard_profiles_privileged_columns() already uses. The function stays SECURITY INVOKER and the rule is
-- unchanged: no signed-in caller (service role, migrations, cron) may set the flag; a signed-in caller needs private.is_admin();
-- a non-admin still cannot set or change it. No schema grant is widened. No data changes.
--
-- Not applied to production by this file's author; apply through the normal path.
-- Sibling invoker trigger functions that mention private.* were listed in the PR description, not changed here.

create or replace function private.guard_is_test_flag()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- auth.uid() is null for service_role, the migration connection and pg_cron: those may set the flag.
  -- Kept as its own statement so the private.is_admin() reference below is not planned (and its schema USAGE not
  -- checked) for a role that has no USAGE on schema private.
  if (select auth.uid()) is null then
    return new;
  end if;
  if private.is_admin() then
    return new;
  end if;
  -- The approval function sets this for one clinician record when the application it approves is itself a test
  -- application. It is transaction-local and names the person, so it cannot be reused for anyone else.
  -- (Nested on purpose: this trigger sits on many tables, and only clinical_staff has a profile_id to read.)
  if tg_op = 'INSERT' and tg_table_name = 'clinical_staff' then
    if new.is_test
       and nullif(current_setting('tarragon.credential_carry_test_flag', true), '') = new.profile_id::text then
      return new;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.is_test then
      raise exception '%.is_test can only be set by an admin or a service context', tg_table_name using errcode = '42501';
    end if;
  elsif new.is_test is distinct from old.is_test then
    raise exception '%.is_test can only be changed by an admin or a service context', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$function$;

do $$
begin
  if not exists (
    select 1 from pg_proc where oid = 'private.guard_is_test_flag()'::regprocedure and not prosecdef
  ) then
    raise exception 'guard_is_test_flag must stay SECURITY INVOKER';
  end if;
  if has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'this fix assumes service_role has no USAGE on schema private; the premise changed';
  end if;
end
$$;
