-- Recovered 2026-09-03 (full-platform audit) from supabase_migrations.schema_migrations:
-- this migration was applied live as version 20260902065006 but existed in no commit on any
-- branch (the session that applied it never committed the file). Committed here verbatim so
-- the applied SQL has a home in git; the release-integrity migration-drift check flags this
-- class as UNTRACED. Do not re-apply.

-- programme_purchases (20260830014616) was applied live without the
-- established `revoke ... from public, anon` step every other new table in
-- this codebase carries (confirmed by grep: patient_shared_decisions,
-- falls_risk_assessments, provider_organisations, data_retention_policies,
-- care_access_events, etc. all do this for their own new tables). Caught by
-- CI's fresh migration-replay assertion, which only runs on a fresh
-- `supabase db reset` and had never been exercised against this table's own
-- live-applied version. Table-level GRANT only — RLS policies on this table
-- are already scoped `to authenticated` only, so anon could never read/write
-- an actual row even before this fix, but the table-level privilege itself
-- was a real, unintended defense-in-depth gap. Fixes the source migration
-- file to match (so a fresh replay stops failing) and this applies the same
-- fix to the already-live table.
revoke all on public.programme_purchases from public, anon;

do $$
begin
  if has_table_privilege('anon', 'public.programme_purchases', 'SELECT')
     or has_table_privilege('anon', 'public.programme_purchases', 'INSERT') then
    raise exception 'FAIL: anon must have no access to programme_purchases';
  end if;
  if not has_table_privilege('authenticated', 'public.programme_purchases', 'INSERT') then
    raise exception 'FAIL: authenticated must still be able to insert programme_purchases';
  end if;
  raise notice 'PASS: anon table-level access to programme_purchases revoked';
end $$;
