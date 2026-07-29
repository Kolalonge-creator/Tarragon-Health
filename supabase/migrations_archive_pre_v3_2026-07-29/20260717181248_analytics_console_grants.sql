-- Tarragon Health — lock analytics RPC execution to signed-in users only.
--
-- The previous migration's `revoke ... from anon` was ineffective on its own
-- because EXECUTE is also granted to PUBLIC (which includes anon). Revoke from
-- PUBLIC + anon and grant only to authenticated so an unauthenticated caller
-- can't even reach the (already-gated) function. Signed-in non-analysts still
-- get empty results via the internal private.is_analyst() gate. The residual
-- "authenticated can execute SECURITY DEFINER" advisor WARN is the same,
-- accepted project-wide pattern used by every other definer RPC here
-- (pharmacist_*, region_service_available, has_feature_access, admin_*) — the
-- in-function gate is the control.

do $$
declare
  fn text;
  fns text[] := array[
    'public.analytics_business_summary()',
    'public.analytics_growth_timeseries(text)',
    'public.analytics_financial_summary()',
    'public.analytics_revenue_timeseries(text)',
    'public.analytics_revenue_by_plan()',
    'public.analytics_population_summary()',
    'public.analytics_audit_log(text, text, uuid, timestamptz, timestamptz, int, int)',
    'public.analytics_audit_summary(timestamptz, timestamptz)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
