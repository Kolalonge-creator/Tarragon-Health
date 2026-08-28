-- Proves public.redeem_care_voucher lets exactly the right person pay a
-- booking order, and nobody else.
--
-- WALLET -> CARE VOUCHER, read before touching this file again:
-- public.sponsor_pay_booking_order (the function this file used to test) no
-- longer exists at all -- it was dropped outright in
-- 20260731215735_retire_health_wallet.sql along with the Health Wallet it
-- spent. The unified redemption RPC that replaced it, public.
-- redeem_care_voucher (20260731215326_care_vouchers_redemption.sql), carries
-- the EXACT same authorization shape sponsor_pay_booking_order had -- a
-- 'manage' profile_access grant on the beneficiary settles a bill, 'view' and
-- no grant do not, and the grant cannot be pointed at a third party's order --
-- so this file still proves the same property, just against a voucher
-- instead of a wallet balance.
--
-- There is, as of the current migrations, no way to BUY a spendable voucher
-- for someone else's lab test any more: public.purchase_care_voucher (the
-- lab-panel prepay) was permanently closed in
-- 20260803134416_self_arranged_consistency_sweep.sql once lab fulfilment was
-- deferred to "the patient pays the lab directly" -- it now unconditionally
-- raises. The only voucher kind still mintable that redeem_care_voucher will
-- accept against a real lab_orders bill is a reward voucher
-- (private.issue_reward_voucher, kind='reward_discount') -- normally issued
-- for referral/health-check rewards, but it settles through the identical
-- redeem_care_voucher() authorization gate this file exists to pin, so it is
-- used here purely as a way to hand the owner something spendable. Unlike the
-- old wallet, a voucher is not a depletable balance: ANY successful
-- redemption consumes the whole voucher in one shot (marks it 'redeemed'),
-- whether or not it fully covered the order -- so "balance debited by
-- exactly the order total" becomes "the voucher is now redeemed, in full, in
-- one call", and checks 3 and 5 each need their own voucher rather than one
-- wallet with headroom for both.
--
-- A real, priced, partner-billed lab order is needed to reach
-- redeem_care_voucher's 'pending_payment' precondition at all -- a
-- self-arranged order (the table default since 20260803124833) can never be
-- pending_payment or carry a nonzero total_kobo, see
-- private.enforce_lab_order_origin. The only lab partner actually switched on
-- anywhere in this history is Synlab Nigeria
-- (20260821193144_switch_on_synlab.sql), and its price is computed by
-- private.compute_review_price rather than settable by the caller. Fresh
-- profiles are used (rather than this file's old "existing role='patient'"
-- fixture lookup) so that computed pricing can never be zeroed out by some
-- other test's leftover screening history on a shared fixture patient --
-- same reasoning, and the same screen_core/female/1955 combination,
-- partner_billing_money_path.sql and computed_review_price.sql already prove
-- prices cleanly.
--
--   1. A 'view' grantee is refused (42501).
--   2. Someone with no grant at all is refused (42501).
--   3. A 'manage' grantee succeeds: order flips to payment_confirmed, the
--      voucher is marked redeemed, and the voucher's event log records the
--      SPONSOR as the actor, not the patient.
--   4. Pointing the (still-unused) voucher at an order that is not its own
--      beneficiary's is refused, so the grant cannot be used as a lever onto
--      somebody else's order.
--   5. Paying an order that is no longer awaiting payment is refused, even
--      with a fresh, fully-valid voucher.
begin;

