-- Fix: wallet_pay_booking_order's referral branch read specialist_referrals.
-- total_kobo, a column that doesn't exist on that table (it's
-- referral_fee_kobo — total_kobo only exists on lab_orders/pharmacy_orders).
-- This would have thrown "column total_kobo does not exist" the first time
-- any patient tried to pay a specialist referral fee from their wallet
-- balance. Found during pre-merge schema verification against the live
-- project; never triggered by a real transaction.
create or replace function public.wallet_pay_booking_order(p_order_type text, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_wallet uuid;
  v_total bigint;
  v_patient uuid;
  v_status text;
  v_entry uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, total_kobo into v_patient, v_status, v_total
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, total_kobo into v_patient, v_status, v_total
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, status::text, referral_fee_kobo into v_patient, v_status, v_total
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;
  if v_patient <> v_caller then raise exception 'not your order' using errcode = '42501'; end if;
  if v_status <> 'pending_payment' then raise exception 'order is not awaiting payment'; end if;
  if v_total is null or v_total <= 0 then raise exception 'order has no payable amount'; end if;

  v_wallet := private.ensure_wallet(v_caller);

  v_entry := private.wallet_apply(
    v_wallet, -v_total, 'spend', v_caller,
    null, null, null,
    p_order_type::public.commission_type, p_order_id
  );

  if p_order_type = 'lab' then
    update public.lab_orders
      set status = 'payment_confirmed', payment_provider = 'wallet',
          payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
      where id = p_order_id;
  elsif p_order_type = 'pharmacy' then
    update public.pharmacy_orders
      set status = 'payment_confirmed', payment_provider = 'wallet',
          payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
      where id = p_order_id;
  else
    update public.specialist_referrals
      set status = 'payment_confirmed', payment_provider = 'wallet',
          payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
      where id = p_order_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'balance_kobo', (select balance_kobo from public.health_wallets where id = v_wallet)
  );
end;
$$;
