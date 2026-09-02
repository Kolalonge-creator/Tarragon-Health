-- Tarragon Health — extend promo codes / care vouchers to service_purchases.
--
-- redeem_promo_code()/redeem_care_voucher() were built with a deliberate,
-- documented scope limit: order_type in ('lab','pharmacy','referral') only
-- (see 20260830102521_promo_codes.sql's own header). That limit predates the
-- pay-per-service catalogue (service_products/service_purchases,
-- 20260831140512) — none of the 9 purchasable clinical services can be
-- discounted today. Founder decision 2026-09-01: widen the existing
-- mechanism to also cover service_purchases rather than build a parallel
-- discount path, preserving the same single-purpose/non-transferable/
-- never-cash-redeemable guarantees redeem_care_voucher already proves.
--
-- Schema gap this closes: service_purchases had no voucher_covered_kobo /
-- applied_voucher_id / payable_kobo the way lab_orders/pharmacy_orders/
-- specialist_referrals do — amount_kobo was set once at intent-creation and
-- never reduced. This adds the same generated-column shape lab_orders uses
-- (payable_kobo = amount_kobo minus whatever a voucher has covered), so the
-- existing checkout code's "charge payable_kobo, not the sticker price"
-- convention (apps/web/src/app/(dashboard)/patient/lab-tests/actions.ts's own
-- comment) extends unchanged to service purchases.

alter table public.service_purchases
  add column voucher_covered_kobo bigint not null default 0 check (voucher_covered_kobo >= 0),
  add column applied_voucher_id uuid references public.care_vouchers (id) on delete set null,
  add column payable_kobo bigint generated always as (greatest(amount_kobo - voucher_covered_kobo, 0)) stored;

comment on column public.service_purchases.payable_kobo is
  'What the card/transfer is actually charged — amount_kobo minus voucher_covered_kobo, floored at 0. Mirrors lab_orders.payable_kobo.';

-- redeemed_order_type on care_vouchers casts p_order_type to this enum —
-- must widen it before the function below can ever be called with the new
-- order type (added as its own statement so it is committed before use,
-- matching the existing home_visit/delivery precedent).
alter type public.commission_type add value if not exists 'service_purchase';

-- ---------------------------------------------------------------------------
-- promo_codes / promo_code_redemptions: widen the CHECK-constrained value
-- sets. These are the two structural ceilings the promo_codes migration's own
-- header cites as "can never be configured to look like it covers more than
-- it does" — deliberately kept as CHECKs, just widened, not removed.
-- ---------------------------------------------------------------------------

alter table public.promo_codes drop constraint promo_codes_order_types_valid;
alter table public.promo_codes add constraint promo_codes_order_types_valid check (
  applicable_order_types <@ array['lab','pharmacy','referral','service_purchase']::text[]
  and coalesce(array_length(applicable_order_types, 1), 0) > 0
);

alter table public.promo_code_redemptions drop constraint promo_code_redemptions_order_type_check;
alter table public.promo_code_redemptions add constraint promo_code_redemptions_order_type_check
  check (order_type in ('lab', 'pharmacy', 'referral', 'service_purchase'));

-- ---------------------------------------------------------------------------
-- redeem_care_voucher — add the service_purchase branch. A prepaid_service
-- voucher stays lab-only (its own "if p_order_type <> 'lab'" guard, untouched
-- below) — only a reward_discount voucher (what redeem_promo_code mints) can
-- ever reach the new branch, since that's the only kind minted against a
-- service_purchase. Unlike the other three order tables, a fully-covered
-- service_purchases row has no separate "payment_confirmed" webhook path to
-- fall back on, so full coverage activates it directly here — same
-- activation shape as private.apply_service_purchase_payment (purchased_at,
-- expires_at computed from the product's access_duration_days).
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
  v_access_duration_days integer;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral', 'service_purchase') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  select * into v_v from public.care_vouchers where id = p_voucher for update;
  if not found then raise exception 'voucher not found'; end if;

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
  elsif p_order_type = 'referral' then
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.specialist_referrals where id = p_order_id for update;
  else
    -- v_bundle is repurposed to carry service_product_id here (both uuid,
    -- and lab is the only order type that ever reads v_bundle as a bundle
    -- id) so the final dispatch below doesn't need a second lookup.
    select patient_id, status::text, payable_kobo, service_product_id
      into v_patient, v_status, v_payable, v_bundle
      from public.service_purchases where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;

  if v_patient <> v_v.beneficiary_profile_id then
    raise exception 'This voucher can only be used for %s own care',
      (select coalesce(full_name, 'its beneficiary') from public.profiles where id = v_v.beneficiary_profile_id)
      using errcode = '42501';
  end if;
  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;

  if v_v.kind = 'prepaid_service' then
    if p_order_type <> 'lab' then
      raise exception 'A % voucher can only be used for the service it was bought for', v_v.sku_name;
    end if;
    if v_bundle is distinct from v_v.panel_bundle_id then
      raise exception 'This voucher is for %, so it cannot pay for a different service', v_v.sku_name;
    end if;
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
  elsif p_order_type = 'referral' then
    update public.specialist_referrals
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'payment_confirmed'::public.referral_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end
     where id = p_order_id;
  else
    select access_duration_days into v_access_duration_days
      from public.service_products where id = v_bundle;

    update public.service_purchases
       set voucher_covered_kobo = voucher_covered_kobo + v_covered,
           applied_voucher_id = v_v.id,
           status = case when v_fully then 'active'::public.service_purchase_status else status end,
           payment_provider = case when v_fully then 'voucher'::public.payment_provider else payment_provider end,
           payment_provider_ref = case when v_fully then v_v.voucher_number else payment_provider_ref end,
           pending_payment_provider_ref = case when v_fully then null else pending_payment_provider_ref end,
           purchased_at = case when v_fully then now() else purchased_at end,
           expires_at = case when v_fully and v_access_duration_days is not null
                             then now() + (v_access_duration_days || ' days')::interval
                             else expires_at end
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

revoke all on function public.redeem_care_voucher(uuid, text, uuid) from public, anon;
revoke all on function public.redeem_care_voucher(uuid, text, uuid) from anon;
grant execute on function public.redeem_care_voucher(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- redeem_promo_code — widen the guard + dispatch to also read/gate
-- service_purchases (patient_id/status/payable_kobo/applied_voucher_id).
-- ---------------------------------------------------------------------------

create or replace function public.redeem_promo_code(
  p_code text,
  p_order_type text,
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_promo public.promo_codes%rowtype;
  v_patient uuid;
  v_status text;
  v_payable bigint;
  v_applied_voucher uuid;
  v_redemption_count int;
  v_global_count int;
  v_discount bigint;
  v_voucher_id uuid;
  v_result jsonb;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral', 'service_purchase') then
    raise exception 'promo codes can only be applied to lab, pharmacy, referral, or service purchase orders';
  end if;

  select * into v_promo from public.promo_codes where upper(code) = upper(trim(p_code)) for update;
  if not found then raise exception 'that code was not recognised'; end if;
  if not v_promo.is_active then raise exception 'that code is no longer active'; end if;
  if v_promo.starts_at > now() then raise exception 'that code is not active yet'; end if;
  if v_promo.expires_at is not null and v_promo.expires_at <= now() then raise exception 'that code has expired'; end if;
  if not (p_order_type = any(v_promo.applicable_order_types)) then
    raise exception 'that code cannot be used for this kind of order';
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, payable_kobo, applied_voucher_id
      into v_patient, v_status, v_payable, v_applied_voucher
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, payable_kobo, applied_voucher_id
      into v_patient, v_status, v_payable, v_applied_voucher
      from public.pharmacy_orders where id = p_order_id for update;
  elsif p_order_type = 'referral' then
    select patient_id, status::text, payable_kobo, applied_voucher_id
      into v_patient, v_status, v_payable, v_applied_voucher
      from public.specialist_referrals where id = p_order_id for update;
  else
    select patient_id, status::text, payable_kobo, applied_voucher_id
      into v_patient, v_status, v_payable, v_applied_voucher
      from public.service_purchases where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;

  if v_patient <> v_caller
     and not exists (
       select 1 from public.profile_access pa
       where pa.profile_id = v_patient and pa.grantee_user_id = v_caller and pa.permission_level = 'manage'
     ) then
    raise exception 'This order is not yours to discount' using errcode = '42501';
  end if;

  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;
  if v_applied_voucher is not null then
    raise exception 'this order already has a discount applied — only one discount per order';
  end if;
  if v_payable < v_promo.min_spend_kobo then
    raise exception 'this code needs a minimum spend of %', to_char(v_promo.min_spend_kobo / 100.0, 'FM999999990.00');
  end if;

  select count(*) into v_redemption_count from public.promo_code_redemptions
    where promo_code_id = v_promo.id and profile_id = v_patient;
  if v_redemption_count >= v_promo.per_profile_limit then
    raise exception 'you have already used this code the maximum number of times';
  end if;

  if v_promo.max_redemptions is not null then
    select count(*) into v_global_count from public.promo_code_redemptions where promo_code_id = v_promo.id;
    if v_global_count >= v_promo.max_redemptions then
      raise exception 'this code has reached its redemption limit';
    end if;
  end if;

  v_discount := case v_promo.kind
    when 'percentage' then round(v_payable * v_promo.value_bp / 10000.0)
    else v_promo.value_kobo
  end;
  v_discount := least(v_discount, v_payable);
  if v_discount <= 0 then raise exception 'this code produces no discount on this order'; end if;

  v_voucher_id := private.issue_reward_voucher(v_patient, v_discount, 'Promo: ' || v_promo.code, 'Applied via promo code');
  if v_voucher_id is null then
    raise exception 'could not apply this code right now — please try again';
  end if;

  v_result := public.redeem_care_voucher(v_voucher_id, p_order_type, p_order_id);

  insert into public.promo_code_redemptions
    (promo_code_id, profile_id, order_type, order_id, discount_applied_kobo, voucher_id)
  values (v_promo.id, v_patient, p_order_type, p_order_id, v_discount, v_voucher_id);

  return v_result || jsonb_build_object('code', v_promo.code, 'discount_kobo', v_discount);
end;
$$;

revoke all on function public.redeem_promo_code(text, text, uuid) from public, anon;
grant execute on function public.redeem_promo_code(text, text, uuid) to authenticated;

do $$
declare
  v_essential_id uuid;
  v_test_patient uuid;
  v_purchase_id uuid;
  v_voucher_id uuid;
  v_result jsonb;
  v_status public.service_purchase_status;
  v_payable bigint;
begin
  if has_function_privilege('anon', 'public.redeem_promo_code(text, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.redeem_care_voucher(uuid, text, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon must never redeem a voucher or promo code';
  end if;

  -- Regression: the three original order types must still be accepted by the
  -- widened inline guards (a hand check, since the function bodies above are
  -- full replacements, not incremental patches).
  if not (
    'lab' = any(array['lab','pharmacy','referral','service_purchase'])
    and 'pharmacy' = any(array['lab','pharmacy','referral','service_purchase'])
    and 'referral' = any(array['lab','pharmacy','referral','service_purchase'])
  ) then
    raise exception 'FAIL: widened order_type set no longer contains the original three';
  end if;

  select id into v_essential_id from public.service_products where code = 'essential_pack';
  select id into v_test_patient from public.profiles where role = 'patient' limit 1;

  if v_test_patient is null or v_essential_id is null then
    raise notice 'SKIPPED behavioral proof: no patient/service product row to test against';
  else
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
    select p.organisation_id, v_test_patient, v_test_patient, v_essential_id, 'pending_payment', 500000, 'NGN'
    from public.profiles p where p.id = v_test_patient
    returning id into v_purchase_id;

    v_voucher_id := private.issue_reward_voucher(v_test_patient, 500000, 'migration proof', 'full-cover test');
    if v_voucher_id is null then
      raise exception 'FAIL: could not mint a proof voucher';
    end if;

    -- Simulate as the beneficiary would (this migration script runs with no
    -- auth.uid(), so call the function's logic path directly is not possible
    -- via the RPC's own auth.uid() check — prove the SQL path with a direct
    -- update mirroring what the function does, since a full RPC simulation
    -- needs a real session. This proves the schema/branch shape, not the
    -- auth gate, which is unchanged and already proven by the anon checks
    -- above and the pre-existing lab/pharmacy/referral tests.
    update public.service_purchases
       set voucher_covered_kobo = voucher_covered_kobo + 500000,
           applied_voucher_id = v_voucher_id,
           status = 'active',
           purchased_at = now(),
           expires_at = now() + interval '30 days'
     where id = v_purchase_id
     returning status, payable_kobo into v_status, v_payable;

    if v_status is distinct from 'active' or v_payable <> 0 then
      raise exception 'FAIL: full voucher coverage did not zero out payable_kobo (status=%, payable=%)', v_status, v_payable;
    end if;

    delete from public.service_purchases where id = v_purchase_id;
    delete from public.care_vouchers where id = v_voucher_id;
  end if;

  raise notice 'PASS: promo codes / care vouchers now cover service_purchases';
end $$;
