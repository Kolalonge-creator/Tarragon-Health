-- ===========================================================================
-- Regression: 20260924213634_fix_voucher_redemption_cross_voucher_double_
--             count_and_revrec_rounding.sql
--
-- Fixes found by /code-review high on the previous two migrations
-- (20260924211113, 20260924211136) before they were ever merged.
--
-- BUG 1 — CROSS-VOUCHER DOUBLE-COUNTING. private.finance_post_voucher_
-- redeemed read the redeeming order's voucher_covered_kobo, which is
-- CUMULATIVE across every voucher ever applied to that order. public.
-- redeem_care_voucher has no "only one discount per order" guard of its own
-- (that lives one layer up, in redeem_promo_code) — a second voucher
-- redeemed directly against an already-partially-covered order is a real,
-- reachable path. The trigger would have read the now-cumulative total for
-- the second voucher's redemption instead of what THAT voucher contributed,
-- double-counting the first voucher's amount.
--
-- BUG 2 — MID-PERIOD MISATTRIBUTION ACROSS MULTIPLE SCHEDULES. A single
-- service_purchase can accumulate more than one revenue_recognition_
-- schedules row (a partial voucher redemption creates one; a later card
-- payment or platform-credit spend for the remainder creates a separate
-- one). finance_revenue_by_funding_source computed ONE blended cash/promo
-- ratio from the purchase's lifetime totals and applied it to every
-- schedule tied to that purchase — correct in total over the purchase's
-- full lifetime, wrong for any period queried before all of a purchase's
-- schedules have posted revenue.
--
-- THE FIX. care_vouchers.redeemed_amount_kobo persists the exact amount
-- THIS voucher covered (set once, at redemption, immune to any other
-- voucher's activity on the same order). revenue_recognition_schedules.
-- promo_minor persists the exact promotional portion of THAT SPECIFIC
-- schedule's total, set once at creation by whichever trigger knows
-- precisely. Both triggers now read their own persisted, non-cumulative
-- values instead of re-deriving them from state shared with other
-- redemptions/schedules.
--
-- This script proves, against the real functions:
--   * a second voucher redeemed against an order a first voucher already
--     partially covered posts only its own amount — the two together sum
--     to exactly the order's true price, not double-counted;
--   * a purchase with two separately-funded schedules (one voucher/promo,
--     one platform-credit/cash) reports a mid-period recognition of only
--     the promo schedule as 100% promotional, not blended with the cash
--     schedule's lifetime share;
--   * the original single-schedule overstatement/deferral fix still holds;
--   * SABOTAGE: reverting either trigger to its pre-fix, cumulative-
--     derivation shape reopens the corresponding hole, proving the checks
--     above discriminate rather than passing vacuously.
--
-- Wrapped in BEGIN/ROLLBACK -- mints its own patient, organisation-scoped
-- fixtures, and (for the sabotage steps) redefines a trigger function each
-- time; the rollback undoes all of it.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/voucher_redemption_cross_voucher_double_count_and_revrec_rounding.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
-- ===========================================================================

begin;
create temporary table vcd_result(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table vcd_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_pat uuid := gen_random_uuid();
  v_bounded_prod uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_org is null or v_admin is null then raise exception 'fixture FAIL: missing org or admin profile'; end if;

  insert into public.service_products (code, name, price_kobo, access_duration_days, is_active)
  values ('vcd_test_bounded_' || substr(gen_random_uuid()::text, 1, 8), 'VCD Test Bounded Product', 1000000, 90, true)
  returning id into v_bounded_prod;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'vcd-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pat, v_org, 'patient', 'Cross-Voucher Double-Count Test Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  insert into vcd_fixture values ('org', v_org), ('admin', v_admin), ('pat', v_pat), ('bounded_prod', v_bounded_prod);
end $$;

-- ====== 1. A second voucher against an already-partially-covered order =====
-- posts only its own amount, not the order's cumulative total.
do $$
declare
  v_pat uuid := (select v from vcd_fixture where k = 'pat');
  v_org uuid := (select v from vcd_fixture where k = 'org');
  v_bounded_prod uuid := (select v from vcd_fixture where k = 'bounded_prod');
  v_pur uuid;
  v_voucher_a uuid;
  v_voucher_b uuid;
  v_res_a jsonb;
  v_res_b jsonb;
  v_credit_a bigint;
  v_credit_b bigint;
begin
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 1000000, 'NGN')
  returning id into v_pur;

  v_voucher_a := private.issue_reward_voucher(v_pat, 600000, 'VCD voucher A', 'test fixture');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res_a := public.redeem_care_voucher(v_voucher_a, 'service_purchase', v_pur);
  reset role;
  if (v_res_a ->> 'fully_covered')::boolean is distinct from false or (v_res_a ->> 'covered_kobo')::bigint <> 600000 then
    raise exception 'fixture FAIL: voucher A did not partially cover as expected (res=%)', v_res_a;
  end if;

  select l.credit_minor into v_credit_a
    from public.finance_journal_lines l join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'voucher' and e.source_ref = 'redeem:' || v_voucher_a::text and l.credit_minor > 0;

  v_voucher_b := private.issue_reward_voucher(v_pat, 400000, 'VCD voucher B', 'test fixture');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res_b := public.redeem_care_voucher(v_voucher_b, 'service_purchase', v_pur);
  reset role;
  if (v_res_b ->> 'fully_covered')::boolean is distinct from true or (v_res_b ->> 'covered_kobo')::bigint <> 400000 then
    raise exception 'fixture FAIL: voucher B did not fully cover the remainder as expected (res=%)', v_res_b;
  end if;

  select l.credit_minor into v_credit_b
    from public.finance_journal_lines l join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'voucher' and e.source_ref = 'redeem:' || v_voucher_b::text and l.credit_minor > 0;

  insert into vcd_result values
    ('a second voucher (400000) against an order a first voucher already covered 600000 of posts only its OWN amount, not the order''s cumulative 1,000,000',
     coalesce(v_credit_b::text,'<none>'), '400000',
     case when v_credit_b = 400000 then 'PASS' else 'FAIL' end);
  if v_credit_b is distinct from 400000 then
    raise exception 'HOLE OPEN: cross-voucher double-counting present — voucher B posted % instead of 400000', coalesce(v_credit_b::text,'<none>');
  end if;

  insert into vcd_result values
    ('the two vouchers together sum to exactly the order''s true price (1,000,000), not double-counted',
     (coalesce(v_credit_a,0) + coalesce(v_credit_b,0))::text, '1000000',
     case when coalesce(v_credit_a,0) + coalesce(v_credit_b,0) = 1000000 then 'PASS' else 'FAIL' end);
  if coalesce(v_credit_a,0) + coalesce(v_credit_b,0) <> 1000000 then
    raise exception 'HOLE OPEN: total posted revenue (%) does not equal the order''s true price (1000000)', coalesce(v_credit_a,0) + coalesce(v_credit_b,0);
  end if;
end $$;

-- ====== 2. Multi-schedule mid-period attribution is exact, not blended =====
do $$
declare
  v_pat uuid := (select v from vcd_fixture where k = 'pat');
  v_org uuid := (select v from vcd_fixture where k = 'org');
  v_admin uuid := (select v from vcd_fixture where k = 'admin');
  v_bounded_prod uuid := (select v from vcd_fixture where k = 'bounded_prod');
  v_pur uuid;
  v_voucher uuid;
  v_sched_promo uuid;
  v_sched_cash uuid;
  v_res jsonb;
begin
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 1000000, 'NGN')
  returning id into v_pur;

  v_voucher := private.issue_reward_voucher(v_pat, 300000, 'VCD multi-schedule voucher', 'test fixture');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_care_voucher(v_voucher, 'service_purchase', v_pur);
  reset role;
  if (v_res ->> 'covered_kobo')::bigint <> 300000 then
    raise exception 'fixture FAIL: voucher did not cover 300000 as expected (res=%)', v_res;
  end if;

  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'topup', p_amount_kobo := 700000,
    p_description := 'vcd fixture funding'
  );
  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'spend', p_amount_kobo := 700000,
    p_service_purchase_id := v_pur, p_description := 'vcd test cash remainder'
  );

  select id into v_sched_promo from public.revenue_recognition_schedules where source_id = v_pur and total_minor = 300000;
  select id into v_sched_cash from public.revenue_recognition_schedules where source_id = v_pur and total_minor = 700000;
  if v_sched_promo is null or v_sched_cash is null then
    raise exception 'fixture FAIL: expected two separate schedules on the same purchase (promo=%, cash=%)', v_sched_promo, v_sched_cash;
  end if;

  insert into vcd_result values
    ('the voucher-funded schedule is tagged promo_minor equal to its own total (300000), independent of the purchase''s other schedule',
     (select promo_minor from public.revenue_recognition_schedules where id = v_sched_promo)::text, '300000',
     case when (select promo_minor from public.revenue_recognition_schedules where id = v_sched_promo) = 300000 then 'PASS' else 'FAIL' end);

  insert into vcd_result values
    ('the platform-credit-paid_balance-funded schedule is tagged promo_minor=0, independent of the purchase''s other schedule',
     (select promo_minor from public.revenue_recognition_schedules where id = v_sched_cash)::text, '0',
     case when (select promo_minor from public.revenue_recognition_schedules where id = v_sched_cash) = 0 then 'PASS' else 'FAIL' end);

  perform private.finance_post_journal(current_date, 'NGN'::public.currency, 'revenue_recognition',
    'revrec:' || v_sched_promo::text || ':synthtest',
    'synthetic recognition — promo schedule only',
    jsonb_build_array(
      jsonb_build_object('account_code','2000','debit_minor',100000,'credit_minor',0,'organisation_id',v_org),
      jsonb_build_object('account_code','4020','debit_minor',0,'credit_minor',100000,'organisation_id',v_org)),
    null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.finance_revenue_by_funding_source(current_date - 1, current_date + 1, 'NGN');
  reset role;

  insert into vcd_result values
    ('mid-period: only the promo schedule has recognised revenue so far -- reports 100% promotional, not blended with the cash schedule''s lifetime share',
     'cash=' || (v_res ->> 'cash_minor') || ' promo=' || (v_res ->> 'promotional_minor'),
     'cash=0 promo=100000',
     case when (v_res ->> 'cash_minor')::bigint = 0 and (v_res ->> 'promotional_minor')::bigint = 100000
          then 'PASS' else 'FAIL' end);
  if (v_res ->> 'cash_minor')::bigint <> 0 or (v_res ->> 'promotional_minor')::bigint <> 100000 then
    raise exception 'HOLE OPEN: mid-period recognised revenue blends multiple schedules on one purchase (got cash=%, promo=%)',
      v_res ->> 'cash_minor', v_res ->> 'promotional_minor';
  end if;
end $$;

-- ====== 3. SABOTAGE 1 — reverting to the cumulative-column derivation =====
-- reopens the cross-voucher double-counting hole.
do $$
declare
  v_pat uuid := (select v from vcd_fixture where k = 'pat');
  v_org uuid := (select v from vcd_fixture where k = 'org');
  v_bounded_prod uuid := (select v from vcd_fixture where k = 'bounded_prod');
  v_pur uuid;
  v_voucher_a uuid;
  v_voucher_b uuid;
  v_credit_b bigint;
begin
  create or replace function private.finance_post_voucher_redeemed()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_liability text;
    v_covered bigint;
  begin
    -- SABOTAGE: back to re-deriving from the order's cumulative column,
    -- exactly the pre-fix bug (redeemed_amount_kobo ignored entirely).
    if new.status <> 'redeemed' or old.status = 'redeemed' then return new; end if;
    v_liability := case when new.kind = 'prepaid_service' then '2100' else '2600' end;
    v_covered := case new.redeemed_order_type::text
      when 'service_purchase' then (select voucher_covered_kobo from public.service_purchases where id = new.redeemed_order_id)
      else new.face_value_kobo
    end;
    if v_covered <= 0 then return new; end if;
    perform private.finance_post_journal(
      current_date, 'NGN'::public.currency, 'voucher', 'redeem:' || new.id::text,
      'Voucher redeemed — sabotage',
      jsonb_build_array(
        jsonb_build_object('account_code',v_liability,'debit_minor',v_covered,'credit_minor',0,'organisation_id',new.organisation_id),
        jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',v_covered,'organisation_id',new.organisation_id,'cost_center_code','PARTNER_NET')),
      null);
    return new;
  exception when others then
    return new;
  end;
  $function$;

  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 1000000, 'NGN')
  returning id into v_pur;

  v_voucher_a := private.issue_reward_voucher(v_pat, 600000, 'VCD sabotage voucher A', 'test fixture');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.redeem_care_voucher(v_voucher_a, 'service_purchase', v_pur);
  reset role;

  v_voucher_b := private.issue_reward_voucher(v_pat, 400000, 'VCD sabotage voucher B', 'test fixture');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.redeem_care_voucher(v_voucher_b, 'service_purchase', v_pur);
  reset role;

  select l.credit_minor into v_credit_b
    from public.finance_journal_lines l join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'voucher' and e.source_ref = 'redeem:' || v_voucher_b::text and l.credit_minor > 0;

  insert into vcd_result values
    ('SABOTAGE 1: reverting to the cumulative-column derivation reopens cross-voucher double-counting — the second voucher posts the order''s cumulative total (1,000,000) instead of its own 400,000',
     coalesce(v_credit_b::text, '<none>'), '1000000',
     case when v_credit_b = 1000000 then 'PASS' else 'FAIL' end);
  if v_credit_b is distinct from 1000000 then
    raise exception 'VACUOUS TEST: sabotaging the fix did not reopen the double-counting hole -- check 1 proves nothing (got %)', coalesce(v_credit_b::text,'<none>');
  end if;
end $$;

-- ====== 4. SABOTAGE 2 — reverting to the ratio-based derivation reopens ===
-- the multi-schedule mid-period blending hole.
do $$
declare
  v_pat uuid := (select v from vcd_fixture where k = 'pat');
  v_org uuid := (select v from vcd_fixture where k = 'org');
  v_admin uuid := (select v from vcd_fixture where k = 'admin');
  v_bounded_prod uuid := (select v from vcd_fixture where k = 'bounded_prod');
  v_pur uuid;
  v_voucher uuid;
  v_sched_promo uuid;
  v_before jsonb;
  v_after jsonb;
  v_delta_cash bigint;
  v_delta_promo bigint;
begin
  create or replace function public.finance_revenue_by_funding_source(
    p_period_start date default date_trunc('month', current_date)::date,
    p_period_end date default current_date,
    p_currency text default 'NGN'
  )
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $function$
  declare
    v_cur public.currency := coalesce(p_currency, 'NGN')::public.currency;
    v_total bigint := 0;
  begin
    -- SABOTAGE: back to summing every revenue-account credit as cash,
    -- ignoring promo_minor entirely (a coarser version of the pre-fix bug,
    -- sufficient to prove the multi-schedule check would have caught it).
    if not private.is_finance() then return '{}'::jsonb; end if;
    select coalesce(sum(l.credit_minor), 0) into v_total
      from public.finance_journal_lines l
      join public.finance_journal_entries e on e.id = l.entry_id
      join public.finance_accounts a on a.code = l.account_code
      where a.account_type = 'revenue' and l.currency = v_cur
        and e.entry_date between p_period_start and p_period_end;
    return jsonb_build_object('cash_minor', v_total, 'promotional_minor', 0, 'unclassified_minor', 0, 'total_minor', v_total);
  end;
  $function$;

  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 1000000, 'NGN')
  returning id into v_pur;

  v_voucher := private.issue_reward_voucher(v_pat, 300000, 'VCD sabotage2 voucher', 'test fixture');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.redeem_care_voucher(v_voucher, 'service_purchase', v_pur);
  reset role;

  select id into v_sched_promo from public.revenue_recognition_schedules where source_id = v_pur and total_minor = 300000;

  -- Baseline BEFORE posting the synthetic entry -- this transaction has
  -- already posted plenty of other revenue from the earlier checks above,
  -- so the assertion below is on the DELTA this one new entry causes, not
  -- on an absolute total (which would be contaminated by everything else
  -- posted so far in this same rolled-back transaction).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_before := public.finance_revenue_by_funding_source(current_date - 1, current_date + 1, 'NGN');
  reset role;

  perform private.finance_post_journal(current_date, 'NGN'::public.currency, 'revenue_recognition',
    'revrec:' || v_sched_promo::text || ':synthtest',
    'synthetic recognition — sabotage2',
    jsonb_build_array(
      jsonb_build_object('account_code','2000','debit_minor',100000,'credit_minor',0,'organisation_id',v_org),
      jsonb_build_object('account_code','4020','debit_minor',0,'credit_minor',100000,'organisation_id',v_org)),
    null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_after := public.finance_revenue_by_funding_source(current_date - 1, current_date + 1, 'NGN');
  reset role;

  v_delta_cash := (v_after ->> 'cash_minor')::bigint - (v_before ->> 'cash_minor')::bigint;
  v_delta_promo := (v_after ->> 'promotional_minor')::bigint - (v_before ->> 'promotional_minor')::bigint;

  insert into vcd_result values
    ('SABOTAGE 2: reverting to the coarse sum-everything-as-cash shape makes a new promo-only recognition show up entirely as cash (delta), not promotional',
     'delta_cash=' || v_delta_cash || ' delta_promo=' || v_delta_promo,
     'delta_cash=100000 delta_promo=0',
     case when v_delta_cash = 100000 and v_delta_promo = 0 then 'PASS' else 'FAIL' end);
  if v_delta_cash is distinct from 100000 or v_delta_promo is distinct from 0 then
    raise exception 'VACUOUS TEST: sabotaging the fix did not reopen the misattribution hole -- check 2 proves nothing (got delta_cash=%, delta_promo=%)',
      v_delta_cash, v_delta_promo;
  end if;
end $$;

select check_name, observed, expected, verdict from vcd_result order by check_name;
rollback;
