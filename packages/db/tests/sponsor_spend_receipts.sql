-- Proves private.notify_purchaser_of_voucher_use does what its migration
-- claims.
--
-- WALLET -> CARE VOUCHER, read before touching this file again:
-- This file used to prove private.notify_sponsors_of_wallet_spend, which was
-- dropped along with the rest of the Health Wallet in
-- 20260731215735_retire_health_wallet.sql. That same migration names its
-- direct successor in its own header comment: "notify_sponsors_of_wallet_spend
-- -> a receipt when a gifted voucher is used" -- the trigger function
-- private.notify_purchaser_of_voucher_use(), fired by care_vouchers_notify_
-- purchaser after update on public.care_vouchers, template
-- 'voucher_gift_used'.
--
-- The shape of "who counts as a sponsor" changed with it: the wallet receipt
-- fired on a wallet_ledger 'spend' row and named whoever had a 'sponsor_topup'
-- entry on that wallet. The voucher receipt instead fires when a voucher's
-- status transitions TO 'redeemed', and names whoever is recorded as that
-- voucher's purchaser_profile_id (set once, at purchase, and frozen by
-- care_vouchers' own immutability trigger) -- provided the purchaser isn't
-- the beneficiary themselves. Six of this file's original properties map
-- straight across:
--   old: a wallet-funder gets a receipt on funding someone else's spend
--   new: a voucher-purchaser gets a receipt when their gift is redeemed
--   old: the wallet owner topping up their own wallet is not their own sponsor
--   new: buying your own voucher (purchaser = beneficiary) sends no receipt
--   old: a non-funding grantee gets nothing; a non-spend ledger entry raises
--        nothing
--   new: a grantee who never purchased anything gets nothing; a voucher being
--        paid off (activated) is not itself a redemption and raises nothing
--
-- The payload shape itself is not the same JSON, because it is not the same
-- fact pattern any more -- there is no "wallet balance after this spend" to
-- report, and a purchase names a service (or, since 20260803141409, a
-- subscription plan -- the lab-panel voucher was closed the same day lab
-- fulfilment was deferred, so a subscription is the only kind still
-- purchasable as a gift), not a spend category. voucher_number/label/
-- beneficiary_name/value_naira replace what/amount_kobo/balance_kobo; this
-- file checks the payload carries exactly those four keys, never a result,
-- rather than the old literal amount/balance comparison.
--
-- Rolled back, so it leaves nothing behind. Every fixture is resolved at
-- runtime rather than hardcoded, so this stays runnable against any
-- environment.
--
-- What is being pinned down:
--   1. The purchaser of a voucher gets a receipt when it is redeemed, on
--      exactly two channels.
--   2. That receipt is non_clinical, so it satisfies the I1 CHECK on email.
--   3. It names the service and its value, and carries nothing else -- never
--      a result.
--   4. Someone holding a profile_access grant but who never purchased
--      anything for this person gets nothing. Paying for care and reading it
--      are different permissions.
--   5. Buying your own voucher does not make you your own sponsor.
--   6. Being paid off (activated) is not itself a redemption, so it raises no
--      receipt at all -- only the redemption does.
begin;

do $$
declare
  v_org        uuid;
  v_owner      uuid;
  v_sponsor    uuid;
  v_bystander  uuid;

  v_yearly       uuid;
  v_yearly_name  text;
  v_yearly_price bigint;
  v_v_gift       uuid;  -- the sponsor's gift, for the owner
  v_v_self       uuid;  -- the owner's own purchase, for themselves (check 5)

  v_sponsor_rows    int;
  v_bystander_rows  int;
  v_owner_rows      int;
  v_channels        text;
  v_classes         text;
  v_payload         jsonb;
  v_after_activation int;
