-- S68e follow-up: two SECURITY DEFINER RLS helpers were executable by anon.
--
-- Found by the release-integrity job (check-anon-security-definer-execute.mjs) on 2026-10-15: private.maternal_staff_may_read(uuid, uuid) and
-- private.maternal_caregiver_may_read(uuid), created in 20261007164702_s68e_epds_rules_postnatal_checks_feed_log.sql, carry the implicit PUBLIC grant.
-- Unlike the vitals helpers (only called from definer-run triggers) these are called inside the RLS policies of the maternal tables, which run as the
-- signed-in caller, so authenticated must keep EXECUTE. The revoke is from public (anon inherits through it) and the grant to authenticated is explicit.
-- Idempotent. Declares no transaction (the apply workflow wraps it).

revoke all on function private.maternal_staff_may_read(uuid, uuid) from public, anon;
revoke all on function private.maternal_caregiver_may_read(uuid) from public, anon;
grant execute on function private.maternal_staff_may_read(uuid, uuid) to authenticated;
grant execute on function private.maternal_caregiver_may_read(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.maternal_caregiver_may_read(uuid)', 'EXECUTE') then
    raise exception 'S68e follow-up: a maternal RLS helper is still executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'private.maternal_caregiver_may_read(uuid)', 'EXECUTE') then
    raise exception 'S68e follow-up: authenticated lost EXECUTE on a maternal RLS helper the policies call';
  end if;
end $$;
