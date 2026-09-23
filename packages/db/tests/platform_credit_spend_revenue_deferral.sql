-- ===========================================================================
-- Regression: 20260917234555_finance_kpi_cash_and_platform_credit_revenue_
--             deferral.sql (fix 2 of 2 in that migration)
--
-- THE BUG. private.finance_post_platform_credit_ledger_entry()'s 'spend'
-- branch always credited revenue account 4100 (immediate revenue)
-- unconditionally, with no check for whether the purchased service has a
-- bounded access window (service_products.access_duration_days). The
-- equivalent card-payment path (private.finance_post_from_payment,
-- service_purchase branch) correctly defers to account 2000 (deferred
-- revenue) and creates a revenue_recognition_schedules row when
-- access_duration_days is set. Live effect: the same "Continuous
-- Monitoring, 3 months" product was booked to deferred revenue when paid by
-- card but recognised as revenue on day one when paid by platform credit —
-- a real matching-principle violation, and inconsistent with this
-- platform's own stated policy that a service bought up front is deferred
-- until it is delivered.
--
-- THE FIX. The 'spend' branch now looks up access_duration_days via the
-- linked service_purchases -> service_products row and posts to 2000 (with
-- a matching revenue_recognition_schedules row) when it is set, 4100 only
-- when it is not (a genuine one-off, point-of-sale product).
--
-- This script proves, against the real trigger + private.platform_credit_apply:
--   * spending platform credit on a BOUNDED-access-window product posts the
--     paid-funded portion to deferred revenue (2000), never straight to 4100,
--     and creates a revenue_recognition_schedules row for the full amount;
--   * CONTROL: spending on an UNBOUNDED (one-off) product still posts
--     straight to 4100, with no recognition schedule created at all;
--   * SABOTAGE: reverting the fix (always credit 4100) makes the bounded-
--     product spend land on 4100 too, proving the first check discriminates
--     rather than passing vacuously.
--
-- Wrapped in BEGIN/ROLLBACK -- mints its own patient, organisation-scoped
-- fixtures, and (for the sabotage step) redefines the trigger function once;
-- the rollback undoes all of it.
-- ===========================================================================

begin;
create temporary table pcd_result(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table pcd_fixture(k text primary key, v uuid) on commit drop;

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

  select id into v_bounded_prod from public.service_products
    where access_duration_days is not null and price_kobo > 0 and is_active order by code limit 1;
  if v_bounded_prod is null then raise exception 'no active, time-bounded service_product to test against'; end if;

  -- Every currently-catalogued active product carries a non-null
  -- access_duration_days (even a one-shot document credit has an expiry
  -- window on the purchase itself) -- there is no live product left to
  -- resolve for the "genuinely unbounded" control case. Mint one instead of
  -- skipping the control: the 4100-immediate-revenue branch is still real,
  -- live code (the case a bounded-window product would hit if
  -- access_duration_days were ever cleared), so it needs its own proof
  -- rather than depending on the catalogue happening to contain an example.
  insert into public.service_products (code, name, price_kobo, access_duration_days, is_active)
  values ('pcd_test_unbounded_' || substr(gen_random_uuid()::text, 1, 8), 'PCD Test Unbounded Product', 500000, null, true)
  returning id into v_unbounded_prod;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'pcd-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pat, v_org, 'patient', 'Platform Credit Deferral Test Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  -- Minimal service_purchases rows -- their own status/amount never matters
  -- to the trigger under test, only their service_product_id linkage does.
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values
    (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 500000, 'NGN')
  returning id into v_bounded_pur;

  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values
    (gen_random_uuid(), v_org, v_pat, v_pat, v_unbounded_prod, 'pending_payment', 500000, 'NGN')
  returning id into v_unbounded_pur;

  -- Fund with real (paid) credit only, no promo -- keeps every spend
  -- 100% paid_amount_kobo, so exactly one journal posting fires per spend
  -- ('spend-paid:...'), not two.
  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 5000000, p_description := 'pcd fixture funding'
  );

  insert into pcd_fixture values
    ('org', v_org), ('pat', v_pat), ('bounded_prod', v_bounded_prod), ('unbounded_prod', v_unbounded_prod),
    ('bounded_pur', v_bounded_pur), ('unbounded_pur', v_unbounded_pur);
