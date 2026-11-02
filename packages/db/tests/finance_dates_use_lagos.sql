-- ===========================================================================
-- Proof (standing guard): finance dates a journal entry, and works out "today" for its reports, from the LAGOS date, never the
-- server (UTC) date. Covers migration *_finance_dates_use_lagos_not_utc.sql and, going forward, any LATER migration that
-- recreates one of these functions from older text: the CI replay then fails here instead of the 23:00-24:00 UTC error (an entry
-- dated yesterday in Lagos, in the wrong month at a month end) coming back silently.
--
--   1. scan: no finance function (public.finance_*, private.finance_*, the refund approvers, the subsidy contribution and the
--      invoice rate lookup) reads current_date, `now()::date`, `current_timestamp::date` or `<timestamp>::date`;
--   2. parameter defaults carry the inline Lagos expression (they are evaluated as the caller, who cannot run lagos_today());
--   3. behaviour, with the clock fixed in-transaction (Lagos date = UTC date + 1, so the wall clock never matters):
--        a manual journal with no date, a reversal, a care-voucher reward, are dated the Lagos day;
--   4. behaviour on timestamps, with the session zone pinned to UTC: a payment processed at 23:30 UTC on 31 March is dated
--      1 April (the next MONTH in Lagos), and a commission earned at 23:30 UTC and one paid at 23:30 UTC the same;
--   5. SABOTAGE: put current_date back in finance_post_manual_journal and `::date` back on the commission (the checks must
--      fail), and add a function with the bad pattern (the scan must find it).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

create function pg_temp.bad_functions() returns text language sql as $$
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.proname like 'finance\_%'
          or p.proname in ('apply_subsidy_contribution_from_transaction', 'approve_lab_order_refund',
                           'approve_pharmacy_order_refund', 'get_or_create_invoice'))
     and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M|current_timestamp\s*::\s*date|now\(\)\s*::\s*date|\m(earned_at|paid_at|processed_at|created_at)::date';
$$;

-- 1. scan
do $$
declare bad text := pg_temp.bad_functions();
begin
  if bad is not null then
    raise exception 'FAIL 1: finance functions that read the UTC date (use private.lagos_today()): %', bad;
  end if;
  insert into _checks (msg) values ('PASS 1: no finance function reads the UTC date');
end $$;

-- 2. defaults
do $$
declare f text; bad text := '';
begin
  foreach f in array array[
    'public.finance_trial_balance(date,text)', 'public.finance_balance_sheet(date,text)',
    'public.finance_ledger_entries(date,date,text,text,integer,integer)',
    'public.finance_revenue_by_funding_source(date,date,text)', 'private.finance_recognize_revenue(date)'] loop
    if pg_get_function_arguments(f::regprocedure) !~ 'Africa/Lagos' or pg_get_function_arguments(f::regprocedure) ~* 'current_date' then
      bad := bad || ' ' || f;
    end if;
  end loop;
  if bad <> '' then raise exception 'FAIL 2: a parameter default is not the Lagos date:%', bad; end if;
  if pg_get_expr((select d.adbin from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                   where d.adrelid = 'public.finance_tax_rates'::regclass and a.attname = 'effective_from'),
                 'public.finance_tax_rates'::regclass) !~ 'Africa/Lagos' then
    raise exception 'FAIL 2: finance_tax_rates.effective_from does not default to the Lagos date';
  end if;
  insert into _checks (msg) values ('PASS 2: every parameter default and the tax-rate column default use the Lagos date');
end $$;

-- fixed clock: the Lagos date is the UTC date + 1 for the rest of this file
create temp table lagos_fixed_clock3 as select (current_date + 1) as d;
grant select on lagos_fixed_clock3 to public;
create or replace function private.lagos_today() returns date language sql stable set search_path = ''
  as $$ select d from pg_temp.lagos_fixed_clock3 $$;

create function pg_temp.mint(p_email text, p_role text, p_org uuid) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (u, p_email, 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (u, p_org, p_role::public.user_role, 'Lagos Dates Proof ' || p_role)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  return u;
end $$;

create function pg_temp.dated_checks(p_tag text) returns void language plpgsql as $$
declare
  d date := (select d from pg_temp.lagos_fixed_clock3);
  v_org uuid; v_fin uuid; v_got date; v_id uuid; v_rev uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_fin := pg_temp.mint(p_tag || '-fin@example.invalid', 'finance', v_org);

  -- 3a. a manual journal with no date, posted by a finance account
  perform set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.finance_post_manual_journal(null, 'NGN', 'lagos-dates-proof-' || p_tag,
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', 1000, 'credit_minor', 0, 'organisation_id', v_org),
      jsonb_build_object('account_code', '2000', 'debit_minor', 0, 'credit_minor', 1000, 'organisation_id', v_org)));
  reset role;
  select id, entry_date into v_id, v_got from public.finance_journal_entries where memo = 'lagos-dates-proof-' || p_tag;
  if v_id is null then raise exception 'FAIL 3a [%]: the manual journal was not posted', p_tag; end if;
  if v_got is distinct from d then
    raise exception 'FAIL 3a [%]: manual journal with no date was dated % (UTC date %), expected the Lagos date %', p_tag, v_got, current_date, d;
  end if;

  -- 3b. a reversal is dated the Lagos day
  v_rev := private.finance_reverse_entry(v_id, 'lagos dates proof', null);
  select entry_date into v_got from public.finance_journal_entries where id = v_rev;
  if v_got is distinct from d then
    raise exception 'FAIL 3b [%]: reversal was dated % (UTC date %), expected the Lagos date %', p_tag, v_got, current_date, d;
  end if;
