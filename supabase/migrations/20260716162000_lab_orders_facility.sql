-- Tarragon Health — lab_orders: chosen facility (the physical WHERE)
--
-- A patient now books a lab test by picking a facility near them (state/city/area),
-- not a bare provider. The order records:
--   • facility_id  — the physical location the patient chose (this column), and
--   • provider_id  — derived from facilities.lab_provider_id (unchanged column) so the
--                    commission trigger on provider_id keeps firing.
--
-- Nullable + on delete set null: pre-existing orders have no facility, and retiring a
-- facility must not delete order history. This does NOT touch enforce_lab_order_origin —
-- a patient-initiated order still has to tie to a due screening_schedule, exactly as
-- before; facility_id is purely additive location metadata.
--
-- lab_orders' existing RLS is unchanged (tenant-scoped); an additive nullable column
-- inherits it.

alter table public.lab_orders
  add column if not exists facility_id uuid references public.facilities (id) on delete set null;

comment on column public.lab_orders.facility_id is 'Physical facility the patient chose to collect/visit (public.facilities). Nullable — provider_id (pricing/commission) is derived from this facility''s lab_provider_id at booking time.';

create index if not exists lab_orders_facility_idx
  on public.lab_orders (facility_id)
  where facility_id is not null;
