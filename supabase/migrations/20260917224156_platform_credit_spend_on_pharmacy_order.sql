-- Tarragon Health — Platform Credit, part 7: spend it on a pharmacy order.
--
-- Same shape as 20260917100605_platform_credit_spend_on_service_purchase.sql
-- (pay_service_purchase_on_platform_credit), retargeted at pharmacy_orders:
-- lock the order row, require status='pending_payment' (the same state
-- apps/web/src/app/(dashboard)/patient/pharmacy/actions.ts's
-- payForPharmacyOrder requires before starting a Paystack checkout) and
-- caller ownership (patient_id = caller, or org staff — the same check
-- requireOwnedBookingOrder does before ever calling
-- initiateBookingCheckout), settle from the patient's platform_credit
-- balance, then UPDATE pharmacy_orders with the exact four columns
-- supabase/functions/paystack-webhook/index.ts's charge.success/booking
-- branch sets (status/payment_provider/payment_provider_ref/
-- pending_payment_provider_ref) — so every existing AFTER/BEFORE UPDATE
-- trigger keyed on "new.status = 'payment_confirmed'"
-- (pharmacy_orders_enqueue_notifications, pharmacy_orders_record_commission,
-- pharmacy_orders_referral_reward, pharmacy_orders_snapshot_partner_cost,
-- pharmacy_orders_enqueue_response_notifications,
-- pharmacy_orders_enqueue_fulfilment_notifications) fires exactly as it
-- would for a card payment. pharmacy_orders has no purchased_at/expires_at
-- equivalent (those are service_purchases-only columns), so there is
-- nothing else to stamp.
--
-- payable_kobo (generated: greatest(total_kobo - voucher_covered_kobo, 0))
-- is what is actually owed, same as service_purchases.payable_kobo — a
-- voucher-discounted order must not be charged its full pre-discount price.
-- A pharmacy_orders row only ever reaches 'pending_payment' with a nonzero
-- payable_kobo (see 20260731215326_care_vouchers_redemption.sql's redeem
-- path, which flips a fully-voucher-covered order straight to
-- 'payment_confirmed' itself, and
-- 20260905000112_force_safe_patient_order_insert_defaults.sql, which forces
-- every patient-created order to open in 'pending_payment'); the
-- amount<=0 branch below is defensive parity with the service_purchases
-- version, not a reachable path today.

create or replace function public.pay_pharmacy_order_on_platform_credit(
  p_pharmacy_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_order public.pharmacy_orders%rowtype;
  v_amount_kobo bigint;
  v_ledger_entry_id uuid;
  v_new_balance bigint;
  v_balance public.platform_credit_balances%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order from public.pharmacy_orders
    where id = p_pharmacy_order_id for update;
  if not found then
    raise exception 'pharmacy order not found';
  end if;
  if v_order.status <> 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'not_payable', 'status', v_order.status);
  end if;
  if v_order.patient_id <> v_caller and not private.is_org_staff(v_order.organisation_id) then
    raise exception 'not authorised to pay for this order' using errcode = '42501';
  end if;

  v_amount_kobo := coalesce(v_order.payable_kobo, v_order.total_kobo);
  if v_amount_kobo is null or v_amount_kobo <= 0 then
    return jsonb_build_object('ok', true, 'already_active', v_order.status = 'payment_confirmed');
  end if;

  select * into v_balance from public.platform_credit_balances where patient_id = v_order.patient_id;

  if v_balance.patient_id is null or v_balance.balance_kobo < v_amount_kobo then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance_kobo', coalesce(v_balance.balance_kobo, 0),
      'required_kobo', v_amount_kobo,
      'shortfall_kobo', v_amount_kobo - coalesce(v_balance.balance_kobo, 0)
    );
  end if;

  v_new_balance := private.platform_credit_apply(
    p_patient_id := v_order.patient_id,
    p_organisation_id := v_order.organisation_id,
    p_entry_type := 'spend',
    p_amount_kobo := v_amount_kobo,
    p_description := 'Pharmacy order: ' || coalesce(v_order.order_number, v_order.id::text)
  );

  -- No p_pharmacy_order_id param exists on private.platform_credit_apply
  -- (deliberately not adding one — see this migration set's schema-change
  -- file), so the row it just inserted is found the same way any other
  -- caller without a dedicated correlation param would: most recent 'spend'
  -- row for this patient. Safe from a race with a concurrent spend for the
  -- SAME patient because platform_credit_apply just released the
  -- platform_credit_balances row lock for this patient_id only at COMMIT of
  -- this very transaction — no other session's spend for this patient can
  -- have inserted a ledger row in between.
  select id into v_ledger_entry_id from public.platform_credit_ledger_entries
    where patient_id = v_order.patient_id and entry_type = 'spend'
    order by created_at desc limit 1;

  update public.platform_credit_ledger_entries
    set booking_order_id = v_order.id, booking_order_type = 'pharmacy'
    where id = v_ledger_entry_id;

  update public.pharmacy_orders
    set status = 'payment_confirmed',
        payment_provider = 'platform_credit',
        payment_provider_ref = v_ledger_entry_id::text,
        pending_payment_provider_ref = null
    where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'pharmacy_order_id', v_order.id,
    'amount_kobo', v_amount_kobo,
    'new_balance_kobo', v_new_balance
  );

exception
  when sqlstate 'TH001' then
    select * into v_balance from public.platform_credit_balances where patient_id = v_order.patient_id;
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance_kobo', coalesce(v_balance.balance_kobo, 0),
      'required_kobo', v_amount_kobo,
      'shortfall_kobo', v_amount_kobo - coalesce(v_balance.balance_kobo, 0)
    );
end;
$$;

revoke execute on function public.pay_pharmacy_order_on_platform_credit(uuid) from public, anon;
grant execute on function public.pay_pharmacy_order_on_platform_credit(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.pay_pharmacy_order_on_platform_credit(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute pay_pharmacy_order_on_platform_credit';
  end if;
  raise notice 'PASS: pay_pharmacy_order_on_platform_credit installed, anon denied';
end $$;
