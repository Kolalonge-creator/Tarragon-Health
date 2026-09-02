-- private.sweep_chronic_programme_occurrences() (added in
-- 20260831165033_chronic_programme_coordinator_tasks_and_sweep.sql) is SECURITY DEFINER with no
-- explicit grant/revoke, so it inherited the implicit EXECUTE grant to the PUBLIC pseudo-role that
-- Postgres gives every new function -- the anon-inherits-EXECUTE-via-PUBLIC bug documented in the
-- supabase-anon-execute-gotcha memory, recurring here for (at least) the 4th time. It is only ever
-- invoked by the pg_cron job scheduled two lines below it in that migration, so no role needs a
-- direct grant here -- this migration only needs to close the implicit PUBLIC/anon path.
--
-- private is not PostgREST-exposed, so this was defense-in-depth rather than a live PHI exposure
-- (unlike a public-schema function with the same gap) -- caught by
-- scripts/release-integrity/check-anon-security-definer-execute.mjs while fixing that check's
-- IPv6/pooler bug on 2026-08-31, not by a manual audit.

revoke all on function private.sweep_chronic_programme_occurrences() from public, anon;

do $$
begin
  if has_function_privilege('anon', 'private.sweep_chronic_programme_occurrences()', 'EXECUTE') then
    raise exception 'FAIL: anon must not be able to execute private.sweep_chronic_programme_occurrences()';
  end if;
  raise notice 'PASS: anon EXECUTE revoked on private.sweep_chronic_programme_occurrences()';
end $$;
