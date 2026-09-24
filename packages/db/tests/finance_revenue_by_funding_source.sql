-- ===========================================================================
-- Regression: 20260924211136_finance_revenue_by_funding_source.sql
--
-- THE GAP. Nothing on the finance dashboard distinguished real cash revenue
-- (Paystack, or platform-credit paid_balance) from promo/voucher-funded
-- revenue (a reward_discount voucher, or platform-credit promo_balance) --
-- everything blended into the same "Revenue" tiles, even though the GL's own
-- account-level segregation (1020/2100 = real money, 2600 = promotional,
-- never commingled) already makes the split possible.
--
-- THE FIX. public.finance_revenue_by_funding_source() classifies point-of-
-- sale revenue by its journal entry's own debit leg (1020/2100 -> cash,
-- 2600 -> promotional), and recognised (previously-deferred) revenue by
-- tracing the schedule back to whatever actually funded the underlying
-- service_purchase (card remainder + platform-credit paid_balance + a
-- prepaid_service voucher = cash; platform-credit promo_balance + a
-- reward_discount voucher = promotional), proportioned onto the amount
-- recognised this period.
--
-- This script proves, against the real function + the real voucher/
-- platform-credit machinery:
--   * a reward-voucher-funded bounded-duration purchase's recognised
--     revenue lands entirely in promotional_minor;
--   * a platform-credit-paid_balance-funded bounded-duration purchase's
--     recognised revenue lands entirely in cash_minor;
--   * a plain point-of-sale card payment lands in cash_minor, a plain
--     point-of-sale voucher/promo redemption lands in promotional_minor;
--   * nothing lands in unclassified_minor;
--   * SABOTAGE: reverting the function to sum every revenue-account credit
--     into cash_minor regardless of funding source (the pre-fix gap: no
--     distinction at all) makes the promo-funded amounts show up as cash,
--     proving the checks above discriminate rather than passing vacuously.
--
-- Synthetic 'revenue_recognition' journal entries are posted directly
-- (rather than driving the real private.finance_recognize_revenue(), which
-- loops over every active schedule in the database) so this test is
-- isolated to proving the RPC's own classification query.
--
-- Wrapped in BEGIN/ROLLBACK -- mints its own patient, organisation-scoped
-- fixtures; the rollback undoes all of it.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/finance_revenue_by_funding_source.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
-- ===========================================================================

