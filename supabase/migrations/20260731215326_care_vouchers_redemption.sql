-- Care Vouchers, part 4: redemption. This is the migration that carries the
-- single-purpose guarantee.
--
-- The wallet asked "is the balance >= the order total". A voucher asks "is
-- this order FOR THE SERVICE THIS VOUCHER IS", and refuses otherwise. That
-- difference is the whole point: a prepaid voucher is an entitlement to one
-- named service, not spending power that happens to be worth its price.
--
-- Renaming discount_kobo -> voucher_covered_kobo, because the column carries
-- two different things and only one of them is a discount: a prepaid voucher
-- covers an order because the patient already paid for that exact service,
-- while a reward voucher discounts it. "Covered" is true of both and does not
-- misdescribe prepayment as a price cut. Nothing reads the old name yet.

alter table public.lab_orders rename column discount_kobo to voucher_covered_kobo;
alter table public.pharmacy_orders rename column discount_kobo to voucher_covered_kobo;
alter table public.specialist_referrals rename column discount_kobo to voucher_covered_kobo;

comment on column public.lab_orders.voucher_covered_kobo is
  'Portion of this order already met by a care voucher — prepayment for a prepaid_service voucher, a discount for a reward_discount one. total_kobo stays the honest catalogue price; payable_kobo is what the card is charged.';

-- ---------------------------------------------------------------------------
-- Redeem. Serves both the patient themselves and a sponsor holding a 'manage'
-- grant, deliberately as one function: the checks are identical apart from who
-- is allowed to press the button, and the money cannot be redirected either
-- way — a voucher can only ever become care for its own named beneficiary.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_care_voucher(
  p_voucher uuid,
  p_order_type text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_v       public.care_vouchers%rowtype;
  v_patient uuid;
  v_status  text;
  v_payable bigint;
  v_bundle  uuid;
  v_covered bigint;
  v_fully   boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;

  -- Authorisation. 'manage' only for a third party, never 'view': the existing
  -- split is that a view grantee follows a record and a manage grantee acts on
  -- it. Spending somebody's prepaid care is acting.
  if v_v.beneficiary_profile_id <> v_caller
     and not exists (
       select 1 from public.profile_access pa
       where pa.profile_id = v_v.beneficiary_profile_id
         and pa.grantee_user_id = v_caller
         and pa.permission_level = 'manage'
     ) then
    raise exception 'This voucher is not yours to use' using errcode = '42501';
  end if;

  if v_v.status = 'redeemed' then raise exception 'This voucher has already been used'; end if;
  if v_v.status = 'expired' then raise exception 'This voucher has expired'; end if;
  if v_v.status = 'cancelled' then raise exception 'This voucher was cancelled'; end if;
  if v_v.status = 'reserved' then
    raise exception 'This voucher is not paid for yet — % of % paid',
      (v_v.amount_paid_kobo / 100)::text, (v_v.face_value_kobo / 100)::text;
  end if;
  -- Belt and braces alongside the nightly sweep: an expiry that has passed but
  -- not yet been swept must not be spendable.
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'This voucher expired on %', to_char(v_v.expires_at, 'DD Mon YYYY');
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, payable_kobo, panel_bundle_id
      into v_patient, v_status, v_payable, v_bundle
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;

  -- Non-transferability at the point of use. Even a real 'manage' grant over
  -- one person is not a lever onto anybody else's order.
  if v_patient <> v_v.beneficiary_profile_id then
    raise exception 'This voucher can only be used for %s own care',
      (select coalesce(full_name, 'its beneficiary') from public.profiles where id = v_v.beneficiary_profile_id)
      using errcode = '42501';
  end if;
  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;

  if v_v.kind = 'prepaid_service' then
    -- THE SINGLE-PURPOSE CHECK. Not a balance comparison.
    if p_order_type <> 'lab' then
      raise exception 'A % voucher can only be used for the service it was bought for', v_v.sku_name;
    end if;
    if v_bundle is distinct from v_v.panel_bundle_id then
      raise exception 'This voucher is for %, so it cannot pay for a different service', v_v.sku_name;
    end if;
    -- A prepaid voucher settles its own service outright. If the catalogue
    -- price has risen since purchase the patient is not chased for the
    -- difference: they bought the service, not an amount of money.
    v_covered := v_payable;
  else
    v_covered := least(v_v.face_value_kobo, v_payable);
  end if;

  v_fully := (v_payable - v_covered) <= 0;

  if p_order_type = 'lab' then
    update public.lab_orders
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.lab_order_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  elsif p_order_type = 'pharmacy' then
    update public.pharmacy_orders
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.pharmacy_order_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  else
    update public.specialist_referrals
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.referral_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  end if;

  update public.care_vouchers
     set status = 'redeemed', redeemed_at = now(),
         redeemed_order_type = p_order_type::public.commission_type,
         redeemed_order_id = p_order_id
   where id = v_v.id;

  insert into public.care_voucher_events
    (organisation_id, voucher_id, event_type, actor_profile_id, amount_kobo, note)
  values
    (v_v.organisation_id, v_v.id, 'redeemed', v_caller, v_covered,
     case when v_v.kind = 'prepaid_service'
          then 'Used for ' || coalesce(v_v.sku_name, 'the service it was bought for')
          else 'Applied as a discount' end);

  return jsonb_build_object(
    'ok', true,
    'covered_kobo', v_covered,
    'fully_covered', v_fully,
    'remaining_payable_kobo', greatest(v_payable - v_covered, 0)
  );
end;
$$;

revoke all on function public.redeem_care_voucher(uuid, text, uuid) from public;
revoke all on function public.redeem_care_voucher(uuid, text, uuid) from anon;
grant execute on function public.redeem_care_voucher(uuid, text, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.redeem_care_voucher(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to redeem a voucher';
  end if;
  if not has_function_privilege('authenticated', 'public.redeem_care_voucher(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'authenticated must be able to redeem their own voucher';
  end if;
  -- There must be no path anywhere that turns a voucher into money.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ilike '%care_vouchers%'
      and (p.prosrc ilike '%payout%' or p.prosrc ilike '%withdraw%' or p.prosrc ilike '%cash_out%')
  ) then
    raise exception 'a voucher must never be cash-redeemable';
  end if;
end $$;;
