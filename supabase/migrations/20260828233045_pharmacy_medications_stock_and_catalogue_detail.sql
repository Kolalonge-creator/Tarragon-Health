-- Tarragon Health -- pharmacy_medications catalogue completeness (Pharmacy
-- Engine spec §12.6/§12.7, docs/PHARMACY_ENGINE_SPEC.md), built ahead of a
-- real partner on explicit founder ask 2026-08-28.
--
-- §12.6 stock management: stock_status/expected_restock_at, both nullable so
-- nothing REQUIRES a partner to load stock -- the standing founder decision
-- on record ("the pharmacist surface must not require pharmacies to load
-- stock", 20260716176000_pharmacy_order_dispenses.sql) still holds. A
-- partner who never touches these columns behaves exactly as today
-- (is_active is still the only signal anyone has to read). stock_updated_at
-- is auto-stamped by trigger, per §12.6's "stock data should include a
-- timestamp because availability changes rapidly".
--
-- §12.7 price visibility: strength (separate from the existing free-text
-- pack_size, which conflates quantity/pack-size language like "30 tablets")
-- and a generic/brand-substitution pair.

create type public.pharmacy_medication_stock_status as enum ('in_stock', 'low_stock', 'unavailable');

alter table public.pharmacy_medications
  add column if not exists strength                text,
  add column if not exists is_generic               boolean not null default false,
  add column if not exists generic_equivalent_of     text,
  add column if not exists stock_status             public.pharmacy_medication_stock_status,
  add column if not exists expected_restock_at       date,
  add column if not exists stock_updated_at          timestamptz;

comment on column public.pharmacy_medications.stock_status is
  'Pharmacy Engine spec §12.6. Nullable/optional by design -- a partner who never sets this is treated the same as today (is_active is the only availability signal). Never required.';
comment on column public.pharmacy_medications.generic_equivalent_of is
  'Free text brand name this row is a generic substitute for, e.g. "Amlodipine 5mg" generic_equivalent_of "Norvasc". NULL if this row is not itself a generic, or the concept does not apply.';

create or replace function private.stamp_pharmacy_medication_stock_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stock_status is distinct from old.stock_status then
    new.stock_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_medications_stamp_stock_updated_at on public.pharmacy_medications;
create trigger pharmacy_medications_stamp_stock_updated_at
  before update on public.pharmacy_medications
  for each row execute function private.stamp_pharmacy_medication_stock_updated_at();

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pharmacy_medications' and column_name='stock_status'
  ) then
    raise exception 'FAIL: stock_status was not added';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname='pharmacy_medications_stamp_stock_updated_at'
      and tgrelid='public.pharmacy_medications'::regclass
  ) then
    raise exception 'FAIL: stock_updated_at stamping trigger missing';
  end if;
  raise notice 'PASS: pharmacy_medications stock/catalogue-detail columns installed';
end $$;
