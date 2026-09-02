-- Completes 20260731232749_fix_missing_authenticated_table_grants.sql's own
-- stated intent: "Deliberately NOT granting to anon. Public exposure on
-- this platform is always a specific decision ... never a default." That
-- migration only set `alter default privileges for role postgres in schema
-- public grant ... to authenticated` -- it assumed, based on the live
-- cloud project's own history (checked against pg_default_acl at the time:
-- `{postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}`, no anon),
-- that no default anon grant existed anywhere and so needed no explicit
-- revoke.
--
-- That assumption does not hold for a truly fresh local reset: the CI
-- "Supabase migration replay" job's `supabase db reset` runs against a
-- brand-new local Postgres instance provisioned by the Supabase CLI's own
-- Docker image, whose own bootstrap (outside any file in this repo) grants
-- `anon` a default ACL entry on `public` schema tables. Proven directly,
-- not guessed: an earlier version of this fix used a text-matching
-- assertion (`pg_default_acl.defaclacl::text like '%anon=%'`) which stayed
-- red after a plain `revoke select, insert, update, delete on tables from
-- anon` -- the bootstrap default turned out to include a couple of
-- privilege kinds beyond CRUD (e.g. TRUNCATE/REFERENCES/TRIGGER), so a
-- narrower revoke left a real but harmless residual ACL entry that then
-- tripped the assertion's over-broad "any anon= substring" check. Widened
-- the revoke to `all` (matches whatever the bootstrap actually granted, not
-- a guessed subset) and replaced the assertion with a direct behavioural
-- proof -- create a real probe table, ask has_table_privilege() the actual
-- question this migration exists to answer, drop it -- rather than parsing
-- ACL text.
--
-- This surfaced for real on 20260830014616_programme_purchases.sql's own
-- closing assertion ("FAIL: anon must have no access to programme_purchases"),
-- which passes on the live koiplnmbgnqnbywhpjlf project (confirmed
-- directly: zero anon privileges on that table via
-- information_schema.role_table_grants) but fails a from-scratch reset --
-- every table created after this point in a fresh reset was inheriting
-- whatever anon default the local CLI's own bootstrap set, since ALTER
-- DEFAULT PRIVILEGES only affects objects created after it runs, by the
-- specifying role.
--
-- Purely a REVOKE -- strictly tightening, never grants anything, and does
-- not touch any existing table's already-explicit anon grants
-- (marketing_resources, patient_testimonials, consent_versions,
-- public_impact_metrics, passport_signing_keys, ...) since ALTER DEFAULT
-- PRIVILEGES never touches objects that already exist.
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
