-- Tarragon Health -- pharmacy delivery fee (Pharmacy Engine spec §12.7,
-- docs/PHARMACY_ENGINE_SPEC.md), closing the one remaining price-visibility
-- gap the spec doc flagged: "no per-order delivery-fee column... no
-- generic/brand substitution linkage" (generic/brand was closed by
-- pharmacy_medications.is_generic/generic_equivalent_of, previous
-- migration). A pharmacy's own flat delivery fee, decided upfront at
-- order-creation time -- deliberately NOT the logistics_partners fee, which
-- isn't assigned until after payment in the existing clinician/orders
-- AssignLogisticsForm flow and so can't be known at checkout time.
-- Nullable/default null: no behaviour change until an admin sets one, and
-- delivery is still UI-disabled ("coming soon") regardless.

alter table public.pharmacy_partners
  add column if not exists delivery_fee_kobo bigint;

alter table public.pharmacy_partners
  add constraint pharmacy_partners_delivery_fee_kobo_non_negative
  check (delivery_fee_kobo is null or delivery_fee_kobo >= 0);

comment on column public.pharmacy_partners.delivery_fee_kobo is
  'Flat delivery fee this pharmacy charges, added to pharmacy_orders.total_kobo when fulfilment_method=''delivery'' (useCreatePharmacyOrder). NULL/0 = no delivery fee. Distinct from logistics_partners.delivery_fee_kobo, which is a courier''s own fee assigned post-payment.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pharmacy_partners' and column_name='delivery_fee_kobo'
  ) then
    raise exception 'FAIL: delivery_fee_kobo was not added';
  end if;
  raise notice 'PASS: pharmacy_partners.delivery_fee_kobo installed';
end $$;
