-- Recovered 2026-09-03 (full-platform audit) from supabase_migrations.schema_migrations:
-- this migration was applied live as version 20260902070424 but existed in no commit on any
-- branch (the session that applied it never committed the file). Committed here verbatim so
-- the applied SQL has a home in git; the release-integrity migration-drift check flags this
-- class as UNTRACED. Do not re-apply.

alter default privileges for role postgres in schema public
  revoke all on tables from anon;

do $$
begin
  create table public._default_priv_probe_20260731232750 (id int);

  if has_table_privilege('anon', 'public._default_priv_probe_20260731232750', 'SELECT')
     or has_table_privilege('anon', 'public._default_priv_probe_20260731232750', 'INSERT') then
    drop table public._default_priv_probe_20260731232750;
    raise exception 'FAIL: anon still gets a default privilege on a brand-new public-schema table';
  end if;

  drop table public._default_priv_probe_20260731232750;
  raise notice 'PASS: anon gets no default privilege on future public-schema tables (proved on a real probe table)';
end $$;

