-- public.catalog_items (the Membership and doctor-time price list) had row-level security on, no policy and no grant for
-- `authenticated`: readable by nobody but the service role. The catalogue itself reaches the app through public.catalogue(),
-- so the shop worked, but two screens join the table directly and both have returned 403 since they shipped:
--   * the patient's "Your refunds" card on /patient/membership (lib/queries/order-refunds.ts useMyOrderRefunds joins
--     orders -> catalog_items for the item's name), so a Member who asked for a refund never saw its steps;
--   * the admin's pending refund list on /admin/refund-requests (useAdminOrderRefunds, same join).
-- Found 2026-11-03 crawling the patient dashboard as the founder's test account: the network log showed the 403 while the
-- page rendered the rest of itself, so nothing on screen said it was broken (the "silent disable looks like an empty result"
-- failure this codebase keeps meeting).
--
-- Fix at the root rather than by rewriting both queries: a signed-in person may read the descriptive columns of any catalogue
-- item (id, code, kind, name_key, description_key, included_keys, duration_days, uses, active, audience, organisation_id).
-- These are the same facts public.catalogue() already hands out for the items on sale, plus the ability to name an item that
-- has since been withdrawn (which is exactly what an old order or refund needs). The internal columns (`note`, `grants_lead`)
-- stay unreadable: a column-level grant, not a table grant, so a column added later is unreadable until granted on purpose.
-- Writes stay with the service role and the existing admin RPC (set_catalog_item_active). anon gets nothing: the
-- default-privileges rule (20260731232750) already revokes anon on every public table and nothing here grants it.

grant select (id, organisation_id, code, kind, name_key, description_key, included_keys, duration_days, uses, active, audience)
  on public.catalog_items to authenticated;

drop policy if exists catalog_items_read on public.catalog_items;
create policy catalog_items_read on public.catalog_items
  for select to authenticated
  using (true);

do $$
begin
  if not has_column_privilege('authenticated', 'public.catalog_items', 'name_key', 'SELECT') then
    raise exception 'authenticated cannot read catalog_items.name_key';
  end if;
  if has_column_privilege('authenticated', 'public.catalog_items', 'note', 'SELECT') then
    raise exception 'catalog_items.note must stay unreadable by authenticated';
  end if;
  if has_table_privilege('anon', 'public.catalog_items', 'SELECT') then
    raise exception 'anon must not read catalog_items';
  end if;
end $$;
