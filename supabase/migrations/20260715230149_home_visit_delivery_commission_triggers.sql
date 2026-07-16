-- Tarragon Health — Home visit / delivery commission recording (Workstream 3)
--
-- Unlike the existing lab/pharmacy/referral commission triggers (which fire
-- on the payment_confirmed status transition, per
-- 20260715115451_commission_dashboard.sql), home-visit and delivery
-- commissions are a separate, later event: partner assignment happens after
-- payment, when ops assigns a home-visit provider or courier/logistics
-- partner to an already-paid order. These triggers fire on the null->non-null
-- transition of the new FK columns added in
-- 20260716140500_lab_pharmacy_orders_logistics_columns.sql, not on status.

create or replace function private.record_home_visit_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_name text;
  fee_kobo bigint;
begin
  select name, home_visit_fee_kobo into provider_name, fee_kobo
  from public.home_visit_providers
  where id = new.home_visit_provider_id;

  insert into public.commissions (
    organisation_id, commission_type, source_id, source_reference,
    partner_name, amount_kobo, rate, rate_type
  ) values (
    new.organisation_id, 'home_visit', new.id, new.order_number,
    provider_name, coalesce(fee_kobo, 0), null, 'flat'
  );

  return new;
end;
$$;

create trigger lab_orders_record_home_visit_commission
  after update on public.lab_orders
  for each row
  when (old.home_visit_provider_id is distinct from new.home_visit_provider_id and new.home_visit_provider_id is not null)
  execute function private.record_home_visit_commission();

create or replace function private.record_delivery_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  partner_name_val text;
  fee_kobo bigint;
begin
  select name, delivery_fee_kobo into partner_name_val, fee_kobo
  from public.logistics_partners
  where id = new.logistics_partner_id;

  insert into public.commissions (
    organisation_id, commission_type, source_id, source_reference,
    partner_name, amount_kobo, rate, rate_type
  ) values (
    new.organisation_id, 'delivery', new.id, new.order_number,
    partner_name_val, coalesce(fee_kobo, 0), null, 'flat'
  );

  return new;
end;
$$;

create trigger pharmacy_orders_record_delivery_commission
  after update on public.pharmacy_orders
  for each row
  when (old.logistics_partner_id is distinct from new.logistics_partner_id and new.logistics_partner_id is not null)
  execute function private.record_delivery_commission();
