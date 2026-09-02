-- Filename/version corrected 2026-09-02: this migration is recorded live
-- (koiplnmbgnqnbywhpjlf) as version 20260831092516 — a timestamp that sorts
-- BEFORE 20260831165033_chronic_programme_coordinator_tasks_and_sweep.sql,
-- the migration that actually creates the function this one revokes EXECUTE
-- on. That ordering only ever worked live because it was applied there
-- out-of-band, after the function already existed, with a version number
-- that doesn't reflect real application order (the same class of drift
-- CLAUDE.md's "Standing engineering lessons" section warns about — a
-- migration's recorded version does not necessarily match when it actually
-- ran). A fresh `supabase db reset` replays strictly in filename order, so
-- the original filename made this fail with `function ... does not exist`
-- (SQLSTATE 42883) every time. Renamed to 20260831165100 — just after its
-- real dependency — so a from-scratch environment can replay successfully.
-- No live change: the live row's version stays 20260831092516 forever
-- (`supabase_migrations.schema_migrations` is not something this migration
-- touches), so nothing about the live database changes here.
--
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
