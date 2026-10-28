-- private.guard_is_test_flag() is the write guard on profiles.is_test and clinical_staff.is_test (INV-13, S02). Its own comment says
-- "auth.uid() is null for service_role ... those may set the flag", but it never worked for service_role: the function was SECURITY
-- INVOKER, its first statement names private.is_admin(), and the role running it needs USAGE on schema private just to RESOLVE that
-- name. authenticated has that USAGE; service_role does not (checked live 2026-10-27: has_schema_privilege('service_role','private',
-- 'USAGE') is false). So any service-role REST write that touches is_test on these two tables failed with
-- 42501 "permission denied for schema private" instead of being allowed. The short-circuit on `auth.uid() is null` does not help: the
-- name is resolved when the statement is prepared, before any of it runs.
--
-- Found by the Browser E2E journey 2 fixture (createJourneyPatient: adminClient.from('profiles').update({ is_test: true })), which fails
-- in beforeAll with that error. NOT patient-facing: a patient saving a reading is `authenticated`, every trigger on vitals_readings and
-- symptoms is either SECURITY DEFINER or calls no private function, and real BP readings are being saved in production today. The S02
-- proof missed it because its "service context" check ran as the postgres role, never as service_role.
--
-- Fix: SECURITY DEFINER (search_path is already pinned to ''), the same shape as every other private trigger function that calls a
-- private helper. Granting service_role USAGE on private would widen the whole schema for one function, so it is not done. The body is
-- unchanged from 20261006031500 (the OQ-103 credential-carry exception is kept). It decides on auth.uid() and private.is_admin(), both
-- of which read the request claims and not the executing role, so running as the owner does not change who is allowed.
--
-- Not changed here: the same defect shape exists on two editorial tables (health_education_content, learning_glossary_terms, whose
-- gate triggers are SECURITY INVOKER and call private functions); see the PR description.

create or replace function private.guard_is_test_flag() returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- auth.uid() is null for service_role, the migration connection and pg_cron: those may set the flag.
  if (select auth.uid()) is null or private.is_admin() then
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
$$;

-- A definer function must stay closed to anon. anon inherits EXECUTE through PUBLIC, so revoke from public, not from anon.
revoke all on function private.guard_is_test_flag() from public;

do $$
begin
  if not (select p.prosecdef from pg_proc p where p.oid = 'private.guard_is_test_flag()'::regprocedure) then
    raise exception 'guard_is_test_flag is not SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'private.guard_is_test_flag()', 'EXECUTE') then
    raise exception 'anon can execute guard_is_test_flag';
  end if;
  -- Both guarded tables must still carry the trigger; this migration replaces the function only.
  if (select count(distinct t.tgrelid) from pg_trigger t
       where t.tgfoid = 'private.guard_is_test_flag()'::regprocedure and not t.tgisinternal
         and t.tgrelid in ('public.profiles'::regclass, 'public.clinical_staff'::regclass)) <> 2 then
    raise exception 'guard_is_test_flag should be attached to profiles and clinical_staff';
  end if;
end $$;
