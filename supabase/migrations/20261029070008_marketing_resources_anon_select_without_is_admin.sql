-- marketing_resources: anon reads published rows without evaluating private.is_admin().
--
-- Bug (reproduced live 2026-10-29, rolled-back `set local role anon; select count(*) from
-- public.marketing_resources` -> 42501 "permission denied for function is_admin"): the single
-- SELECT policy `marketing_resources_public_select` was `to anon, authenticated using
-- (is_published or private.is_admin())`. anon has no EXECUTE on private.is_admin() (correct, and it
-- must stay that way), and Postgres checks EXECUTE on every function in a policy expression for the
-- role running the query, so the whole read failed for anon rather than returning the published rows.
-- All 42 live rows are published, so anon currently sees none of them through the API and the
-- public /resources page quietly falls back to its static copy (resources-data.ts), which hides
-- any article an admin adds.
--
-- Fix: one policy per audience.
--   anon           -> is_published only (no function call)
--   authenticated  -> is_published or private.is_admin()   (unchanged from the old policy)
-- The admin ALL policy (authenticated) is untouched. Intended visibility is therefore exactly what
-- the old policy text said: anon = published rows, authenticated = published rows, admins = all.
-- The one observable change is that anon now gets the published rows instead of an error.
--
-- anon's EXECUTE on private.is_admin() is deliberately NOT granted; the closing block asserts it.

drop policy if exists marketing_resources_public_select on public.marketing_resources;

create policy marketing_resources_anon_select on public.marketing_resources
  for select to anon
  using (is_published);

create policy marketing_resources_authenticated_select on public.marketing_resources
  for select to authenticated
  using (is_published or private.is_admin());

do $$
declare
  v_policies text[];
begin
  if has_function_privilege('anon', 'private.is_admin()', 'EXECUTE') then
    raise exception 'anon must not be able to execute private.is_admin()';
  end if;

  select array_agg(policyname order by policyname) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'marketing_resources';
  if v_policies is distinct from array['marketing_resources_admin_write',
                                       'marketing_resources_anon_select',
                                       'marketing_resources_authenticated_select'] then
    raise exception 'unexpected marketing_resources policy set: %', v_policies;
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'marketing_resources'
                and 'anon' = any (roles)
                and (coalesce(qual, '') ilike '%is_admin%' or coalesce(with_check, '') ilike '%is_admin%')) then
    raise exception 'a marketing_resources policy that applies to anon still calls is_admin()';
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'marketing_resources'
                and policyname = 'marketing_resources_anon_select'
                and (roles <> array['anon']::name[] or cmd <> 'SELECT' or qual <> 'is_published')) then
    raise exception 'marketing_resources_anon_select is not "select to anon using (is_published)"';
  end if;
end $$;
