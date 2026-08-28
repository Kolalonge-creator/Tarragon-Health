-- A care voucher buys a YEAR OF A PLAN, for yourself or somebody who has
-- linked you to their care.
--
-- Founder decisions this pins: yearly plans only, and the RECIPIENT redeems
-- when ready rather than the plan starting the moment somebody else pays.
--
-- Rolled back. Run from the MAIN checkout:
--   npx supabase db query --linked -f packages/db/tests/subscription_care_vouchers.sql

begin;
create temp table r(step text, verdict text) on commit drop;
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid; v_sponsor uuid; v_stranger uuid;
  v_yearly uuid; v_yearly_price bigint; v_monthly uuid; v_res jsonb; v_v uuid; v_n int; v_ok boolean;
  v_sub public.subscriptions%rowtype; v_end timestamptz;
begin
  -- Every NGN paid tier is currently is_active=false, pending a Paystack
  -- "Sync now" re-sync after the 2026-08-05 price change
  -- (20260805201508_raise_ngn_tier_prices_and_fold_prevention_into_chronic_
  -- plans.sql) -- a real, current, deliberate ops state, not a code defect.
  -- Reactivate Complete Care's yearly row for the life of this rolled-back
  -- transaction only, then look plans up by the real properties
  -- purchase_subscription_voucher() actually cares about (active, NGN,
  -- yearly, a real price) rather than a hardcoded code -- plan
  -- code/price/is_active have churned repeatedly per CLAUDE.md's own
  -- standing notes, and this lookup doesn't need a specific code to prove
  -- the RPC's own logic.
  update public.subscription_plans set is_active = true where code = 'complete_yearly';

  select id, organisation_id into v_pt, v_org from public.profiles
   where role='patient' and organisation_id is not null order by created_at limit 1;
  select id into v_sponsor from public.profiles where role='patient' and organisation_id=v_org and id<>v_pt limit 1;
  select id into v_stranger from public.profiles where role='patient' and id not in (v_pt, v_sponsor) limit 1;
  select id, price_minor into v_yearly, v_yearly_price from public.subscription_plans
   where is_active and currency = 'NGN' and interval = 'yearly' and coalesce(price_minor, 0) > 0
   order by price_minor limit 1;
  select id into v_monthly from public.subscription_plans
   where currency = 'NGN' and interval = 'monthly' and code <> 'free'
   order by price_minor desc limit 1;
  if v_pt is null or v_sponsor is null or v_stranger is null or v_yearly is null or v_monthly is null then
    raise exception 'fixture lookup failed - test would be vacuous';
  end if;
  delete from public.subscriptions where subscriber_id = v_pt;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_pt, v_sponsor, 'manage', v_pt) on conflict do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.purchase_subscription_voucher(v_pt, v_yearly, 'Get well soon Mum');
  v_v := (v_res->>'voucher_id')::uuid;
  insert into r values ('01 sponsor buys a year of a plan for a linked person',
    case when (v_res->>'ok')::boolean and (v_res->>'face_value_kobo')::bigint = v_yearly_price then 'PASS' else 'FAIL' end);
  begin
    perform public.purchase_subscription_voucher(v_pt, v_monthly, null);
    insert into r values ('02 monthly plans refused, yearly only','FAIL - accepted');
  exception when check_violation then insert into r values ('02 monthly plans refused, yearly only','PASS'); end;
  begin
    perform public.purchase_subscription_voucher(v_stranger, v_yearly, null);
    insert into r values ('03 CONTROL cannot buy for an unlinked stranger','FAIL - accepted');
  exception when insufficient_privilege then insert into r values ('03 CONTROL cannot buy for an unlinked stranger','PASS'); end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pt, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_subscription_voucher(v_v);
    insert into r values ('04 an unpaid voucher cannot be redeemed','FAIL - accepted');
  exception when check_violation then insert into r values ('04 an unpaid voucher cannot be redeemed','PASS'); end;
  reset role;

  -- Stand in for the purchaser paying it off (normally
  -- private.apply_voucher_payment_from_transaction does this).
  update public.care_vouchers set status='active', amount_paid_kobo=face_value_kobo, activated_at=now() where id=v_v;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.redeem_subscription_voucher(v_v);
    insert into r values ('05 the purchaser cannot start the plan for them','FAIL - accepted');
  exception when insufficient_privilege then insert into r values ('05 the purchaser cannot start the plan for them','PASS'); end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pt, 'role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_subscription_voucher(v_v);
  insert into r values ('06 the recipient redeems it themselves', case when (v_res->>'ok')::boolean then 'PASS' else 'FAIL' end);
  select public.has_feature_access('lab_coordination') into v_ok;
  insert into r values ('07 entitlement actually opens for them', case when v_ok then 'PASS' else 'FAIL - no access' end);
  begin
    perform public.redeem_subscription_voucher(v_v);
    insert into r values ('08 cannot redeem twice','FAIL - accepted');
  exception when check_violation then insert into r values ('08 cannot redeem twice','PASS'); end;
  reset role;

  select * into v_sub from public.subscriptions where subscriber_id=v_pt order by created_at desc limit 1;
  insert into r values ('09 a real year, nothing recurring, purchaser recorded',
    case when v_sub.status='active' and v_sub.amount_minor=0 and v_sub.cancel_at_period_end
          and v_sub.paid_by_profile_id=v_sponsor and v_sub.current_period_end > now() + interval '360 days'
         then 'PASS' else 'FAIL' end);

  -- A second gift must never open a duplicate subscription or double-bill.
  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.purchase_subscription_voucher(v_pt, v_yearly, null);
  v_v := (v_res->>'voucher_id')::uuid;
  reset role;
  update public.care_vouchers set status='active', amount_paid_kobo=face_value_kobo where id=v_v;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pt, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.redeem_subscription_voucher(v_v);
  reset role;
  select count(*) into v_n from public.subscriptions where subscriber_id=v_pt;
  select current_period_end into v_end from public.subscriptions where subscriber_id=v_pt;
  insert into r values ('10 a second gift extends rather than duplicating',
    case when v_n=1 then 'PASS' else 'FAIL - '||v_n||' subscriptions' end);
  insert into r values ('11 and it adds another year',
    case when v_end > now() + interval '720 days' then 'PASS' else 'FAIL' end);
end $$;

select step, verdict from r order by step;
rollback;
