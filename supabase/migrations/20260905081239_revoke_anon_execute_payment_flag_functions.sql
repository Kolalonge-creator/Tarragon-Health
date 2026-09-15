-- Close the anon-inherits-EXECUTE-via-PUBLIC hole on the two functions added
-- by 20260905060420 and 20260905060745.
--
-- The release-integrity "Anon EXECUTE on SECURITY DEFINER functions" job went
-- red on main-dev the moment those two landed:
--
--   private.finance_record_posting_failure(uuid, text, text, text)
--   private.record_payment_integrity_flag(uuid, text, text, bigint, bigint, text)
--
-- Both were created and granted to `authenticated` without first revoking from
-- PUBLIC. A new function carries a default `=X/postgres` ACL entry for the
-- PUBLIC pseudo-role, and `anon` inherits EXECUTE through it. This is the
-- gotcha CLAUDE.md records as having been believed fixed and found still broken
-- several times: `revoke ... from anon` alone does nothing, because the grant is
-- not direct. It has to be revoked from PUBLIC.
--
-- Blast radius today is small, because `anon` holds no USAGE on schema
-- `private` and PostgREST exposes only `public`, so neither function was
-- reachable over the API. That is defence in depth, not the control, and it is
-- exactly the reasoning that lets this bug keep coming back. Revoked properly
-- here.
--
-- Both are SECURITY DEFINER helpers called from triggers that already run as
-- the definer, so no caller needs a direct grant. `authenticated` keeps EXECUTE
-- only to match the deliberate private-schema default this project relies on
-- (see the private-schema-authenticated-default reference note), rather than
-- making these two an unexplained exception.

revoke all on function private.finance_record_posting_failure(uuid, text, text, text)
  from public, anon;
revoke all on function private.record_payment_integrity_flag(uuid, text, text, bigint, bigint, text)
  from public, anon;

grant execute on function private.finance_record_posting_failure(uuid, text, text, text)
  to authenticated, service_role;
grant execute on function private.record_payment_integrity_flag(uuid, text, text, bigint, bigint, text)
  to authenticated, service_role;

-- Prove it, rather than trusting the revoke. has_function_privilege is what the
-- release-integrity job checks, so assert on the same thing it does.
do $$
declare
  v_bad text;
begin
  select string_agg(sig, ', ')
    into v_bad
  from (
    values
      ('private.finance_record_posting_failure(uuid, text, text, text)'),
      ('private.record_payment_integrity_flag(uuid, text, text, bigint, bigint, text)')
  ) as t(sig)
  where has_function_privilege('anon', sig, 'EXECUTE');

  if v_bad is not null then
    raise exception 'anon can still EXECUTE: %', v_bad;
  end if;

  if not has_function_privilege('authenticated',
       'private.finance_record_posting_failure(uuid, text, text, text)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on finance_record_posting_failure';
  end if;
  if not has_function_privilege('authenticated',
       'private.record_payment_integrity_flag(uuid, text, text, bigint, bigint, text)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on record_payment_integrity_flag';
  end if;

  raise notice 'anon EXECUTE revoked on both functions; authenticated retained';
end $$;