do $$
declare
  v_org         uuid := '00000000-0000-0000-0000-000000000001';
  v_owner       uuid := gen_random_uuid();
  v_manager     uuid := gen_random_uuid();
  v_viewer      uuid := gen_random_uuid();
  v_stranger    uuid := gen_random_uuid();
  v_bundle      uuid;
  v_synlab      uuid;
  v_order       uuid;
  v_order_other uuid;
  v_price       bigint;
  v_voucher     uuid;
  v_voucher2    uuid;
  v_status      text;
  v_voucher_status text;
  v_actor       uuid;
  v_ok          boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_owner,    'sponsor-pay-booking-order-owner@example.invalid',    'x', now(), '{}', '{}'),
    (v_manager,  'sponsor-pay-booking-order-manager@example.invalid',  'x', now(), '{}', '{}'),
    (v_viewer,   'sponsor-pay-booking-order-viewer@example.invalid',   'x', now(), '{}', '{}'),
    (v_stranger, 'sponsor-pay-booking-order-stranger@example.invalid', 'x', now(), '{}', '{}');

  -- v_owner and v_manager both get their own lab order priced (the second, in
  -- check 4), so both need demographics that price screen_core cleanly.
  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Sponsor Pay Booking Order Test Owner',
         sex = 'female', date_of_birth = date '1955-01-01', state = 'Lagos'
   where id = v_owner;
  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Sponsor Pay Booking Order Test Manager',
         sex = 'female', date_of_birth = date '1955-01-01', state = 'Lagos'
   where id = v_manager;
  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Sponsor Pay Booking Order Test Viewer'
   where id = v_viewer;
  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Sponsor Pay Booking Order Test Stranger'
   where id = v_stranger;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_manager, 'manage', v_owner), (v_owner, v_viewer, 'view', v_owner)
  on conflict do nothing;

  -- A real, partner-billed, priced order needs a live lab partner in a live
  -- region. Synlab/Lagos already are, platform-wide, as of
  -- 20260821193144_switch_on_synlab.sql -- reasserted here anyway (a no-op if
  -- already true) so this file does not silently depend on that staying so.
  update public.service_regions set is_active = true where state = 'Lagos';
  if not found then insert into public.service_regions (state, is_active) values ('Lagos', true); end if;
  update public.lab_providers set is_active = true, regions = array['Lagos'] where name = 'Synlab Nigeria';
  select id into v_synlab from public.lab_providers where name = 'Synlab Nigeria';
  if v_synlab is null then raise exception 'fixture: Synlab Nigeria lab_providers row missing'; end if;

  select id into v_bundle from public.panel_bundles where code = 'screen_core';
  if v_bundle is null then raise exception 'fixture: screen_core bundle missing'; end if;

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin,
     investigation_tier, fulfilment, provider_id)
  values (v_org, v_owner, v_bundle, 'pending_payment', 0, 'patient_initiated', 1, 'partner', v_synlab)
  returning id into v_order;

  select total_kobo into v_price from public.lab_orders where id = v_order;
  if v_price is null or v_price <= 0 then
    raise exception 'fixture: screen_core did not price for the owner (got %)', v_price;
  end if;

  -- The sponsor's gift: a reward voucher worth exactly the order price, so a
  -- single redemption covers it in full -- the closest a voucher gets to the
  -- old "wallet funded with exactly the order total" setup.
  v_voucher := private.issue_reward_voucher(v_owner, v_price, 'Test sponsor reward', 'sponsor_pay_booking_order fixture');
  if v_voucher is null then raise exception 'fixture: reward voucher was not issued'; end if;

  ---------------------------------------------------------------- 1. view
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.redeem_care_voucher(v_voucher, 'lab', v_order);
    raise exception 'FAIL 1: a view grantee was allowed to pay';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 2. stranger
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.redeem_care_voucher(v_voucher, 'lab', v_order);
    raise exception 'FAIL 2: someone with no grant was allowed to pay';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 4. mismatch
  -- Real grant, real (still-unused) voucher, but the order named belongs to
  -- the manager, not the voucher's own beneficiary (the owner).
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin,
     investigation_tier, fulfilment, provider_id)
  values (v_org, v_manager, v_bundle, 'pending_payment', 0, 'patient_initiated', 1, 'partner', v_synlab)
  returning id into v_order_other;

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.redeem_care_voucher(v_voucher, 'lab', v_order_other);
    raise exception 'FAIL 4: a voucher was pointed at someone else''s order';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ---------------------------------------------------------------- 3. manage
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.redeem_care_voucher(v_voucher, 'lab', v_order)->>'fully_covered')::boolean into v_ok;
  perform set_config('role', 'postgres', true);

  if not coalesce(v_ok, false) then
    raise exception 'FAIL 3: the manage grantee could not pay in full';
  end if;

  select status::text into v_status from public.lab_orders where id = v_order;
  if v_status <> 'payment_confirmed' then
    raise exception 'FAIL 3: order status is %, expected payment_confirmed', v_status;
  end if;

  select status::text into v_voucher_status from public.care_vouchers where id = v_voucher;
  if v_voucher_status <> 'redeemed' then
    raise exception 'FAIL 3: voucher status is %, expected redeemed', v_voucher_status;
  end if;

  select actor_profile_id into v_actor
    from public.care_voucher_events
   where voucher_id = v_voucher and event_type = 'redeemed'
   order by created_at desc limit 1;
  if v_actor <> v_manager then
    raise exception 'FAIL 3: redemption actor is %, expected the sponsor %', v_actor, v_manager;
  end if;

  ---------------------------------------------------------------- 5. already paid
  v_voucher2 := private.issue_reward_voucher(v_owner, v_price, 'Test sponsor reward 2', 'sponsor_pay_booking_order fixture');
  if v_voucher2 is null then raise exception 'fixture: second reward voucher was not issued'; end if;

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.redeem_care_voucher(v_voucher2, 'lab', v_order);
    raise exception 'FAIL 5: an already-paid order was paid twice';
  exception when others then
    if sqlerrm like 'FAIL 5%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: view refused, stranger refused, mismatch refused, manage paid % kobo via voucher, double-pay refused',
    v_price;
end $$;

rollback;
