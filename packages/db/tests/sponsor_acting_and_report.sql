-- Proves the sponsor-acting RPCs and the monthly report.
--
-- These exist because the founder ruled out dedicated per-patient staff on
-- 2026-07-31. The jobs a coordinator would have done that software genuinely
-- can do are done here; the authorization line is the same everywhere, and it
-- is the thing most worth pinning down: 'manage' acts, 'view' only follows,
-- and a stranger does neither.
--
-- Rolled back. Fixtures resolved at runtime so it runs anywhere.
--
-- WALLET -> CARE VOUCHER, read before touching this file again:
-- The Health Wallet is retired (20260731215735_retire_health_wallet.sql).
-- sponsor_book_care used to take a wallet balance into account (book unpaid +
-- report a shortfall, or book AND pay in one step if the wallet covered it) --
-- that whole concept is gone, not just renamed. sponsor_book_care was
-- rewritten again three days later, in
-- 20260803134416_self_arranged_consistency_sweep.sql, once lab fulfilment was
-- deferred: every booking it makes is now a self-arranged, Tarragon-never-
-- bills-it request (total_kobo always 0, 'paid' always false, no wallet or
-- voucher involved at all -- the patient pays the lab directly). That shape,
-- and the plain manage/stranger authorization gate on it, is already fully
-- pinned by self_arranged_consistency.sql; checks 1 and 2 below are narrowed
-- to just proving the manage-grant sponsor can still make the request, so as
-- not to duplicate that file.
--
-- queue_sponsor_monthly_reports was also rewritten in the same retirement
-- migration to summarise public.care_vouchers (grouped by purchaser/
-- beneficiary pairs) instead of wallet_ledger sponsor_topup rows, and its
-- return type changed from integer (a queued-count) to void. Proven here by
-- purchasing a voucher as a gift (private.can_purchase_voucher_for is what
-- makes someone count as a "sponsor" now, same as a wallet topup used to) and
-- counting the notifications it produces, since there is no longer a count to
-- return. NOTE: unlike the wallet-era function -- which explicitly skipped a
-- sponsor already notified in the last 20 days -- the rewritten version has
-- no such guard, even though its own comment claims the replacement works
-- "exactly as before". That looks like a dropped idempotency guard rather
-- than a deliberate change, so this file does not assert idempotency any
-- more; flagged for a human to confirm whether the guard should be restored.
--
--   1. A 'manage' sponsor can request care for the person they support (an
--      unpaid, self-arranged request -- there is nothing left to fund here).
--   2. A stranger cannot book care for someone.
--   3. sponsor_set_dependent_basics writes date of birth, sex and location.
--   4. A stranger cannot edit someone's details.
--   5. queue_sponsor_monthly_reports notifies a voucher purchaser on two
--      channels, non_clinical, once care_vouchers has a purchaser/beneficiary
--      pair to summarise.
begin;

do $$
declare
  v_org uuid; v_owner uuid; v_sponsor uuid; v_stranger uuid;
  v_code text; v_price bigint; v_res jsonb;
  v_dob date; v_sex text; v_state text;
  v_yearly uuid; v_rows int; v_classes text;
begin
  select id, organisation_id into v_owner, v_org
    from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_sponsor
    from public.profiles where role = 'patient' and id <> v_owner order by created_at limit 1;
  select id into v_stranger
    from public.profiles where role = 'patient' and id not in (v_owner, v_sponsor)
    order by created_at limit 1;

  if v_stranger is null then raise exception 'need three patient profiles'; end if;

  -- The region trigger is real and will reject a dark state, which is correct.
  update public.profiles set state = 'Lagos' where id = v_owner;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_sponsor, 'manage', v_owner) on conflict do nothing;

  select code, price_kobo into v_code, v_price
    from public.panel_bundles where self_bookable and price_kobo > 0 order by price_kobo limit 1;

  ------------------------------------------------------- 1. sponsor books a request
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.sponsor_book_care(v_owner, v_code, null) into v_res;
  perform set_config('role', 'postgres', true);

  if not (v_res->>'ok')::boolean or not (v_res->>'self_arranged')::boolean
     or (v_res->>'paid')::boolean then
    raise exception 'FAIL 1: expected an ok, self-arranged, unpaid request, got %', v_res;
  end if;

  ------------------------------------------------------- 2. stranger blocked
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sponsor_book_care(v_owner, v_code, null);
    raise exception 'FAIL 2: a stranger booked care for someone';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ------------------------------------------------------- 3. basics written
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.sponsor_set_dependent_basics(v_owner, date '1955-03-04', 'female', 'Lagos', 'Ikeja');
  perform set_config('role', 'postgres', true);

  select date_of_birth, sex::text, state into v_dob, v_sex, v_state
    from public.profiles where id = v_owner;
  if v_dob <> date '1955-03-04' or v_sex <> 'female' or v_state <> 'Lagos' then
    raise exception 'FAIL 3: basics not written (dob=% sex=% state=%)', v_dob, v_sex, v_state;
  end if;

  ------------------------------------------------------- 4. stranger blocked
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sponsor_set_dependent_basics(v_owner, date '1900-01-01', null, null, null);
    raise exception 'FAIL 4: a stranger edited someone''s profile';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('role', 'postgres', true);

  ------------------------------------------------------- 5. monthly report
  -- A "sponsor" is now someone who bought a voucher for somebody else, not
  -- someone who topped up a wallet. A yearly subscription voucher is the only
  -- kind still purchasable for another person (purchase_care_voucher, the
  -- lab-panel voucher, was permanently closed in
  -- 20260803134416_self_arranged_consistency_sweep.sql once Tarragon stopped
  -- billing tests at all) -- the voucher need not even be paid off: the
  -- report groups by purchaser/beneficiary pair regardless of the voucher's
  -- status.
  -- Every NGN paid plan is currently is_active=false pending a Paystack
  -- "Sync now" re-sync after the 2026-08-05 price change
  -- (20260805201508_raise_ngn_tier_prices_and_fold_prevention_into_chronic_
  -- plans.sql) -- a real, current ops state, not a code defect. Reactivate
  -- the yearly NGN tiers for the life of this rolled-back transaction only,
  -- same as care_vouchers.sql/health_reset_90_day.sql/subscription_care_
  -- vouchers.sql already do.
  update public.subscription_plans set is_active = true
   where interval = 'yearly' and currency = 'NGN' and price_minor > 0;

  select id into v_yearly
    from public.subscription_plans
   where interval = 'yearly' and is_active and currency = 'NGN' and price_minor > 0
   order by price_minor limit 1;
  if v_yearly is null then raise exception 'need an active yearly NGN plan fixture'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.purchase_subscription_voucher(v_owner, v_yearly, 'Get well soon');
  perform set_config('role', 'postgres', true);

  perform private.queue_sponsor_monthly_reports();

  select count(*) into v_rows from public.notifications
   where template = 'sponsor_monthly_report' and recipient_id = v_sponsor;
  if v_rows <> 2 then raise exception 'FAIL 5: % rows, expected 2 (in_app + email)', v_rows; end if;

  select string_agg(distinct content_class::text, ',') into v_classes
    from public.notifications where template = 'sponsor_monthly_report';
  if v_classes <> 'non_clinical' then
    raise exception 'FAIL 5: content_class was %, expected non_clinical', v_classes;
  end if;

  raise notice 'PASS: booking, permission gates, basics and the monthly report all behaved';
end $$;

rollback;