end $$;

-- ============ 1. Bounded-access spend defers to 2000, never straight to 4100 ==========
do $$
declare
  v_pat uuid := (select v from pcd_fixture where k = 'pat');
  v_org uuid := (select v from pcd_fixture where k = 'org');
  v_pur uuid := (select v from pcd_fixture where k = 'bounded_pur');
  v_ledger_id uuid;
  v_account text;
  v_credit bigint;
  v_schedule_count int;
  v_schedule_total bigint;
begin
  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'spend',
    p_amount_kobo := 500000, p_service_purchase_id := v_pur, p_description := 'pcd test bounded spend'
  );

  select id into v_ledger_id from public.platform_credit_ledger_entries
    where patient_id = v_pat and service_purchase_id = v_pur and entry_type = 'spend'
    order by created_at desc limit 1;
  if v_ledger_id is null then raise exception 'fixture FAIL: no ledger row was created for the bounded-product spend'; end if;

  select l.account_code, l.credit_minor into v_account, v_credit
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'platform_credit' and e.source_ref = 'spend-paid:' || v_ledger_id::text
      and l.credit_minor > 0;

  insert into pcd_result values
    ('a platform-credit spend on a bounded-access product posts its revenue side to 2000 (deferred), not 4100',
     coalesce(v_account, '<no journal line>') || ' credit=' || coalesce(v_credit::text,'0'),
     '2000 credit=500000',
     case when v_account = '2000' and v_credit = 500000 then 'PASS' else 'FAIL' end);
  if v_account is distinct from '2000' then
    raise exception 'HOLE OPEN: bounded-product platform-credit spend posted revenue to % instead of 2000 (deferred revenue)', coalesce(v_account, '<none>');
  end if;

  select count(*), coalesce(sum(total_minor),0) into v_schedule_count, v_schedule_total
    from public.revenue_recognition_schedules
    where source_kind = 'service_purchase' and source_id = v_pur;

  insert into pcd_result values
    ('the same spend creates a revenue_recognition_schedules row for the full amount',
     'count=' || v_schedule_count || ' total=' || v_schedule_total, 'count=1 total=500000',
     case when v_schedule_count = 1 and v_schedule_total = 500000 then 'PASS' else 'FAIL' end);
  if v_schedule_count <> 1 or v_schedule_total <> 500000 then
    raise exception 'HOLE OPEN: bounded-product platform-credit spend did not create a correct recognition schedule (count=%, total=%)',
      v_schedule_count, v_schedule_total;
  end if;
end $$;

-- ============ 2. CONTROL: an unbounded (one-off) spend still posts straight to 4100 ====
do $$
declare
  v_pat uuid := (select v from pcd_fixture where k = 'pat');
  v_org uuid := (select v from pcd_fixture where k = 'org');
  v_pur uuid := (select v from pcd_fixture where k = 'unbounded_pur');
  v_ledger_id uuid;
  v_account text;
  v_credit bigint;
  v_schedule_count int;