begin;
create temporary table rfs_result(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table rfs_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_pat uuid := gen_random_uuid();
  v_bounded_prod uuid;
  v_sp_promo uuid;
  v_sp_cash uuid;
  v_voucher_id uuid;
  v_sched_promo uuid;
  v_sched_cash uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  if v_org is null or v_admin is null then raise exception 'fixture FAIL: missing org or admin profile'; end if;

  insert into public.service_products (code, name, price_kobo, access_duration_days, is_active)
  values ('rfs_test_bounded_' || substr(gen_random_uuid()::text, 1, 8), 'RFS Test Bounded Product', 500000, 90, true)
  returning id into v_bounded_prod;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'rfs-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pat, v_org, 'patient', 'Revenue Funding Source Test Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  -- sp_promo: bounded purchase fully covered by a reward_discount voucher.
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 500000, 'NGN')
  returning id into v_sp_promo;

  v_voucher_id := private.issue_reward_voucher(v_pat, 500000, 'RFS test reward', 'test fixture');
  if v_voucher_id is null then raise exception 'fixture FAIL: could not mint reward voucher'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.redeem_care_voucher(v_voucher_id, 'service_purchase', v_sp_promo);
  reset role;

  -- sp_cash: bounded purchase fully covered by platform-credit PAID balance.
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 500000, 'NGN')
  returning id into v_sp_cash;

  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'topup', p_amount_kobo := 500000,
    p_description := 'rfs fixture funding'
  );
  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'spend', p_amount_kobo := 500000,
    p_service_purchase_id := v_sp_cash, p_description := 'rfs test cash spend'
  );

  select id into v_sched_promo from public.revenue_recognition_schedules where source_id = v_sp_promo;
  select id into v_sched_cash from public.revenue_recognition_schedules where source_id = v_sp_cash;
  if v_sched_promo is null or v_sched_cash is null then
    raise exception 'fixture FAIL: expected both schedules to exist (promo=%, cash=%)', v_sched_promo, v_sched_cash;
  end if;

  perform private.finance_post_journal(current_date, 'NGN'::public.currency, 'revenue_recognition',
    'revrec:' || v_sched_promo::text || ':synthtest',
    'synthetic recognition — promo',
    jsonb_build_array(
      jsonb_build_object('account_code','2000','debit_minor',100000,'credit_minor',0,'organisation_id',v_org),
      jsonb_build_object('account_code','4020','debit_minor',0,'credit_minor',100000,'organisation_id',v_org)),
    null);
  perform private.finance_post_journal(current_date, 'NGN'::public.currency, 'revenue_recognition',
    'revrec:' || v_sched_cash::text || ':synthtest',
    'synthetic recognition — cash',
    jsonb_build_array(
      jsonb_build_object('account_code','2000','debit_minor',150000,'credit_minor',0,'organisation_id',v_org),
      jsonb_build_object('account_code','4020','debit_minor',0,'credit_minor',150000,'organisation_id',v_org)),
    null);

  perform private.finance_post_journal(current_date, 'NGN'::public.currency, 'payment', 'rfs-test-cash-imm',
    'test cash immediate',
    jsonb_build_array(
      jsonb_build_object('account_code','1020','debit_minor',111000,'credit_minor',0,'organisation_id',v_org),
      jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',111000,'organisation_id',v_org)),
    null);
  perform private.finance_post_journal(current_date, 'NGN'::public.currency, 'voucher', 'rfs-test-promo-imm',
    'test promo immediate',
    jsonb_build_array(
      jsonb_build_object('account_code','2600','debit_minor',222000,'credit_minor',0,'organisation_id',v_org),
      jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',222000,'organisation_id',v_org)),
    null);

  insert into rfs_fixture values ('org', v_org), ('admin', v_admin);
end $$;

-- ====== 1. The real function correctly splits cash vs promotional =========
do $$
declare
  v_admin uuid := (select v from rfs_fixture where k = 'admin');
  v_res jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.finance_revenue_by_funding_source(current_date - 1, current_date + 1, 'NGN');
  reset role;

  insert into rfs_result values
    ('cash_minor = 111000 (immediate card) + 150000 (recognised, platform-credit paid_balance)',
     (v_res ->> 'cash_minor'), '261000',
     case when (v_res ->> 'cash_minor')::bigint = 261000 then 'PASS' else 'FAIL' end);
  if (v_res ->> 'cash_minor')::bigint <> 261000 then
    raise exception 'HOLE OPEN: cash_minor = % (expected 261000)', v_res ->> 'cash_minor';
  end if;

  insert into rfs_result values
    ('promotional_minor = 222000 (immediate voucher) + 100000 (recognised, reward voucher)',
     (v_res ->> 'promotional_minor'), '322000',
     case when (v_res ->> 'promotional_minor')::bigint = 322000 then 'PASS' else 'FAIL' end);
  if (v_res ->> 'promotional_minor')::bigint <> 322000 then
    raise exception 'HOLE OPEN: promotional_minor = % (expected 322000)', v_res ->> 'promotional_minor';
  end if;

  insert into rfs_result values
    ('unclassified_minor = 0', (v_res ->> 'unclassified_minor'), '0',
     case when (v_res ->> 'unclassified_minor')::bigint = 0 then 'PASS' else 'FAIL' end);
  if (v_res ->> 'unclassified_minor')::bigint <> 0 then
    raise exception 'FAIL: unclassified_minor = % (expected 0)', v_res ->> 'unclassified_minor';
  end if;

  insert into rfs_result values
    ('total_minor = cash + promotional + unclassified', (v_res ->> 'total_minor'), '583000',
     case when (v_res ->> 'total_minor')::bigint = 583000 then 'PASS' else 'FAIL' end);
  if (v_res ->> 'total_minor')::bigint <> 583000 then
    raise exception 'FAIL: total_minor = % (expected 583000)', v_res ->> 'total_minor';
  end if;
end $$;

-- ====== 2. SABOTAGE — collapsing the split back to "everything is cash" ====
do $$
declare
  v_admin uuid := (select v from rfs_fixture where k = 'admin');
  v_res jsonb;
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
    -- SABOTAGE: exactly the pre-fix gap — every revenue-account credit
    -- counted as cash, no funding-source distinction at all.
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

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.finance_revenue_by_funding_source(current_date - 1, current_date + 1, 'NGN');
  reset role;

  insert into rfs_result values
    ('SABOTAGE: collapsing the split makes every promo-funded amount show up as cash',
     'cash_minor=' || (v_res ->> 'cash_minor') || ' promotional_minor=' || (v_res ->> 'promotional_minor'),
     'cash_minor=583000 promotional_minor=0',
     case when (v_res ->> 'cash_minor')::bigint = 583000 and (v_res ->> 'promotional_minor')::bigint = 0
          then 'PASS' else 'FAIL' end);
  if (v_res ->> 'cash_minor')::bigint <> 583000 or (v_res ->> 'promotional_minor')::bigint <> 0 then
    raise exception 'VACUOUS TEST: sabotaging the fix did not reopen the gap -- check 1 proves nothing (got cash=%, promo=%)',
      v_res ->> 'cash_minor', v_res ->> 'promotional_minor';
  end if;
end $$;

select check_name, observed, expected, verdict from rfs_result order by check_name;
rollback;
