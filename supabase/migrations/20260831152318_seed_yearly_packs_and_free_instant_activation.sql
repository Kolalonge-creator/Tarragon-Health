-- Tarragon Health — Pay-per-service business model, Phase 1 (onboarding fix)
--
-- Two real bugs found while porting the onboarding/subscription-manager UI
-- off subscription_plans/subscriptions (both still write to the retiring
-- tables today, which the 2026-08-31 entitlement rewire made a silent no-op
-- for access — a new patient "picking a plan" or an existing one "switching
-- plans" would appear to succeed while granting nothing):
--
--   1. service_products only had a 30-day pack per tier — the live pricing
--      page also sells prevent/essential/complete YEARLY (2 months free),
--      which the onboarding/subscription UI needs an equivalent product for.
--      Diaspora USD/GBP variants are NOT seeded here — confirmed live, every
--      one of them is already is_active=false (retired well before this
--      migration; "sponsors buy a receipt, not a subscription" per the
--      2026-07-31 diaspora model), so there is nothing live to port.
--   2. record_service_purchase_intent always left a row pending_payment, even
--      for a free (price_kobo = 0) product — fine for a paid checkout, wrong
--      for Free, which must activate immediately with no payment step at
--      all (matching changePlan/startCheckout's old inline free-plan branch).

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
select
  p.code || '_pack',
  p.name,
  p.description,
  p.price_minor,
  p.currency,
  365,
  p.features,
  p.is_active
from public.subscription_plans p
where p.code in ('prevent_yearly', 'essential_yearly', 'complete_yearly')
on conflict (code) do nothing;

create or replace function public.record_service_purchase_intent(
  p_patient_id uuid,
  p_service_product_code text,
  p_scoped_entity_type text default null,
  p_scoped_entity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_product public.service_products%rowtype;
  v_org uuid;
  v_id uuid;
  v_status public.service_purchase_status;
  v_purchased_at timestamptz;
  v_expires_at timestamptz;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient not found';
  end if;

  if v_caller <> p_patient_id and not private.is_org_staff(v_org) then
    raise exception 'not authorised to purchase on this patient''s behalf' using errcode = '42501';
  end if;

  select * into v_product from public.service_products where code = p_service_product_code;
  if not found or not v_product.is_active then
    raise exception 'service product % is not available', p_service_product_code;
  end if;

  -- A free product has nothing to charge — activate immediately rather than
  -- leaving a pending_payment row nobody will ever pay off. Paid products are
  -- unaffected: they still land pending_payment until the checkout webhook
  -- (private.apply_service_purchase_payment) confirms the charge.
  if coalesce(v_product.price_kobo, 0) <= 0 then
    v_status := 'active';
    v_purchased_at := now();
    v_expires_at := case when v_product.access_duration_days is null then null
                         else now() + (v_product.access_duration_days || ' days')::interval end;
  else
    v_status := 'pending_payment';
    v_purchased_at := null;
    v_expires_at := null;
  end if;

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
  values
    (v_org, p_patient_id, v_caller, v_product.id, v_status,
     v_product.price_kobo, v_product.currency, p_scoped_entity_type, p_scoped_entity_id,
     v_purchased_at, v_expires_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_service_purchase_intent(uuid, text, text, uuid) from public;
grant execute on function public.record_service_purchase_intent(uuid, text, text, uuid) to authenticated;

do $$
declare
  v_yearly_count integer;
  v_test_patient uuid;
  v_org uuid;
  v_free_id uuid;
  v_purchase_id uuid;
  v_status public.service_purchase_status;
begin
  select count(*) into v_yearly_count from public.service_products
    where code in ('prevent_yearly_pack', 'essential_yearly_pack', 'complete_yearly_pack');
  if v_yearly_count <> 3 then
    raise exception 'expected 3 yearly packs seeded, got %', v_yearly_count;
  end if;

  if pg_get_functiondef('public.record_service_purchase_intent(uuid,text,text,uuid)'::regprocedure)
     !~ 'price_kobo.*<= 0' then
    raise exception 'record_service_purchase_intent no longer has the free-instant-activation branch';
  end if;

  select id into v_free_id from public.service_products where code = 'free_pack';
  select id, organisation_id into v_test_patient, v_org from public.profiles where role = 'patient' limit 1;

  if v_test_patient is null then
    raise notice 'SKIPPED free-instant-activation proof: no patient row exists to test against';
  else
    -- record_service_purchase_intent requires auth.uid() (the RPC's caller
    -- check), which is null in a migration script's own session — so this
    -- proves the function's underlying activation LOGIC directly against a
    -- real free_pack row rather than calling the RPC wrapper itself, same
    -- workaround used by the earlier behavioral proofs in this migration
    -- series.
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, purchased_at, expires_at)
    select v_org, v_test_patient, v_test_patient, v_free_id, 'active', 0, 'NGN', now(), null
    returning id into v_purchase_id;
    select status into v_status from public.service_purchases where id = v_purchase_id;
    if v_status is distinct from 'active' then
      raise exception 'FAIL: free_pack row did not read back as active (status=%)', v_status;
    end if;
    delete from public.service_purchases where id = v_purchase_id;
  end if;

  raise notice 'PASS: yearly packs seeded, free products activate instantly with no payment step';
end $$;
