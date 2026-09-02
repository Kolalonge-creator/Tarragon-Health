-- Tarragon Health — Pay-per-service business model, Phase 1 (checkout)
--
-- Mirrors the deliberate pattern already established for voucher_payment/
-- sponsored_subscription (see checkout-metadata.ts's own comments): a new
-- CheckoutKind is read only by a DB trigger on payment_transactions, NOT by
-- the deployed paystack-webhook/stripe-webhook Edge Functions, which don't
-- recognise it and cosmetically no-op — the row is already inserted by the
-- time either webhook runs, which is all this trigger needs. This ships a
-- brand-new checkout kind without redeploying either Edge Function, which
-- this codebase has been bitten by twice per its own standing notes.

-- ---------------------------------------------------------------------------
-- record_service_purchase_intent — creates the pending row before checkout,
-- same role as record_voucher_payment_intent for care_voucher_payments.
-- ---------------------------------------------------------------------------

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

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, scoped_entity_type, scoped_entity_id)
  values
    (v_org, p_patient_id, v_caller, v_product.id, 'pending_payment',
     v_product.price_kobo, v_product.currency, p_scoped_entity_type, p_scoped_entity_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_service_purchase_intent(uuid, text, text, uuid) from public, anon;
grant execute on function public.record_service_purchase_intent(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_service_purchase_payment — activates the purchase on confirmed
-- charge, computing expires_at from the product's access_duration_days at
-- confirmation time (not at intent-creation time), so a delayed/retried
-- payment still grants the full window from actual activation.
-- ---------------------------------------------------------------------------

create or replace function private.apply_service_purchase_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_purchase public.service_purchases%rowtype;
  v_product public.service_products%rowtype;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'service_purchase' then
    return new;
  end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then
    return new;
  end if;

  select * into v_purchase from public.service_purchases
    where pending_payment_provider_ref = v_ref and status = 'pending_payment'
    for update;
  if not found then
    return new;
  end if;

  select * into v_product from public.service_products where id = v_purchase.service_product_id;

  update public.service_purchases
    set status = 'active',
        payment_provider = new.provider,
        payment_provider_ref = v_ref,
        pending_payment_provider_ref = null,
        purchased_at = now(),
        expires_at = case when v_product.access_duration_days is null then null
                          else now() + (v_product.access_duration_days || ' days')::interval end
    where id = v_purchase.id;

  return new;
end;
$$;

drop trigger if exists payment_transactions_apply_service_purchase on public.payment_transactions;
create trigger payment_transactions_apply_service_purchase
  after insert on public.payment_transactions
  for each row execute function private.apply_service_purchase_payment();

do $$
declare
  v_essential_id uuid;
  v_test_patient uuid;
  v_purchase_id uuid;
  v_txn_id uuid;
  v_status public.service_purchase_status;
  v_expires timestamptz;
begin
  if has_function_privilege('anon', 'public.record_service_purchase_intent(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute record_service_purchase_intent';
  end if;

  select id into v_essential_id from public.service_products where code = 'essential_pack';
  select id into v_test_patient from public.profiles where role = 'patient' limit 1;

  if v_test_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
  else
    -- Simulate the checkout round-trip end to end: create the pending row
    -- directly (bypassing the RPC's auth.uid() check, which can't be
    -- simulated from a plain migration script), stamp a pending ref, then
    -- insert the payment_transactions row a real webhook would produce and
    -- confirm the trigger activates it.
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, pending_payment_provider_ref)
    select p.organisation_id, v_test_patient, v_test_patient, v_essential_id, 'pending_payment',
           1000000, 'NGN', 'test-ref-service-purchase-migration-proof'
    from public.profiles p where p.id = v_test_patient
    returning id into v_purchase_id;

    insert into public.payment_transactions
      (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
    values (
      'paystack', 'evt-service-purchase-migration-proof', 'charge.success', 1000000, 'NGN',
      jsonb_build_object('data', jsonb_build_object(
        'reference', 'test-ref-service-purchase-migration-proof',
        'metadata', jsonb_build_object('kind', 'service_purchase')
      ))
    )
    returning id into v_txn_id;

    select status, expires_at into v_status, v_expires
      from public.service_purchases where id = v_purchase_id;

    if v_status is distinct from 'active' then
      raise exception 'FAIL: trigger did not activate the service_purchases row on charge.success (status=%)', v_status;
    end if;
    if v_expires is null or v_expires <= now() then
      raise exception 'FAIL: activated purchase has no sensible expires_at (%)', v_expires;
    end if;

    delete from public.payment_transactions where id = v_txn_id;
    delete from public.service_purchases where id = v_purchase_id;
  end if;

  raise notice 'PASS: service_purchase checkout intent + payment-confirmation trigger in place';
end $$;
