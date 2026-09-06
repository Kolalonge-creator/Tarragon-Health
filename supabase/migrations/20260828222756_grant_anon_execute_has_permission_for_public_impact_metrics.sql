-- Fixes a real regression found by packages/db/tests/public_impact_metrics.sql
-- once it could finally run against a genuinely fresh database for the
-- first time this sprint.
--
-- public.public_impact_metrics_public_select (20260730153159_public_impact_
-- metrics.sql) is an RLS policy deliberately applied `for select to anon,
-- authenticated`, so the public marketing-facing impact dashboard can be
-- read by a signed-out visitor:
--   using (is_published or private.has_permission('impact_metrics.manage'))
--
-- 20260812003758_revoke_private_schema_execute_from_public.sql later
-- revoked EXECUTE on every private.* function from PUBLIC (and therefore
-- from anon, which inherits through it) as a defense-in-depth sweep,
-- re-granting only to authenticated/service_role wherever they already had
-- it. Its own header comment frames this as closing an unreachable,
-- unused hole ("not currently reachable through the app's REST API ...
-- but it's a real defense-in-depth gap") and its self-check asserts
-- `anon execute count = 0` across every private.* function as success --
-- it never checked whether any RLS policy applied to anon calls a
-- private.* function directly, which public_impact_metrics_public_select
-- does. Postgres checks EXECUTE privilege on a function referenced in a
-- policy's USING clause at plan time, for every row scanned, regardless of
-- whether short-circuit evaluation would otherwise skip it -- so this
-- policy has raised "permission denied for function has_permission" for
-- every anon (signed-out) select against public.public_impact_metrics ever
-- since, silently breaking the public marketing site's impact dashboard for
-- exactly the audience it exists for.
--
-- Fix: re-open EXECUTE on this one function for anon, narrowly. This does
-- not undo 20260812003758's broader sweep -- every other private.* function
-- stays exactly as anon-closed as that migration left it; only the one
-- function an anon-facing RLS policy genuinely depends on is re-opened.
-- has_permission() itself is safe to expose this way: it takes a single
-- permission-key string, is security definer, and only ever answers
-- "does auth.uid() hold this permission" -- for anon, auth.uid() is null,
-- so every branch inside it evaluates false and it always returns false,
-- correctly falling through to the policy's plain `is_published` check.
grant execute on function private.has_permission(text) to anon;

do $$
begin
  if not has_function_privilege('anon', 'private.has_permission(text)', 'EXECUTE') then
    raise exception 'anon still lacks EXECUTE on private.has_permission(text) after grant';
  end if;
end $$;
