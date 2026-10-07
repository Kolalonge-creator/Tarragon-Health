-- Tarragon Health — Platform Credit, part 8: spend it on a specialist
-- referral, for completeness.
--
-- Same shape again, retargeted at specialist_referrals. Built for schema
-- completeness even though no live UI currently calls it — confirmed by
-- reading apps/web/src/components/your-referrals.tsx, which tells every
-- patient, unconditionally, "Tarragon does not book the specialist or take
-- a fee on one... you pay that clinic directly," and by grepping the app for
-- any call to requireOwnedBookingOrder("referral", ...) or
-- initiateBookingCheckout with orderType:"referral" (none exists). The
-- referral_status enum's pending_payment/payment_confirmed values and
-- specialist_referrals.payable_kobo are real, already-shipped schema
-- (20260715001653_booking_status_enum_values.sql,
-- 20260731214826_care_vouchers_enums_and_order_discount.sql) — apparently
-- laid down for a Tarragon-collected referral fee path (e.g. a future
-- internally-matched specialist visit) that was never wired up to a patient
-- checkout. This closes the platform-credit gap for that path the same way
-- lab/pharmacy already got closed, without adding any patient-facing entry
-- point of its own — no button anywhere calls this function today.
--
-- referral_fee_kobo is the analogue of pharmacy_orders.total_kobo /
-- service_products.price_kobo here; payable_kobo is generated as
-- greatest(referral_fee_kobo - voucher_covered_kobo, 0), same voucher-aware
-- shape as the other two booking tables. specialist_referrals has no
-- purchaser_profile_id column (only patient_id), same as pharmacy_orders, so
-- the authorisation check mirrors that one exactly.

create or replace function public.pay_specialist_referral_on_platform_credit(
  p_referral_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_referral public.specialist_referrals%rowtype;
  v_amount_kobo bigint;
  v_ledger_entry_id uuid;
  v_new_balance bigint;
  v_balance public.platform_credit_balances%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_referral from public.specialist_referrals
    where id = p_referral_id for update;
  if not found then
    raise exception 'referral not found';
  end if;
  if v_referral.status <> 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'not_payable', 'status', v_referral.status);
  end if;
  if v_referral.patient_id <> v_caller and not private.is_org_staff(v_referral.organisation_id) then
    raise exception 'not authorised to pay for this referral' using errcode = '42501';
  end if;

  v_amount_kobo := coalesce(v_referral.payable_kobo, v_referral.referral_fee_kobo);
  if v_amount_kobo is null or v_amount_kobo <= 0 then
    return jsonb_build_object('ok', true, 'already_active', v_referral.status = 'payment_confirmed');
  end if;

  select * into v_balance from public.platform_credit_balances where patient_id = v_referral.patient_id;

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
    p_patient_id := v_referral.patient_id,
    p_organisation_id := v_referral.organisation_id,
    p_entry_type := 'spend',
    p_amount_kobo := v_amount_kobo,
    p_description := 'Specialist referral: ' || coalesce(v_referral.referral_number, v_referral.id::text)
  );

  -- Same reasoning as pay_pharmacy_order_on_platform_credit: no dedicated
  -- correlation param on platform_credit_apply, so pick up the row it just
  -- inserted by patient_id + entry_type, safe from a same-patient race for
  -- the same lock-lifetime reason documented there.
  select id into v_ledger_entry_id from public.platform_credit_ledger_entries
    where patient_id = v_referral.patient_id and entry_type = 'spend'
    order by created_at desc limit 1;

  update public.platform_credit_ledger_entries
    set booking_order_id = v_referral.id, booking_order_type = 'referral'
    where id = v_ledger_entry_id;

  update public.specialist_referrals
    set status = 'payment_confirmed',
        payment_provider = 'platform_credit',
        payment_provider_ref = v_ledger_entry_id::text,
        pending_payment_provider_ref = null
    where id = v_referral.id;

  return jsonb_build_object(
    'ok', true,
    'referral_id', v_referral.id,
    'amount_kobo', v_amount_kobo,
    'new_balance_kobo', v_new_balance
  );

exception
  when sqlstate 'TH001' then
    select * into v_balance from public.platform_credit_balances where patient_id = v_referral.patient_id;
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance_kobo', coalesce(v_balance.balance_kobo, 0),
      'required_kobo', v_amount_kobo,
      'shortfall_kobo', v_amount_kobo - coalesce(v_balance.balance_kobo, 0)
    );
end;
$$;

revoke execute on function public.pay_specialist_referral_on_platform_credit(uuid) from public, anon;
grant execute on function public.pay_specialist_referral_on_platform_credit(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.pay_specialist_referral_on_platform_credit(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute pay_specialist_referral_on_platform_credit';
  end if;
  raise notice 'PASS: pay_specialist_referral_on_platform_credit installed, anon denied';
end $$;
