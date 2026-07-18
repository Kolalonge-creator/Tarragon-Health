-- Tarragon Health — wire the RBAC permission layer into partner-table RLS,
-- and give the super admin every analyst surface.
--
-- ADDITIVE only: each partner catalogue's write policy goes from `is_admin()`
-- to `is_admin() OR has_permission('partners.<x>.manage')`. Super admin is
-- unaffected (still holds every key via has_permission); a member explicitly
-- delegated one key gains exactly that one partner surface, nothing more.
-- ---------------------------------------------------------------------------

do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('lab_providers',        'partners.labs.manage'),
      ('pharmacy_partners',    'partners.pharmacies.manage'),
      ('facilities',           'partners.facilities.manage'),
      ('specialist_providers', 'partners.specialists.manage'),
      ('home_visit_providers', 'partners.home_visit.manage'),
      ('logistics_partners',   'partners.logistics.manage')
    ) as t(tbl, perm)
  loop
    execute format('drop policy if exists %1$s_insert on public.%1$I', rec.tbl);
    execute format('drop policy if exists %1$s_update on public.%1$I', rec.tbl);
    execute format('drop policy if exists %1$s_delete on public.%1$I', rec.tbl);

    execute format($f$
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (private.is_admin() or private.has_permission(%2$L));
    $f$, rec.tbl, rec.perm);

    execute format($f$
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (private.is_admin() or private.has_permission(%2$L))
        with check (private.is_admin() or private.has_permission(%2$L));
    $f$, rec.tbl, rec.perm);

    execute format($f$
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_admin() or private.has_permission(%2$L));
    $f$, rec.tbl, rec.perm);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Super admin ⇒ all analyst data. private.is_analyst() gates every analytics
-- console RPC and the /analytics layout; widening it here (analyst OR admin)
-- grants the super admin every analyst surface with no per-RPC edits. Purely
-- additive — analysts are unaffected. The predicate now reads "may view
-- company-wide analytics", which is exactly analyst + super admin.
-- ---------------------------------------------------------------------------
create or replace function private.is_analyst()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('analyst', 'admin')
  );
$$;
