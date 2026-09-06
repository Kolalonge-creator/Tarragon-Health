-- Let a sponsor actually buy the care they are funding.
--
-- The Health Wallet has always allowed anyone with a profile_access grant to
-- put money IN (private.can_fund_wallet), but public.wallet_pay_booking_order
-- refuses any wallet but the caller's own. So the money went in and then sat
-- there until the patient themselves pressed pay. For the case the wallet was
-- built for, an adult child funding an elderly parent's care from abroad, that
-- is precisely the step that does not happen: the parent is the person least
-- likely to complete a checkout, which is why somebody else is paying.
--
-- Deliberately a separate function rather than a relaxation of
-- wallet_pay_booking_order. The self-pay path is live and working, and there is
-- no reason to put a new authorization branch inside it.
--
-- 'manage' only, never 'view'. The existing split is that a view grantee
-- follows a record and a manage grantee acts on it, and manage is only ever
-- reached by the record owner explicitly accepting a care_access_request (or by
-- a parent for a child with no login of their own). Settling a bill is acting.
-- A next of kin naming themselves must not thereby acquire the ability to move
-- someone else's balance.
--
-- On the money itself: a Health Wallet balance belongs to the person it is held
-- for, and can only ever leave it as a Tarragon order for that same person. It
-- is not withdrawable and cannot be redirected. So the worst a manage grantee
-- can do through this function is cause that person's own healthcare to be paid
-- for, which is the entire content of the relationship.
create or replace function public.sponsor_pay_booking_order(
  p_beneficiary uuid,
  p_order_type text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_wallet  uuid;
  v_total   bigint;
  v_patient uuid;
  v_status  text;
  v_entry   uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  if not exists (
    select 1
      from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to pay for this person''s care'
      using errcode = '42501';
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
  -- The grant is checked against p_beneficiary, so the order must actually be
  -- theirs. Without this, a real grant over one person would be a lever onto
  -- any order id in the system.
  if v_patient <> p_beneficiary then
    raise exception 'that order does not belong to the person named' using errcode = '42501';
  end if;
  if v_status <> 'pending_payment' then raise exception 'order is not awaiting payment'; end if;
  if v_total is null or v_total <= 0 then raise exception 'order has no payable amount'; end if;

  v_wallet := private.ensure_wallet(p_beneficiary);

  -- Actor is the sponsor, not the patient, so the ledger records who actually
  -- acted and the spend receipt trigger has an honest audit trail.
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

revoke all on function public.sponsor_pay_booking_order(uuid, text, uuid) from public, anon;
revoke all on function public.sponsor_pay_booking_order(uuid, text, uuid) from anon;
grant execute on function public.sponsor_pay_booking_order(uuid, text, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sponsor_pay_booking_order(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to settle anyone''s care bill';
  end if;
  if not has_function_privilege('authenticated', 'public.sponsor_pay_booking_order(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'authenticated must be able to call the sponsor payment path';
  end if;
end $$;