begin
  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'spend',
    p_amount_kobo := 500000, p_service_purchase_id := v_pur, p_description := 'pcd test unbounded spend'
  );

  select id into v_ledger_id from public.platform_credit_ledger_entries
    where patient_id = v_pat and service_purchase_id = v_pur and entry_type = 'spend'
    order by created_at desc limit 1;
  if v_ledger_id is null then raise exception 'fixture FAIL: no ledger row was created for the unbounded-product spend'; end if;

  select l.account_code, l.credit_minor into v_account, v_credit
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'platform_credit' and e.source_ref = 'spend-paid:' || v_ledger_id::text
      and l.credit_minor > 0;

  insert into pcd_result values
    ('CONTROL: a platform-credit spend on a genuinely one-off product still posts straight to 4100',
     coalesce(v_account, '<no journal line>') || ' credit=' || coalesce(v_credit::text,'0'),
     '4100 credit=500000',
     case when v_account = '4100' and v_credit = 500000 then 'PASS' else 'FAIL' end);
  if v_account is distinct from '4100' then
    raise exception 'REGRESSION: a genuinely one-off product''s platform-credit spend no longer posts to 4100 (got %)', coalesce(v_account, '<none>');
  end if;

  select count(*) into v_schedule_count
    from public.revenue_recognition_schedules
    where source_kind = 'service_purchase' and source_id = v_pur;

  insert into pcd_result values
    ('CONTROL: a one-off product''s spend creates no revenue_recognition_schedules row',
     v_schedule_count::text, '0', case when v_schedule_count = 0 then 'PASS' else 'FAIL' end);
  if v_schedule_count <> 0 then
    raise exception 'FAIL: a one-off product''s platform-credit spend unexpectedly created % recognition schedule row(s)', v_schedule_count;
  end if;
end $$;

-- ============ 3. SABOTAGE: reverting to unconditional 4100 reopens the hole ============
do $$
declare
  v_pat uuid := (select v from pcd_fixture where k = 'pat');
  v_org uuid := (select v from pcd_fixture where k = 'org');
  v_bounded_prod uuid := (select v from pcd_fixture where k = 'bounded_prod');
  v_pur uuid;
  v_ledger_id uuid;
  v_account text;
begin
  create or replace function private.finance_post_platform_credit_ledger_entry()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
  as $function$
  begin
    if new.entry_type = 'spend' then
      -- SABOTAGE: unconditional 4100, exactly the pre-fix bug.
      if new.paid_amount_kobo > 0 then
        perform private.finance_post_journal(
          current_date, 'NGN'::public.currency, 'platform_credit', 'spend-paid:' || new.id::text,
          'Platform credit spent (customer funds) — sabotage',
          jsonb_build_array(
            jsonb_build_object('account_code','2100','debit_minor',new.paid_amount_kobo,'credit_minor',0,'organisation_id',new.organisation_id),
            jsonb_build_object('account_code','4100','debit_minor',0,'credit_minor',new.paid_amount_kobo,'organisation_id',new.organisation_id)),
          null);
      end if;
    end if;
    return new;
  exception when others then
    return new;
  end;
  $function$;

  -- Fresh purchase against the same bounded product -- the sabotaged
  -- function no longer even looks at access_duration_days.
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
  values (gen_random_uuid(), v_org, v_pat, v_pat, v_bounded_prod, 'pending_payment', 500000, 'NGN')
  returning id into v_pur;

  perform private.platform_credit_apply(
    p_patient_id := v_pat, p_organisation_id := v_org, p_entry_type := 'spend',
    p_amount_kobo := 500000, p_service_purchase_id := v_pur, p_description := 'pcd sabotage spend'
  );

  select id into v_ledger_id from public.platform_credit_ledger_entries
    where patient_id = v_pat and service_purchase_id = v_pur and entry_type = 'spend'
    order by created_at desc limit 1;

  select l.account_code into v_account
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
    where e.source = 'platform_credit' and e.source_ref = 'spend-paid:' || v_ledger_id::text
      and l.credit_minor > 0;

  insert into pcd_result values
    ('SABOTAGE: reverting to unconditional 4100 makes a bounded-product spend land on 4100 again',
     coalesce(v_account, '<no journal line>'), '4100',
     case when v_account = '4100' then 'PASS' else 'FAIL' end);
  if v_account is distinct from '4100' then
    raise exception 'VACUOUS TEST: sabotaging the fix did not reopen the hole -- check 1 proves nothing (got %)', coalesce(v_account, '<none>');
  end if;
end $$;

select check_name, observed, expected, verdict from pcd_result order by check_name;
rollback;
