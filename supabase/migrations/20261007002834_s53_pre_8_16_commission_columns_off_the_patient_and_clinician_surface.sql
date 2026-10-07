-- S53 pre-fix (spec 8.16, plan item P1): what Tarragon earns per medicine, and the commission ledger, must not be readable
-- by a patient, a clinician or a pharmacist. SAFETY FIX, meant to go live ahead of the rest of S53.
--
-- WHAT WAS EXPOSED (read live, read-only, 2026-10-07)
--   * public.pharmacy_medications: select policy `using (true)` for role authenticated plus a table-wide SELECT grant, so every
--     logged-in user (patient, clinician, pharmacist, finance) could read commission_rate, commission_rate_type and
--     commission_flat_kobo for every item. apps/web/src/lib/queries/pharmacy-orders.ts also did `select("*")`.
--     The 2026-09-25 migration (20260925023144) narrowed pharmacy_partners and lab_providers but not this table.
--   * public.commissions: select/insert/update/delete all gated by private.is_org_staff(organisation_id). That function admits the
--     `clinician` account role (it excludes only patient, institution admins, pharmacist, lab_partner, lab_liaison, finance,
--     analyst, payer/provider-org and NGO roles), so a clinician could read, edit and delete the partner commission ledger.
--   Live counts at write time: pharmacy_medications 0 rows, commissions 0 rows. So nothing has leaked yet; this closes the door
--   before the first row exists. No data conversion is needed.
--   Every other reader of both tables in the database is SECURITY DEFINER (record_*_commission, analytics_*_summary,
--   finance_post_commission, compute_pharmacy_partner_cost, sponsor_request_refill), so none is affected by the narrowing.
--
-- HOW
--   pharmacy_medications: a column REVOKE is a no-op under a table-level grant, so the table-level SELECT is revoked and a
--   SELECT is granted on the safe column list only. The commission columns then raise 42501 for any role that asks for them, and
--   `select *` fails loudly instead of leaking. Admin and partner managers read the full row through
--   public.pharmacy_medications_admin (owner-run, predicate in the view itself). Writes keep their existing policies and grants
--   (a pharmacist's own-catalogue is_active toggle, an admin's commission edit).
--   The row policy no longer shows inactive rows to a patient; admins, partner managers and the owning pharmacist still see them
--   (an UPDATE with a WHERE clause is also filtered by the SELECT policy, so the pharmacist's own rows must stay visible).
--   Any column added to this table later is NOT readable by authenticated until it is added to the grant here: that is the
--   intended default. S54 adds its price and stock columns with their own grant.
--
--   commissions: select and update need `private.is_admin() or private.has_permission('commissions.view')` (the permission the
--   admin and finance presets already carry); insert and delete are admin only (the writers are SECURITY DEFINER functions).

begin;

-- 1. pharmacy_medications: safe columns only for everyone
revoke select on public.pharmacy_medications from authenticated;
revoke select on public.pharmacy_medications from anon;
grant select (
  id, pharmacy_partner_id, drug_name, pack_size, price_kobo, is_active, created_at,
  strength, is_generic, generic_equivalent_of, stock_status, expected_restock_at, stock_updated_at, requires_cold_chain
) on public.pharmacy_medications to authenticated;

drop policy if exists pharmacy_medications_select on public.pharmacy_medications;
create policy pharmacy_medications_select on public.pharmacy_medications
  for select to authenticated
  using (
    is_active
    or private.is_admin()
    or private.has_permission('partners.pharmacies.manage'::text)
    or pharmacy_partner_id = private.pharmacist_partner()
  );
comment on policy pharmacy_medications_select on public.pharmacy_medications is
  'S53 pre-fix 8.16. Active rows for everyone, all rows for admin, partner managers and the owning pharmacist. The commission columns are not readable by this role at all (column grant); see public.pharmacy_medications_admin.';

-- 2. The full row, for admin and partner managers only
create view public.pharmacy_medications_admin
  with (security_invoker = false)
  as
  select pm.id, pm.pharmacy_partner_id, pp.name as pharmacy_partner_name, pm.drug_name, pm.pack_size, pm.price_kobo, pm.is_active,
         pm.created_at, pm.commission_rate, pm.commission_rate_type, pm.commission_flat_kobo, pm.strength, pm.is_generic,
         pm.generic_equivalent_of, pm.stock_status, pm.expected_restock_at, pm.stock_updated_at, pm.requires_cold_chain
  from public.pharmacy_medications pm
  left join public.pharmacy_partners pp on pp.id = pm.pharmacy_partner_id
  where private.is_admin() or private.has_permission('partners.pharmacies.manage'::text);
comment on view public.pharmacy_medications_admin is
  'S53 pre-fix 8.16. The only read path that carries commission_rate, commission_rate_type and commission_flat_kobo. Owner-run on purpose; the predicate is in the view, so any other caller sees zero rows. Do not select it from patient, clinician or pharmacist code.';
revoke all on public.pharmacy_medications_admin from public, anon;
grant select on public.pharmacy_medications_admin to authenticated;

-- 3. commissions: ledger is admin and finance (commissions.view) only
drop policy if exists commissions_select on public.commissions;
drop policy if exists commissions_insert on public.commissions;
drop policy if exists commissions_update on public.commissions;
drop policy if exists commissions_delete on public.commissions;
create policy commissions_select on public.commissions
  for select to authenticated
  using (private.is_admin() or private.has_permission('commissions.view'::text));
create policy commissions_insert on public.commissions
  for insert to authenticated
  with check (private.is_admin());
create policy commissions_update on public.commissions
  for update to authenticated
  using (private.is_admin() or private.has_permission('commissions.view'::text))
  with check (private.is_admin() or private.has_permission('commissions.view'::text));
create policy commissions_delete on public.commissions
  for delete to authenticated
  using (private.is_admin());
comment on policy commissions_select on public.commissions is
  'S53 pre-fix 8.16. Was private.is_org_staff(organisation_id), which admits the clinician role. A clinician must never see what Tarragon earns from a partner.';

-- 4. Assertions: a patient, a clinician and a pharmacist cannot read the commission columns; the safe ones still work.
do $$
declare
  c text;
begin
  foreach c in array array['commission_rate', 'commission_rate_type', 'commission_flat_kobo'] loop
    if has_column_privilege('authenticated', 'public.pharmacy_medications', c, 'SELECT') then
      raise exception 'FAIL: authenticated can still SELECT pharmacy_medications.%', c;
    end if;
    if has_column_privilege('anon', 'public.pharmacy_medications', c, 'SELECT') then
      raise exception 'FAIL: anon can SELECT pharmacy_medications.%', c;
    end if;
  end loop;
  foreach c in array array['drug_name', 'price_kobo', 'stock_status', 'is_active'] loop
    if not has_column_privilege('authenticated', 'public.pharmacy_medications', c, 'SELECT') then
      raise exception 'FAIL: authenticated lost SELECT on safe column pharmacy_medications.%', c;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.pharmacy_medications_admin', 'SELECT') then
    raise exception 'FAIL: anon can SELECT pharmacy_medications_admin';
  end if;
  if exists (select 1 from pg_policies where tablename = 'commissions' and qual ~ 'is_org_staff') then
    raise exception 'FAIL: a commissions policy still admits is_org_staff (the clinician role)';
  end if;
  raise notice 'PASS: commission columns are off the authenticated surface; commissions ledger is admin/finance only';
end $$;

commit;
