-- public_impact_metrics: anon reads published rows without evaluating private.has_permission().
--
-- Bug (reproduced live 2026-10-29, rolled-back `set local role anon; select count(*) from
-- public.public_impact_metrics` -> 42501 "permission denied for function has_permission"): the single
-- SELECT policy `public_impact_metrics_public_select` was `to anon, authenticated using
-- (is_published or private.has_permission('impact_metrics.manage'))`. anon has no EXECUTE on
-- private.has_permission(text) and Postgres checks EXECUTE on every function in a policy expression
-- for the role running the query, so the whole read failed for anon instead of returning the
-- published rows. All 5 live rows are published.
--
-- History: this was found and "fixed" once before by 20260828222756, which granted EXECUTE on
-- has_permission to anon. 20260829111514_resweep_private_schema_execute_from_public deliberately
-- took that grant away again (anon must hold no EXECUTE on any private.* function), so the bug came
-- straight back and stayed unnoticed: resources-data/impact-data swallow the error and render
-- nothing. The grant was the wrong fix; the policy is.
--
-- Fix: one policy per audience.
--   anon           -> is_published only (no function call)
--   authenticated  -> is_published or private.has_permission('impact_metrics.manage')  (unchanged)
-- The table has no write policies (writes go through SECURITY DEFINER RPCs) and none are added.
-- Visibility is exactly what the old policy text said: anon = published rows, authenticated =
-- published rows, impact_metrics.manage holders (and admins) = all. The one observable change is
-- that anon now gets the published rows instead of an error.
--
-- anon's EXECUTE on private.has_permission(text) is deliberately NOT granted; the closing block
-- asserts it.

drop policy if exists public_impact_metrics_public_select on public.public_impact_metrics;
drop policy if exists public_impact_metrics_anon_select on public.public_impact_metrics;
drop policy if exists public_impact_metrics_authenticated_select on public.public_impact_metrics;

create policy public_impact_metrics_anon_select on public.public_impact_metrics
  for select to anon
  using (is_published);

create policy public_impact_metrics_authenticated_select on public.public_impact_metrics
  for select to authenticated
  using (is_published or private.has_permission('impact_metrics.manage'));

do $$
declare
  v_policies text[];
begin
  if has_function_privilege('anon', 'private.has_permission(text)', 'EXECUTE') then
    raise exception 'anon must not be able to execute private.has_permission(text)';
  end if;

  select array_agg(policyname order by policyname) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'public_impact_metrics';
  if v_policies is distinct from array['public_impact_metrics_anon_select',
                                       'public_impact_metrics_authenticated_select'] then
    raise exception 'unexpected public_impact_metrics policy set: %', v_policies;
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'public_impact_metrics'
                and 'anon' = any (roles)
                and (coalesce(qual, '') ilike '%has_permission%' or coalesce(with_check, '') ilike '%has_permission%')) then
    raise exception 'a public_impact_metrics policy that applies to anon still calls has_permission()';
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'public_impact_metrics'
                and policyname = 'public_impact_metrics_anon_select'
                and (roles <> array['anon']::name[] or cmd <> 'SELECT' or qual <> 'is_published')) then
    raise exception 'public_impact_metrics_anon_select is not "select to anon using (is_published)"';
  end if;
end $$;