begin
  select id, organisation_id into v_owner, v_org
    from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_sponsor
    from public.profiles where role = 'patient' and id <> v_owner order by created_at limit 1;
  select id into v_bystander
    from public.profiles where role = 'patient' and id not in (v_owner, v_sponsor)
    order by created_at limit 1;

  if v_owner is null or v_sponsor is null or v_bystander is null then
    raise exception 'need three patient profiles to run this test';
  end if;

  -- Every NGN paid plan is currently is_active=false pending a Paystack
  -- "Sync now" re-sync after the 2026-08-05 price change
  -- (20260805201508_raise_ngn_tier_prices_and_fold_prevention_into_chronic_
  -- plans.sql) -- a real, current ops state, not a code defect. Reactivate
  -- the yearly NGN tiers for the life of this rolled-back transaction only,
  -- same as care_vouchers.sql/health_reset_90_day.sql/subscription_care_
  -- vouchers.sql already do.
  update public.subscription_plans set is_active = true
   where interval = 'yearly' and currency = 'NGN' and price_minor > 0;

  select id, name, price_minor into v_yearly, v_yearly_name, v_yearly_price
    from public.subscription_plans
   where interval = 'yearly' and is_active and currency = 'NGN' and price_minor > 0
   order by price_minor limit 1;
  if v_yearly is null then raise exception 'need an active yearly NGN plan fixture'; end if;

  -- A bystander with a real grant who has never purchased anything.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_bystander, 'view', v_owner)
  on conflict do nothing;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_sponsor, 'manage', v_owner)
  on conflict do nothing;

  -- The sponsor buys a year of the plan as a gift; the owner separately buys
  -- their own (the control for check 5).
  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.purchase_subscription_voucher(v_owner, v_yearly, 'Get well soon')->>'voucher_id')::uuid into v_v_gift;
  perform set_config('role', 'postgres', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select (public.purchase_subscription_voucher(v_owner, v_yearly, null)->>'voucher_id')::uuid into v_v_self;
  perform set_config('role', 'postgres', true);

  -- Stand in for the payment webhook completing each voucher (the same
  -- shortcut subscription_care_vouchers.sql uses).
  update public.care_vouchers set status = 'active', amount_paid_kobo = face_value_kobo, activated_at = now()
   where id in (v_v_gift, v_v_self);

  -- 6. Being paid in full is not itself a redemption, so nothing should have
  --    gone out yet.
  select count(*) into v_after_activation from public.notifications where template = 'voucher_gift_used';
  if v_after_activation <> 0 then
    raise exception 'FAIL 6: activating a voucher raised % receipt(s); only redemption should', v_after_activation;
  end if;

  -- The redemption itself: the beneficiary uses what was bought for them.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.redeem_subscription_voucher(v_v_gift);
  perform public.redeem_subscription_voucher(v_v_self);
  perform set_config('role', 'postgres', true);

  select count(*) into v_sponsor_rows
    from public.notifications
   where template = 'voucher_gift_used' and recipient_id = v_sponsor;
  if v_sponsor_rows <> 2 then
    raise exception 'FAIL 1: sponsor got % receipt row(s), expected 2', v_sponsor_rows;
  end if;

  select string_agg(channel::text, ',' order by channel::text) into v_channels
    from public.notifications
   where template = 'voucher_gift_used' and recipient_id = v_sponsor;
  if v_channels <> 'email,in_app' then
    raise exception 'FAIL 1: receipt channels were %, expected email,in_app', v_channels;
  end if;

  select string_agg(distinct content_class::text, ',') into v_classes
    from public.notifications
   where template = 'voucher_gift_used';
  if v_classes <> 'non_clinical' then
    raise exception 'FAIL 2: receipt content_class was %, expected non_clinical', v_classes;
  end if;

  select payload into v_payload
    from public.notifications
   where template = 'voucher_gift_used' and recipient_id = v_sponsor
   limit 1;
  if v_payload->>'label' <> v_yearly_name then
    raise exception 'FAIL 3: receipt named "%", expected "%"', v_payload->>'label', v_yearly_name;
  end if;
  if (v_payload->>'value_naira')::numeric <> (v_yearly_price / 100) then
    raise exception 'FAIL 3: receipt value was %, expected %', v_payload->>'value_naira', v_yearly_price / 100;
  end if;
  if v_payload - array['voucher_number', 'label', 'beneficiary_name', 'value_naira'] <> '{}'::jsonb then
    raise exception 'FAIL 3: receipt carried an unexpected field: %', v_payload;
  end if;

  select count(*) into v_bystander_rows
    from public.notifications
   where template = 'voucher_gift_used' and recipient_id = v_bystander;
  if v_bystander_rows <> 0 then
    raise exception 'FAIL 4: a non-purchasing grantee got % receipt(s); expected 0', v_bystander_rows;
  end if;

  select count(*) into v_owner_rows
    from public.notifications
   where template = 'voucher_gift_used' and recipient_id = v_owner;
  if v_owner_rows <> 0 then
    raise exception 'FAIL 5: buying your own voucher sent you % receipt(s) as your own sponsor; expected 0',
      v_owner_rows;
  end if;

  raise notice 'PASS: sponsor received % rows on %, bystander 0, owner 0, activation raised none',
    v_sponsor_rows, v_channels;
end $$;

rollback;
