-- Tarragon Health -- dispensing-record enrichment (Pharmacy Engine spec
-- §12.14, docs/PHARMACY_ENGINE_SPEC.md Phase 1 item 3).
--
-- pharmacy_order_dispenses already covers medication/quantity/pharmacy/date/
-- prescription-relationship; §12.14 additionally wants strength, batch/lot,
-- and expiry "where relevant". All three are additive nullable columns --
-- deliberately NOT a stock/inventory system (that would re-open the
-- standing "pharmacist surface must not require pharmacies to load stock"
-- decision noted on 20260716176000_pharmacy_order_dispenses.sql and held in
-- docs/PHARMACY_ENGINE_SPEC.md §3 for §12.6). These three columns describe
-- one specific dispensed unit after the fact, not a pharmacy's inventory --
-- no conflict with that decision, and they work identically for the live
-- self-arranged-fulfilment path (source='patient', no pharmacy_order_id) as
-- they would for a routed order once one exists.

alter table public.pharmacy_order_dispenses
  add column if not exists strength     text,
  add column if not exists batch_lot    text,
  add column if not exists expiry_date  date;

comment on column public.pharmacy_order_dispenses.strength is
  'e.g. "500mg" -- free text, same shape as the existing quantity column.';
comment on column public.pharmacy_order_dispenses.batch_lot is
  'Manufacturer batch/lot number, where the patient or pharmacist has it to hand. Optional -- most self-arranged collections will never carry this.';
comment on column public.pharmacy_order_dispenses.expiry_date is
  'Printed expiry on the dispensed pack, where relevant/known.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pharmacy_order_dispenses' and column_name = 'strength'
  ) then
    raise exception 'FAIL: pharmacy_order_dispenses.strength was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pharmacy_order_dispenses' and column_name = 'batch_lot'
  ) then
    raise exception 'FAIL: pharmacy_order_dispenses.batch_lot was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pharmacy_order_dispenses' and column_name = 'expiry_date'
  ) then
    raise exception 'FAIL: pharmacy_order_dispenses.expiry_date was not added';
  end if;
  raise notice 'PASS: pharmacy_order_dispenses strength/batch_lot/expiry_date added';
end $$;