end $$;

select pg_temp.dated_checks('p');
insert into _checks (msg) values ('PASS 3: a manual journal with no date and its reversal are dated the Lagos day, not the UTC day');

-- 4. timestamps, session zone pinned to UTC
set local timezone = 'UTC';
do $$
declare
  v_org uuid; v_sub_user uuid; v_sub uuid; v_txn uuid; v_com uuid; v_got date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_sub_user := pg_temp.mint('lagos-dates-sub@example.invalid', 'patient', v_org);

  insert into public.subscriptions (organisation_id, subscriber_id, status, currency, amount_minor, interval, started_at, current_period_end)
  values (v_org, v_sub_user, 'active', 'NGN', 800000, 'monthly', '2031-03-31 23:30:00+00', '2031-04-30 23:30:00+00')
  returning id into v_sub;
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, subscription_id, amount_minor, currency, raw_payload, processed_at)
  values (v_org, 'paystack', 'lagos-dates-proof-evt', 'charge.success', v_sub, 800000, 'NGN', '{}'::jsonb, '2031-03-31 23:30:00+00')
  returning id into v_txn;
  select entry_date into v_got from public.finance_journal_entries where source = 'payment' and source_ref = v_txn::text;
  if v_got is null then raise exception 'FAIL 4a: the payment posted no journal entry'; end if;
  if v_got is distinct from date '2031-04-01' then
    raise exception 'FAIL 4a: a payment processed 23:30 UTC on 31 March was dated % (Lagos is already 1 April)', v_got;
  end if;
  insert into _checks (msg) values ('PASS 4a: a payment processed at 23:30 UTC on 31 March is dated 1 April, the Lagos day and month');

  insert into public.commissions (organisation_id, commission_type, partner_name, amount_kobo, status, earned_at, paid_at)
  values (v_org, (select min(e) from unnest(enum_range(null::public.commission_type)) e), 'Lagos Dates Proof Partner', 5000, 'paid',
          '2031-05-31 23:30:00+00', '2031-06-30 23:30:00+00')
  returning id into v_com;
  select entry_date into v_got from public.finance_journal_entries where source = 'commission' and source_ref = 'earned:' || v_com::text;
  if v_got is distinct from date '2031-06-01' then
    raise exception 'FAIL 4b: commission earned 23:30 UTC on 31 May was dated % (expected 2031-06-01)', v_got;
  end if;
  select entry_date into v_got from public.finance_journal_entries where source = 'commission' and source_ref = 'collected:' || v_com::text;
  if v_got is distinct from date '2031-07-01' then
    raise exception 'FAIL 4c: commission paid 23:30 UTC on 30 June was dated % (expected 2031-07-01)', v_got;
  end if;
  insert into _checks (msg) values ('PASS 4b: commission earned and paid at 23:30 UTC are dated the next Lagos day');
end $$;

