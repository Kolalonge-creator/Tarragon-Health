-- Tarragon Health — extend the existing RBAC delegation pattern
-- (20260718230100_rbac_partner_rls_and_analyst_admin.sql) to the two
-- catalogue-item tables that actually carry lab/pharmacy commission rates:
-- panel_bundles (drives every 'lab' commissions row via record_lab_commission)
-- and pharmacy_medications (drives every 'pharmacy' commissions row via
-- record_pharmacy_commission). Both were missed in the original pass, which
-- only covered the *provider*-level tables (lab_providers, pharmacy_partners,
-- specialist_providers, ...) — not the item-level tables the commission
-- triggers actually read. Reuses the same two permission keys those provider
-- tables already use ('partners.labs.manage' / 'partners.pharmacies.manage')
-- rather than minting new ones, since editing a lab's test/bundle commission
-- rate is the same delegated capability as managing that lab.
--
-- ADDITIVE only, same as the original pass: is_admin() OR has_permission(...).
-- Super admin unaffected; a delegated member gains exactly this one surface.

do $$
declare
  rec record;
begin
  for rec in
    select * from (values
      ('panel_bundles',        'partners.labs.manage'),
      ('pharmacy_medications', 'partners.pharmacies.manage')
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

-- Assertion: confirm both tables now accept a has_permission(...) grant path,
-- not just is_admin() — a determined-by-inspection check, not a live-session
-- proof (those come from the app-layer RLS tests this codebase already runs
-- for every other RBAC-gated table).
do $$
declare
  v_def text;
begin
  select pg_get_expr(polwithcheck, polrelid) into v_def
  from pg_policy where polname = 'panel_bundles_update' and polrelid = 'public.panel_bundles'::regclass;
  if v_def not ilike '%has_permission%' then
    raise exception 'panel_bundles_update does not reference has_permission(): %', v_def;
  end if;

  select pg_get_expr(polwithcheck, polrelid) into v_def
  from pg_policy where polname = 'pharmacy_medications_update' and polrelid = 'public.pharmacy_medications'::regclass;
  if v_def not ilike '%has_permission%' then
    raise exception 'pharmacy_medications_update does not reference has_permission(): %', v_def;
  end if;
end;
$$;
