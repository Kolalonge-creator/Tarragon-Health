-- Tarragon Health — cosmetic naming fix, no functional change.
--
-- public.finance_dashboard_summary() has returned its account-2100 balance
-- under the JSON key 'wallet_liability_ngn' since it was written
-- (20260725230915_finance_reporting_rpcs_and_grants.sql), predating the
-- 2026-07-31 Health Wallet retirement. The underlying GL account itself was
-- correctly renamed to "Customer prepayments — care vouchers" at that time
-- (20260731215910_finance_care_voucher_accounting.sql) and the finance
-- dashboard UI label already says "Customer prepayments" — only this RPC's
-- JSON key was never updated to match. Same account_code='2100' query,
-- renamed key only.
create or replace function public.finance_dashboard_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_year_start date := date_trunc('year', now())::date;
        v_month_start date := date_trunc('month', now())::date;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'cash_ngn', (select coalesce(sum(debit_minor-credit_minor),0) from public.finance_journal_lines
                 where account_code in ('1000','1010','1020') and currency='NGN'),
    'deferred_revenue_ngn', (select coalesce(sum(credit_minor-debit_minor),0) from public.finance_journal_lines
                 where account_code='2000' and currency='NGN'),
    'care_voucher_liability_ngn', (select coalesce(sum(credit_minor-debit_minor),0) from public.finance_journal_lines
                 where account_code='2100' and currency='NGN'),
    'receivables_ngn', (select coalesce(sum(debit_minor-credit_minor),0) from public.finance_journal_lines
                 where account_code='1200' and currency='NGN'),
    'vat_payable_ngn', (select coalesce(sum(credit_minor-debit_minor),0) from public.finance_journal_lines
                 where account_code='2200' and currency='NGN'),
    'wht_payable_ngn', (select coalesce(sum(credit_minor-debit_minor),0) from public.finance_journal_lines
                 where account_code='2300' and currency='NGN'),
    'revenue_ytd_ngn', (select coalesce(sum(l.credit_minor-l.debit_minor),0)
                 from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
                 join public.finance_journal_entries e on e.id=l.entry_id
                 where a.account_type='revenue' and l.currency='NGN' and e.entry_date >= v_year_start),
    'revenue_mtd_ngn', (select coalesce(sum(l.credit_minor-l.debit_minor),0)
                 from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
                 join public.finance_journal_entries e on e.id=l.entry_id
                 where a.account_type='revenue' and l.currency='NGN' and e.entry_date >= v_month_start),
    'expenses_ytd_ngn', (select coalesce(sum(l.debit_minor-l.credit_minor),0)
                 from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
                 join public.finance_journal_entries e on e.id=l.entry_id
                 where a.account_type='expense' and l.currency='NGN' and e.entry_date >= v_year_start),
    'unreconciled', (
      select jsonb_build_object(
        'count', count(*),
        'by_currency', coalesce(jsonb_agg(distinct jsonb_build_object('currency', currency, 'total_minor', tot)) filter (where currency is not null), '[]'::jsonb))
      from (
        select pt.currency::text currency, sum(pt.amount_minor) over (partition by pt.currency) tot
        from public.payment_transactions pt
        where pt.processed_at is not null and coalesce(pt.amount_minor,0) > 0
          and pt.event_type::text in ('charge.success','checkout.session.completed','invoice.payment_succeeded')
          and not exists (select 1 from public.finance_settlement_matches m where m.payment_transaction_id = pt.id)
      ) u),
    'revenue_by_currency', (
      select coalesce(jsonb_agg(jsonb_build_object('currency', cur, 'recognised_minor', rev) order by rev desc), '[]'::jsonb)
      from (select l.currency::text cur, sum(l.credit_minor-l.debit_minor) rev
            from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
            where a.account_type='revenue' group by l.currency having sum(l.credit_minor-l.debit_minor) <> 0) x),
    'open_period', (select to_char(max(period_month),'YYYY-MM') from public.finance_periods where status='open'),
    'entries_count', (select count(*) from public.finance_journal_entries)
  );
end; $$;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'finance_dashboard_summary' and pronamespace = 'public'::regnamespace
      and pg_get_functiondef(oid) like '%care_voucher_liability_ngn%'
  ) then
    raise exception 'FAIL: finance_dashboard_summary was not updated to return care_voucher_liability_ngn';
  end if;
  if exists (
    select 1 from pg_proc where proname = 'finance_dashboard_summary' and pronamespace = 'public'::regnamespace
      and pg_get_functiondef(oid) like '%wallet_liability_ngn%'
  ) then
    raise exception 'FAIL: finance_dashboard_summary still references the old wallet_liability_ngn key';
  end if;
  raise notice 'PASS: finance_dashboard_summary returns care_voucher_liability_ngn only';
end $$;
