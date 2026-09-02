-- Follow-up to 20260830014616_programme_purchases.sql: explicitly revoke
-- anon's default table access.
--
-- That migration's own closing DO block already asserts "anon must have no
-- access to programme_purchases", and that assertion happens to pass on the
-- live project (koiplnmbgnqnbywhpjlf) because of its incremental history —
-- but it was never actually true by construction: the migration only ever
-- wrote `grant select, insert, update on public.programme_purchases to
-- authenticated;` with no matching revoke for anon. On a from-scratch
-- environment (a fresh `supabase db reset`, a brand-new project), the base
-- Supabase template's public-schema ALTER DEFAULT PRIVILEGES grants table
-- DML directly to anon at CREATE TABLE time too — the exact same base-
-- template behaviour 20260829095837_mdm_data_retention_policies.sql already
-- documented for CREATE FUNCTION/EXECUTE ("a fresh project's public-schema
-- ALTER DEFAULT PRIVILEGES grants EXECUTE directly to anon/authenticated/
-- service_role at CREATE FUNCTION time, not only via the PUBLIC pseudo-
-- role"). That migration revokes explicitly per-table
-- (`revoke all on public.data_retention_policies from anon;`) rather than
-- relying on "no grant statement" to mean "no access" — programme_purchases
-- never got the same treatment. Found via a fresh CI migration replay
-- (`supabase db reset`) failing programme_purchases' own anon-denial
-- assertion with SQLSTATE P0001, confirming the gap is real, not
-- theoretical.
--
-- This is a no-op on the live project (confirmed via aclexplode(relacl) —
-- anon already holds nothing on public.programme_purchases there), so it
-- only closes the gap for any future from-scratch environment.
revoke all on public.programme_purchases from anon;

do $$
begin
  if has_table_privilege('anon', 'public.programme_purchases', 'SELECT')
     or has_table_privilege('anon', 'public.programme_purchases', 'INSERT') then
    raise exception 'FAIL: anon must have no access to programme_purchases';
  end if;
  raise notice 'PASS: anon has no access to programme_purchases';
end $$;
