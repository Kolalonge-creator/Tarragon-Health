-- Fixes 20260830014616_programme_purchases.sql's own closing assertion,
-- which was failing on a fresh `supabase db reset` replay (caught wiring up
-- an unrelated PR's Supabase migration-replay CI job): "FAIL: anon must
-- have no access to programme_purchases".
--
-- Confirmed directly against the live koiplnmbgnqnbywhpjlf project that
-- `anon` genuinely holds NO privilege on this table today (checked
-- information_schema.role_table_grants) -- this is not a live security gap.
-- The failure is specific to a truly-from-scratch local reset, the same
-- class of drift CLAUDE.md's "Standing engineering lessons" section already
-- documents for this project (a fresh project's public-schema ALTER DEFAULT
-- PRIVILEGES can extend access further than the live project's own,
-- differently-built privilege history did -- see the identical fix already
-- applied to data_retention_policies in
-- 20260829095837_mdm_data_retention_policies.sql and to
-- symptom_triage_assessments in
-- 20260829095330_symptom_triage_assessments_revoke_default_grants.sql).
-- Rather than rely on "a fresh reset happens to not grant this," make the
-- table's actual privilege state explicit and independent of how it was
-- created, matching both of those precedents.
revoke all on public.programme_purchases from anon;

do $$
begin
  if has_table_privilege('anon', 'public.programme_purchases', 'SELECT')
     or has_table_privilege('anon', 'public.programme_purchases', 'INSERT') then
    raise exception 'FAIL: anon must have no access to programme_purchases';
  end if;
  raise notice 'PASS: anon has no access to programme_purchases';
end $$;