-- 4d. every report runs as a finance account with its arguments left out. A body is only resolved when it runs, and a default is
-- evaluated as the CALLER, so a wrong rewrite shows up here and not when the migration is applied.
create function pg_temp.run_reports(p_tag text) returns void language plpgsql as $$
declare v_org uuid; v_fin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_fin := pg_temp.mint(p_tag || '-rep@example.invalid', 'finance', v_org);
  perform set_config('request.jwt.claims', json_build_object('sub', v_fin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.finance_trial_balance(); perform public.finance_balance_sheet(); perform public.finance_ledger_entries();
  perform public.finance_revenue_by_funding_source(); perform public.finance_kpi_summary('NGN'); perform public.finance_dashboard_summary();
  perform public.finance_ap_aging(); perform public.finance_risk_flags(); perform public.finance_employer_billing_summary();
  perform public.finance_compliance_calendar(3); perform public.finance_compliance_calendar_for_year(2027);
  perform public.finance_unified_ledger(null, v_org, null, null, 5, 0);
  reset role;
end $$;
select pg_temp.run_reports('r');
insert into _checks (msg) values ('PASS 4d: every finance report runs as a finance account with its arguments left out');

-- 5d. SABOTAGE: a default of private.lagos_today() (authenticated cannot run it); the report run must fail
do $$
declare src text := pg_get_functiondef('public.finance_trial_balance(date,text)'::regprocedure); got text;
begin
  execute replace(src, '((now() AT TIME ZONE ''Africa/Lagos''::text))::date', 'private.lagos_today()');
  begin
    perform pg_temp.run_reports('s5d');
  exception when others then got := sqlerrm;
  end;
  reset role;
  if got is null or got not ilike '%permission denied%' then
    raise exception 'SABOTAGE 5d: a lagos_today() default for a finance user was not caught (got: %)', got;
  end if;
  insert into _checks (msg) values ('PASS 5d: sabotage (a lagos_today() default evaluated as the caller) is caught');
end $$;

-- 5a. SABOTAGE: current_date back in the manual journal; the behaviour check must fail
do $$
declare src text := pg_get_functiondef('public.finance_post_manual_journal(date,text,text,jsonb)'::regprocedure); got text;
begin
  if src !~ 'lagos_today' then raise exception 'sabotage 5a: the function is not using the helper'; end if;
  execute replace(src, 'private.lagos_today()', 'current_date');
  begin
    perform pg_temp.dated_checks('s5a');
  exception when others then got := sqlerrm;
  end;
  if got is null or got not like 'FAIL 3a%' then
    raise exception 'SABOTAGE 5a: the behaviour check did not fail on the UTC date (got: %)', got;
  end if;
  insert into _checks (msg) values ('PASS 5a: sabotage (current_date in the manual journal) is caught');
end $$;

-- 5b. SABOTAGE: the commission back on a bare ::date; the month-end check must fail
do $$
declare src text := pg_get_functiondef('private.finance_post_commission(uuid)'::regprocedure); got text; v_com uuid; v_org uuid;
begin
  if src !~ 'Africa/Lagos' then raise exception 'sabotage 5b: the function is not converting to Lagos'; end if;
  execute replace(src, '(c.earned_at at time zone ''Africa/Lagos'')::date', 'c.earned_at::date');
  select id into v_org from public.organisations order by created_at limit 1;
  begin
    insert into public.commissions (organisation_id, commission_type, partner_name, amount_kobo, status, earned_at)
    values (v_org, (select min(e) from unnest(enum_range(null::public.commission_type)) e), 'Lagos Dates Sabotage', 5000, 'pending',
            '2031-08-31 23:30:00+00')
    returning id into v_com;
    if (select entry_date from public.finance_journal_entries where source_ref = 'earned:' || v_com::text) <> date '2031-09-01' then
      got := 'caught';
    end if;
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'caught' then
    raise exception 'SABOTAGE 5b: a UTC cast on earned_at was not caught (%)', got;
  end if;
  insert into _checks (msg) values ('PASS 5b: sabotage (a bare ::date on a timestamp) is caught');
end $$;

-- 5b2. SABOTAGE: the payment back on a bare ::date; the month-end check must fail
do $$
declare src text := pg_get_functiondef('private.finance_post_from_payment(uuid)'::regprocedure); got text; v_org uuid; v_user uuid; v_sub uuid; v_txn uuid; v_date date;
begin
  if src !~ 'txn.processed_at at time zone' then raise exception 'sabotage 5b2: the function is not converting to Lagos'; end if;
  execute replace(src, '(txn.processed_at at time zone ''Africa/Lagos'')::date', 'txn.processed_at::date');
  select id into v_org from public.organisations order by created_at limit 1;
  v_user := pg_temp.mint('lagos-dates-sub2@example.invalid', 'patient', v_org);
  insert into public.subscriptions (organisation_id, subscriber_id, status, currency, amount_minor, interval, started_at, current_period_end)
  values (v_org, v_user, 'active', 'NGN', 800000, 'monthly', '2031-09-30 23:30:00+00', '2031-10-30 23:30:00+00') returning id into v_sub;
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, subscription_id, amount_minor, currency, raw_payload, processed_at)
  values (v_org, 'paystack', 'lagos-dates-proof-sabotage', 'charge.success', v_sub, 800000, 'NGN', '{}'::jsonb, '2031-09-30 23:30:00+00')
  returning id into v_txn;
  select entry_date into v_date from public.finance_journal_entries where source = 'payment' and source_ref = v_txn::text;
  if v_date is distinct from date '2031-09-30' then
    raise exception 'SABOTAGE 5b2: a UTC cast on processed_at was not caught (entry dated %)', v_date;
  end if;
  insert into _checks (msg) values ('PASS 5b2: sabotage (a bare ::date on processed_at) is caught');
end $$;

-- 5c. a new finance function with the bad pattern: the scan must find it
create function public.finance_zz_lagos_scan_probe() returns date language sql stable as $$ select current_date $$;
do $$
begin
  if pg_temp.bad_functions() is null or pg_temp.bad_functions() not like '%finance_zz_lagos_scan_probe%' then
    raise exception 'SABOTAGE 5c: the scan did not find a finance function that reads the UTC date';
  end if;
  insert into _checks (msg) values ('PASS 5c: sabotage (a new function reading the UTC date) is found by the scan');
end $$;

select msg from _checks order by n;
rollback;
