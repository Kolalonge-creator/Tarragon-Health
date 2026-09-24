-- ===========================================================================
-- Regression: 20260924211113_fix_voucher_redemption_finance_posting_amount_
--             and_deferral.sql
--
-- THE BUGS. private.finance_post_voucher_redeemed():
--   1. OVERSTATEMENT — always posted the voucher's full face_value_kobo as
--      revenue, not the amount actually applied to the order (redeem_care_
--      voucher's own v_covered := least(face_value_kobo, payable)). A reward
--      voucher worth more than the order it discounted overstated revenue
--      beyond what the order was ever priced at.
--   2. TIMING — for a service_purchase, always posted straight to 4100
--      (immediate revenue), never checking service_products.access_
--      duration_days the way the equivalent card-payment and platform-credit
--      paths both correctly do. A bounded-duration pack redeemed via a
--      promo code/voucher recognised 100% of its value on day one instead of
--      deferring to 2000 and recognising straight-line over its access
--      window.
--
-- THE FIX. The trigger now reads the redeeming order's own voucher_covered_
-- kobo (the amount actually applied) instead of face_value_kobo, and for a
-- service_purchase against a bounded-duration product, defers to 2000 with a
-- matching revenue_recognition_schedules row instead of posting straight to
-- 4100.
--
-- This script proves, against the real trigger + public.redeem_care_voucher:
--   * a reward voucher worth MORE than a bounded-duration order's price
--     posts only the covered amount to revenue, deferred to 2000, with a
--     correctly-sized recognition schedule;
--   * CONTROL: a reward voucher worth more than an UNBOUNDED order's price
--     still posts only the covered amount (not face value) straight to
--     4100, with no recognition schedule created;
--   * SABOTAGE: reverting to the pre-fix trigger (unconditional face-value
--     amount, unconditional 4100) reopens both holes on a fresh bounded-
--     duration redemption, proving the two checks above discriminate rather
--     than passing vacuously.
--
-- Wrapped in BEGIN/ROLLBACK -- mints its own patient, organisation-scoped
-- fixtures, and (for the sabotage step) redefines the trigger function once;
-- the rollback undoes all of it.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/voucher_redemption_finance_posting_amount_and_deferral.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
-- ===========================================================================

begin;
create temporary table vrf_result(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table vrf_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_bounded_prod uuid;
  v_unbounded_prod uuid;
  v_bounded_pur uuid;
  v_unbounded_pur uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists at all -- the core migrations did not run'; end if;

  insert into public.service_products (code, name, price_kobo, access_duration_days, is_active)
  values ('vrf_test_bounded_' || substr(gen_random_uuid()::text, 1, 8), 'VRF Test Bounded Product', 500000, 90, true)
  returning id into v_bounded_prod;

  insert into public.service_products (code, name, price_kobo, access_duration_days, is_active)
  values ('vrf_test_unbounded_' || substr(gen_random_uuid()::text, 1, 8), 'VRF Test Unbounded Product', 300000, null, true)
  returning id into v_unbounded_prod;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'vrf-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pat, v_org, 'patient', 'Voucher Redemption Finance Test Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values
    (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 500000, 'NGN')
  returning id into v_bounded_pur;

  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values
    (gen_random_uuid(), v_org, v_pat, v_pat, v_unbounded_prod, 'pending_payment', 300000, 'NGN')
  returning id into v_unbounded_pur;

  insert into vrf_fixture values
    ('org', v_org), ('pat', v_pat), ('bounded_prod', v_bounded_prod), ('unbounded_prod', v_unbounded_prod),
    ('bounded_pur', v_bounded_pur), ('unbounded_pur', v_unbounded_pur);
end $$;

-- ====== 1. Bounded-duration order: a voucher worth MORE than the order =====
-- posts only the covered amount, deferred to 2000, with a correctly-sized
-- recognition schedule.
do $$
declare
  v_pat uuid := (select v from vrf_fixture where k = 'pat');
  v_org uuid := (select v from vrf_fixture where k = 'org');
  v_pur uuid := (select v from vrf_fixture where k = 'bounded_pur');
  v_voucher_id uuid;
  v_res jsonb;
  v_account text;
  v_credit bigint;
  v_schedule_count int;
  v_schedule_total bigint;
  v_schedule_account text;
begin
  -- Face value (800000) deliberately exceeds the order's payable (500000).
  v_voucher_id := private.issue_reward_voucher(v_pat, 800000, 'VRF test reward — bounded', 'test fixture');
  if v_voucher_id is null then raise exception 'fixture FAIL: could not mint the bounded-case reward voucher'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_care_voucher(v_voucher_id, 'service_purchase', v_pur);
  reset role;

  if (v_res ->> 'covered_kobo')::bigint <> 500000 or (v_res ->> 'fully_covered')::boolean is distinct from true then
    raise exception 'fixture FAIL: redemption did not fully cover the bounded order as expected (res=%)', v_res;
  end if;

  select l.account_code, l.credit_minor into v_account, v_credit
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'voucher' and e.source_ref = 'redeem:' || v_voucher_id::text
      and l.credit_minor > 0;

  insert into vrf_result values
    ('a bounded-duration order posts only the covered amount (not face value), deferred to 2000',
     coalesce(v_account, '<no journal line>') || ' credit=' || coalesce(v_credit::text,'0'),
     '2000 credit=500000',
     case when v_account = '2000' and v_credit = 500000 then 'PASS' else 'FAIL' end);
  if v_account is distinct from '2000' or v_credit is distinct from 500000 then
    raise exception 'HOLE OPEN: bounded order voucher redemption posted % credit=% instead of 2000 credit=500000',
      coalesce(v_account,'<none>'), coalesce(v_credit::text,'<none>');
  end if;

  select count(*), coalesce(sum(total_minor),0), min(revenue_account_code)
    into v_schedule_count, v_schedule_total, v_schedule_account
    from public.revenue_recognition_schedules
    where source_kind = 'service_purchase' and source_id = v_pur;

  insert into vrf_result values
    ('the same redemption creates a revenue_recognition_schedules row for the covered amount, not face value',
     'count=' || v_schedule_count || ' total=' || v_schedule_total || ' account=' || coalesce(v_schedule_account,'<none>'),
     'count=1 total=500000 account=4020',
     case when v_schedule_count = 1 and v_schedule_total = 500000 and v_schedule_account = '4020' then 'PASS' else 'FAIL' end);
  if v_schedule_count <> 1 or v_schedule_total <> 500000 or v_schedule_account is distinct from '4020' then
    raise exception 'HOLE OPEN: bounded order voucher redemption did not create a correct recognition schedule (count=%, total=%, account=%)',
      v_schedule_count, v_schedule_total, coalesce(v_schedule_account,'<none>');
  end if;
end $$;

-- ====== 2. CONTROL — unbounded order: voucher worth more than the order ====
-- still posts only the covered amount, straight to 4100, no schedule.
do $$
declare
  v_pat uuid := (select v from vrf_fixture where k = 'pat');
  v_pur uuid := (select v from vrf_fixture where k = 'unbounded_pur');
  v_voucher_id uuid;
  v_res jsonb;
  v_account text;
  v_credit bigint;
  v_schedule_count int;
begin
  -- Face value (1000000) deliberately exceeds the order's payable (300000).
  v_voucher_id := private.issue_reward_voucher(v_pat, 1000000, 'VRF test reward — unbounded', 'test fixture');
  if v_voucher_id is null then raise exception 'fixture FAIL: could not mint the unbounded-case reward voucher'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_care_voucher(v_voucher_id, 'service_purchase', v_pur);
  reset role;

  if (v_res ->> 'covered_kobo')::bigint <> 300000 or (v_res ->> 'fully_covered')::boolean is distinct from true then
    raise exception 'fixture FAIL: redemption did not fully cover the unbounded order as expected (res=%)', v_res;
  end if;

  select l.account_code, l.credit_minor into v_account, v_credit
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'voucher' and e.source_ref = 'redeem:' || v_voucher_id::text
      and l.credit_minor > 0;

  insert into vrf_result values
    ('CONTROL: an unbounded order posts only the covered amount (not face value), straight to 4100',
     coalesce(v_account, '<no journal line>') || ' credit=' || coalesce(v_credit::text,'0'),
     '4100 credit=300000',
     case when v_account = '4100' and v_credit = 300000 then 'PASS' else 'FAIL' end);
  if v_account is distinct from '4100' or v_credit is distinct from 300000 then
    raise exception 'REGRESSION: unbounded order voucher redemption posted % credit=% instead of 4100 credit=300000',
      coalesce(v_account,'<none>'), coalesce(v_credit::text,'<none>');
  end if;

  select count(*) into v_schedule_count
    from public.revenue_recognition_schedules
    where source_kind = 'service_purchase' and source_id = v_pur;

  insert into vrf_result values
    ('CONTROL: an unbounded order''s redemption creates no revenue_recognition_schedules row',
     v_schedule_count::text, '0', case when v_schedule_count = 0 then 'PASS' else 'FAIL' end);
  if v_schedule_count <> 0 then
    raise exception 'FAIL: unbounded order voucher redemption unexpectedly created % recognition schedule row(s)', v_schedule_count;
  end if;
end $$;

-- ====== 3. SABOTAGE — reverting to the pre-fix trigger reopens both holes ==
do $$
declare
  v_pat uuid := (select v from vrf_fixture where k = 'pat');
  v_org uuid := (select v from vrf_fixture where k = 'org');
  v_bounded_prod uuid := (select v from vrf_fixture where k = 'bounded_prod');
  v_pur uuid;
  v_voucher_id uuid;
  v_res jsonb;
  v_account text;
  v_credit bigint;
begin
  create or replace function private.finance_post_voucher_redeemed()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_liability text;
  begin
    -- SABOTAGE: exactly the pre-fix bug — unconditional face_value_kobo,
    -- unconditional 4100.
    if new.status <> 'redeemed' or old.status = 'redeemed' then return new; end if;
    v_liability := case when new.kind = 'prepaid_service' then '2100' else '2600' end;
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'voucher', 'redeem:' || new.id::text,
      'Voucher redeemed — sabotage',
      jsonb_build_array(
        jsonb_build_object('account_code',v_liability,'debit_minor',new.face_value_kobo,'credit_minor',0,
                           'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',new.face_value_kobo,
                           'organisation_id',new.organisation_id,'cost_center_code','PARTNER_NET')),
      null);
    return new;
  exception when others then
    return new;
  end;
  $function$;

  -- Fresh purchase against the same bounded product, and a voucher again
  -- worth more than its price — hits both bugs at once, same as check 1.
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 500000, 'NGN')
  returning id into v_pur;

  v_voucher_id := private.issue_reward_voucher(v_pat, 800000, 'VRF sabotage reward', 'test fixture');

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_care_voucher(v_voucher_id, 'service_purchase', v_pur);
  reset role;

  select l.account_code, l.credit_minor into v_account, v_credit
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'voucher' and e.source_ref = 'redeem:' || v_voucher_id::text
      and l.credit_minor > 0;

  insert into vrf_result values
    ('SABOTAGE: reverting reopens the deferral bug — bounded order lands on 4100 again',
     coalesce(v_account, '<no journal line>'), '4100',
     case when v_account = '4100' then 'PASS' else 'FAIL' end);
  if v_account is distinct from '4100' then
    raise exception 'VACUOUS TEST: sabotaging the fix did not reopen the deferral hole -- check 1 proves nothing (got %)', coalesce(v_account,'<none>');
  end if;

  insert into vrf_result values
    ('SABOTAGE: reverting reopens the overstatement bug — face value (800000) posted instead of covered (500000)',
     coalesce(v_credit::text, '<no journal line>'), '800000',
     case when v_credit = 800000 then 'PASS' else 'FAIL' end);
  if v_credit is distinct from 800000 then
    raise exception 'VACUOUS TEST: sabotaging the fix did not reopen the overstatement hole -- check 1/2 prove nothing (got %)', coalesce(v_credit::text,'<none>');
  end if;
end $$;

select check_name, observed, expected, verdict from vrf_result order by check_name;
rollback;
