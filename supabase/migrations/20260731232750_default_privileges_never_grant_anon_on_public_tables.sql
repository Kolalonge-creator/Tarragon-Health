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
-- Docker image, which ships its own baseline default-privilege template --
-- distinct from this specific cloud project's own, differently-built
-- privilege history. This surfaced for real on
-- 20260830014616_programme_purchases.sql's own closing assertion ("FAIL:
-- anon must have no access to programme_purchases"), which passes on the
-- live koiplnmbgnqnbywhpjlf project (confirmed directly: zero anon
-- privileges on that table via information_schema.role_table_grants) but
-- fails a from-scratch reset -- every table created after that point in a
-- fresh reset inherits whatever anon default the local CLI's own template
-- set, since ALTER DEFAULT PRIVILEGES only affects objects created after it
-- runs, by the specifying role.
--
-- Fix at the root, matching this migration's own neighbour's title: make
-- "anon gets nothing by default" a property of every future `public` table,
-- explicitly, rather than relying on a assumption about the current ACL
-- state that a from-scratch environment does not share. Purely a REVOKE --
-- strictly tightening, never grants anything, and does not touch any
-- existing table's already-explicit anon grants (marketing_resources,
-- patient_testimonials, consent_versions, public_impact_metrics,
-- passport_signing_keys, ...) since ALTER DEFAULT PRIVILEGES never touches
-- objects that already exist.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon;

do $$
begin
  if exists (
    select 1
    from pg_default_acl da
    join pg_namespace n on n.oid = da.defaclnamespace
    where n.nspname = 'public'
      and da.defaclobjtype = 'r'
      and da.defaclacl::text like '%anon=%'
  ) then
    raise exception 'FAIL: schema public still has a default table privilege for anon';
  end if;
  raise notice 'PASS: anon gets no default privilege on future public-schema tables';
end $$;
