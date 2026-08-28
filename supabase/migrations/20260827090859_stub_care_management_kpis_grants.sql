-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as every other stubbed function in this history:
-- 20260827090900_care_management_analytics.sql's own self-test fails on a
-- fresh replay because anon still holds direct EXECUTE despite that
-- migration's `revoke all ... from public`, the same unexplained
-- local/CI-only default-ACL gap documented throughout this history.
-- All-built-in-type signature, so pre-created one second earlier with the
-- explicit anon revoke, which CREATE OR REPLACE FUNCTION preserves since
-- the real migration's signature matches exactly.
create function public.care_management_kpis(p_org uuid)
returns jsonb
language sql
set search_path = public, pg_temp
as $$
  select null::jsonb;
$$;

revoke all on function public.care_management_kpis(uuid) from public;
revoke all on function public.care_management_kpis(uuid) from anon;
