-- Tarragon Health
-- Fixes a real, confirmed-live bug in the same session's prior migration
-- (20260922182613_fhir_loinc_vital_type_mappings.sql), caught by /code-review
-- high before opening a PR -- not a pre-existing issue.
--
-- That migration revoked INSERT/UPDATE/DELETE on the table from
-- `authenticated` entirely, then relied on RLS policies gated by
-- private.is_admin() to permit admin writes -- but Postgres checks
-- table-level GRANTs BEFORE RLS. Revoking the base privilege makes those
-- policies dead code for every authenticated user, including admins: the
-- exact write path this table exists to enable ("widening the LOINC list
-- is an admin data change, not a code deploy") was unreachable through the
-- authenticated role. Verified live before writing this fix: a simulated
-- admin session (private.is_admin() = true) attempting an INSERT failed
-- with 42501 permission denied, with Postgres's own hint naming the exact
-- missing grant.
--
-- The migration's own comment claimed to be "mirroring vaccination_catalog's
-- own shape exactly" but got the grant half backwards -- checked live:
-- vaccination_catalog grants authenticated all four verbs (SELECT/INSERT/
-- UPDATE/DELETE) and relies on RLS alone to restrict writes to admins. This
-- migration makes fhir_loinc_vital_type_mappings match that for real.

grant insert, update, delete on public.fhir_loinc_vital_type_mappings to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.fhir_loinc_vital_type_mappings', 'INSERT') then
    raise exception 'authenticated must hold INSERT on fhir_loinc_vital_type_mappings (RLS, not the grant, is what restricts writes to admins)';
  end if;
  if not has_table_privilege('authenticated', 'public.fhir_loinc_vital_type_mappings', 'UPDATE') then
    raise exception 'authenticated must hold UPDATE on fhir_loinc_vital_type_mappings';
  end if;
  if not has_table_privilege('authenticated', 'public.fhir_loinc_vital_type_mappings', 'DELETE') then
    raise exception 'authenticated must hold DELETE on fhir_loinc_vital_type_mappings';
  end if;
  if has_table_privilege('anon', 'public.fhir_loinc_vital_type_mappings', 'SELECT') then
    raise exception 'anon must still not have SELECT on fhir_loinc_vital_type_mappings -- unchanged by this fix';
  end if;

  raise notice 'PASS: authenticated now holds SELECT/INSERT/UPDATE/DELETE on fhir_loinc_vital_type_mappings, matching vaccination_catalog''s live grants; RLS (private.is_admin()) is the real restriction, not the table grant';
end $$;
