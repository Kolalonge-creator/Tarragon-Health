-- create_sponsored_service_reservation: the sponsor's checkout-init step.
-- Only creates the pending_payment row (no entitlement yet) -- payment
-- activation (status -> invited, invite_token minted) happens in
-- private.activate_sponsored_service_reservation, an AFTER INSERT trigger on
-- payment_transactions (20260923013621_activate_sponsored_service_reservation.sql),
-- same two-step shape as every other sponsored-payment kind on this platform.
create or replace function public.create_sponsored_service_reservation(
  p_service_product_id uuid,
  p_recipient_phone text,
  p_recipient_first_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_org uuid;
  v_product record;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select organisation_id into v_org from public.profiles where id = v_caller;
  if v_org is null then
    raise exception 'sponsor has no organisation' using errcode = '23514';
  end if;

  select id, currency, price_kobo, is_active
    into v_product
    from public.service_products
   where id = p_service_product_id;

  if v_product.id is null or not v_product.is_active then
    raise exception 'that service is not available' using errcode = '23514';
  end if;
  if v_product.currency <> 'NGN' then
    raise exception 'reservations only support naira-priced services' using errcode = '23514';
  end if;

  if p_recipient_phone !~ '^\+[1-9]\d{7,14}$' then
    raise exception 'recipient phone must be E.164, e.g. +2348012345678' using errcode = '23514';
  end if;
  if length(trim(p_recipient_first_name)) = 0 then
    raise exception 'recipient first name is required' using errcode = '23514';
  end if;

  insert into public.sponsored_service_reservations (
    organisation_id, service_product_id, sponsor_profile_id,
    recipient_phone, recipient_first_name, amount_kobo, currency
  ) values (
    v_org, p_service_product_id, v_caller,
    p_recipient_phone, trim(p_recipient_first_name), v_product.price_kobo, v_product.currency
  ) returning id into v_id;

  perform private.log_audit(
    'sponsored_service_reservation.created', 'sponsored_service_reservation', v_id,
    jsonb_build_object('service_product_id', p_service_product_id, 'amount_kobo', v_product.price_kobo)
  );

  return v_id;
end;
$$;

revoke all on function public.create_sponsored_service_reservation(uuid, text, text) from public, anon;
grant execute on function public.create_sponsored_service_reservation(uuid, text, text) to authenticated;

-- claim_sponsored_service_reservation: the recipient's own claim, called with
-- THEIR session after they've created their own account and their phone
-- matches the reservation's recipient_phone. Creates a real, fully-paid,
-- active care_vouchers row -- same entitlement shape the ngo_funded_cohort
-- claim RPC uses (kind='prepaid_service'), reusing care_voucher_config's
-- validity window rather than inventing a new one.
--
-- gen_random_bytes is schema-qualified as extensions.gen_random_bytes --
-- pgcrypto lives in the extensions schema on this project (same gotcha
-- CLAUDE.md documents for pgvector), and this function runs with
-- search_path = '' so a bare gen_random_bytes() is not found. Caught live
-- before merge: the first version of this function used the bare name,
-- which resolved fine as a column DEFAULT elsewhere in this codebase (e.g.
-- funding_programme_invitations.invite_token) but fails inside a
-- SECURITY DEFINER function with an empty search_path.
create or replace function public.claim_sponsored_service_reservation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_caller_phone text;
  v_reservation public.sponsored_service_reservations%rowtype;
  v_product record;
  v_validity_months int;
  v_voucher_id uuid;
  v_voucher_number text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select phone into v_caller_phone from public.profiles where id = v_caller;
  if v_caller_phone is null then
    raise exception 'add a phone number to your account before claiming this' using errcode = '23514';
  end if;

  select * into v_reservation
    from public.sponsored_service_reservations
   where invite_token = p_token
   for update;

  if v_reservation.id is null then
    raise exception 'that link is not valid' using errcode = '22023';
  end if;
  if v_reservation.status <> 'invited' then
    raise exception 'this reservation is % — it can no longer be claimed', v_reservation.status
      using errcode = '23514';
  end if;
  if v_reservation.expires_at is not null and v_reservation.expires_at < now() then
    update public.sponsored_service_reservations set status = 'expired' where id = v_reservation.id;
    raise exception 'this invitation has expired' using errcode = '23514';
  end if;
  if v_reservation.recipient_phone <> v_caller_phone then
    raise exception 'this invitation was sent to a different phone number than the one on your account'
      using errcode = '42501';
  end if;

  select id, code, name, price_kobo
    into v_product
    from public.service_products
   where id = v_reservation.service_product_id;

  select validity_months into v_validity_months from public.care_voucher_config limit 1;
  v_validity_months := coalesce(v_validity_months, 24);

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
    service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo,
    status, expires_at, activated_at
  ) values (
    v_reservation.organisation_id,
    'RSV-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10)),
    'prepaid_service', v_caller, v_reservation.sponsor_profile_id,
    v_product.id, v_product.code, v_product.name, v_reservation.amount_kobo, v_reservation.amount_kobo,
    'active', now() + (v_validity_months || ' months')::interval, now()
  ) returning id, voucher_number into v_voucher_id, v_voucher_number;

  update public.sponsored_service_reservations
     set status = 'claimed',
         claimed_by_profile_id = v_caller,
         claimed_at = now(),
         care_voucher_id = v_voucher_id
   where id = v_reservation.id;

  insert into public.notifications (organisation_id, recipient_id, channel, template, payload, content_class)
  values (
    v_reservation.organisation_id, v_reservation.sponsor_profile_id, 'in_app', 'sponsored_reservation_claimed',
    jsonb_build_object('recipient_name', v_reservation.recipient_first_name, 'sku_name', v_product.name),
    'non_clinical'
  );

  perform private.log_audit(
    'sponsored_service_reservation.claimed', 'sponsored_service_reservation', v_reservation.id,
    jsonb_build_object('care_voucher_id', v_voucher_id)
  );

  return jsonb_build_object(
    'ok', true, 'voucher_id', v_voucher_id, 'voucher_number', v_voucher_number,
    'sku_name', v_product.name, 'face_value_kobo', v_reservation.amount_kobo
  );
end;
$$;

revoke all on function public.claim_sponsored_service_reservation(text) from public, anon;
grant execute on function public.claim_sponsored_service_reservation(text) to authenticated;
