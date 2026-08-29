-- Coordinator-assisted voucher redemption (revenue-architecture spec §6:
-- "A beneficiary must be reachable without a smartphone... their
-- notification must work by SMS with a callback number").
--
-- public.redeem_care_voucher (20260731215326) hard-requires auth.uid() —
-- correct for the app/web self-serve path, but it means a beneficiary with
-- no app, no account and no data plan (the doc's "62-year-old in Osogbo
-- with a feature phone") has no way to redeem a gifted voucher at all
-- today, only to receive one.
--
-- Deliberately NOT an SMS-reply-triggers-redemption flow: that would be an
-- inbound-message-turns-into-a-platform-action automation over an
-- unauthenticated channel — the same fraud/spoofing shape CLAUDE.md already
-- forbids for WhatsApp-driven platform actions (a text message is not
-- proof of who sent it). Instead: the beneficiary calls in (or a family
-- member calls on their behalf, with the beneficiary reachable to confirm),
-- a member of Tarragon's own staff verifies the caller against the phone
-- number already on file for that voucher's beneficiary, and redeems it on
-- their behalf — the same trust model as any bank's phone-support desk.
-- Every such redemption is marked as assisted in the voucher's own audit
-- trail (care_voucher_events.note), never silently indistinguishable from a
-- self-service one.
--
-- The core redemption logic is intentionally duplicated from
-- redeem_care_voucher rather than refactored into a shared private helper:
-- this codebase already keeps each order-type branch inline within a single
-- function rather than extracting shared helpers for financial-state
-- transitions, and touching the existing, already-relied-upon function to
-- extract one is a materially riskier change than one more read-only-safe
-- sibling function for a narrow, clearly-logged exception path.

create or replace function public.redeem_care_voucher_assisted(
  p_voucher uuid,
  p_beneficiary_phone text,
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
  v_on_file_phone text;
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

  if not private.is_org_staff(v_v.organisation_id) then
    raise exception 'not authorised to assist a redemption' using errcode = '42501';
  end if;

  select phone into v_on_file_phone from public.profiles where id = v_v.beneficiary_profile_id;
  if v_on_file_phone is null or v_on_file_phone <> p_beneficiary_phone then
    return jsonb_build_object('ok', false,
      'error', 'That phone number does not match the beneficiary on file for this voucher.');
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
  else
    select patient_id, status::text, payable_kobo, null::uuid
      into v_patient, v_status, v_payable, v_bundle
      from public.specialist_referrals where id = p_order_id for update;
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
     'Redeemed by phone — assisted by care team (beneficiary phone-verified, no app/web access)');

  return jsonb_build_object(
    'ok', true,
    'covered_kobo', v_covered,
    'fully_covered', v_fully,
    'remaining_payable_kobo', greatest(v_payable - v_covered, 0)
  );
end;
$$;

revoke all on function public.redeem_care_voucher_assisted(uuid, text, text, uuid) from public;
revoke all on function public.redeem_care_voucher_assisted(uuid, text, text, uuid) from anon;
grant execute on function public.redeem_care_voucher_assisted(uuid, text, text, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.redeem_care_voucher_assisted(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to redeem a voucher, assisted or not';
  end if;
  if not has_function_privilege('authenticated', 'public.redeem_care_voucher_assisted(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'authenticated (staff, gated inside the function) must be able to call the assisted redemption path';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'redeem_care_voucher_assisted'
      and (p.prosrc ilike '%payout%' or p.prosrc ilike '%withdraw%' or p.prosrc ilike '%cash_out%')
  ) then
    raise exception 'assisted redemption must never turn a voucher into cash, same as self-service redemption';
  end if;
end $$;;
