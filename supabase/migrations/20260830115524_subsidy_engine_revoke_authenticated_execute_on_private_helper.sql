-- private.compute_transaction_subsidy was created with an unexpected direct
-- EXECUTE grant to `authenticated` (proacl showed
-- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- immediately after creation, identical to a spot-check on the pre-existing
-- private.finance_compute_vat, which has the same grant right now despite
-- Phase 8's own test asserting otherwise at the time — this looks like a
-- schema-wide default-privileges drift on the `private` schema, applied by
-- some concurrent process after that test ran, not something this migration
-- introduced). Neither function is reachable via PostgREST (the `private`
-- schema is not in the exposed schema list), so this was not live-
-- exploitable over the REST API, but it is still a real SQL-level privilege
-- a raw authenticated Postgres connection should not have on an internal
-- helper. Revoking it here for the one function this phase owns; the
-- broader drift across the rest of the `private` schema is flagged
-- separately rather than fixed inline in this already-large phase.
revoke execute on function private.compute_transaction_subsidy(uuid, text, bigint) from authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'private.compute_transaction_subsidy(uuid, text, bigint)', 'EXECUTE') then
    raise exception 'authenticated still has EXECUTE on private.compute_transaction_subsidy after revoke';
  end if;
end $$;
