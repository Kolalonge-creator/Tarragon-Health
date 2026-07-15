-- Tarragon Health — Home collection + delivery logistics columns (Workstream 3)
--
-- Adds home-visit scheduling to lab_orders and delivery tracking to
-- pharmacy_orders. Both new FK columns are staff-write-only in effect: the
-- existing lab_orders_update/pharmacy_orders_update RLS policies (from
-- 20260705211315_care_coordination.sql, never modified since — only INSERT
-- was tightened by clinician_originated_orders) already restrict UPDATE to
-- private.is_org_staff(organisation_id) on both tables, with no patient
-- UPDATE path at all. Verified directly against the live policies
-- (pg_policy) before writing this migration — patients have zero UPDATE
-- grant on either table, so no additional column-scoped guard trigger is
-- needed here. The one exception (patient setting their own delivery
-- address) is handled by a narrow security definer RPC in a later migration,
-- not by loosening this table's general UPDATE policy.
--
-- delivery_address is validated by a Zod schema at the API/RPC layer (see
-- apps/web/src/components/delivery-address-form.tsx and the
-- set_pharmacy_order_delivery_address RPC) — no DB-level CHECK constraint on
-- its jsonb shape, consistent with how pharmacy_orders.items is already
-- handled with no CHECK.

alter table public.lab_orders
  add column home_visit_provider_id uuid references public.home_visit_providers (id) on delete set null,
  add column home_visit_scheduled_at timestamptz,
  add column courier_reference text;

alter table public.pharmacy_orders
  add column logistics_partner_id uuid references public.logistics_partners (id) on delete set null,
  add column delivery_address jsonb,
  add column estimated_delivery_at timestamptz,
  add column courier_reference text,
  add column delivery_confirmed_at timestamptz;

create index lab_orders_home_visit_provider_idx
  on public.lab_orders (home_visit_provider_id) where home_visit_provider_id is not null;

create index pharmacy_orders_logistics_partner_idx
  on public.pharmacy_orders (logistics_partner_id) where logistics_partner_id is not null;
