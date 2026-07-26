-- Tarragon Health — Finance: reporting RPCs (read) + a grant sweep over every
-- finance_* function. All read RPCs return empty unless private.is_finance().
-- security definer, search_path='', gated. Amounts in minor units.

-- Headline dashboard (NGN primary + a small by-currency revenue slice).
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
    'wallet_liability_ngn', (select coalesce(sum(credit_minor-debit_minor),0) from public.finance_journal_lines
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

-- Trial balance cumulative to p_as_of (per currency).
create or replace function public.finance_trial_balance(p_as_of date default current_date, p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', a.code, 'name', a.name, 'type', a.account_type,
      'debit_minor', t.d, 'credit_minor', t.c, 'balance_minor', t.d - t.c) order by a.sort_order, a.code)
    from public.finance_accounts a
    join (
      select l.account_code, sum(l.debit_minor) d, sum(l.credit_minor) c
      from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
      where l.currency = p_currency::public.currency and e.entry_date <= p_as_of
      group by l.account_code
    ) t on t.account_code = a.code
    where t.d <> 0 or t.c <> 0
  ), '[]'::jsonb);
end; $$;

-- Income statement (P&L) for a period.
create or replace function public.finance_income_statement(p_from date, p_to date, p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rev bigint; v_contra bigint; v_exp bigint;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_rev
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=p_currency::public.currency and e.entry_date between p_from and p_to;
  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_contra
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='contra_revenue' and l.currency=p_currency::public.currency and e.entry_date between p_from and p_to;
  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_exp
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='expense' and l.currency=p_currency::public.currency and e.entry_date between p_from and p_to;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'currency', p_currency,
    'revenue_minor', v_rev, 'contra_revenue_minor', v_contra, 'expense_minor', v_exp,
    'net_revenue_minor', v_rev - v_contra, 'net_income_minor', v_rev - v_contra - v_exp,
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'type', a.account_type,
        'amount_minor', case when a.account_type='revenue' then s.c - s.d else s.d - s.c end) order by a.sort_order), '[]'::jsonb)
      from public.finance_accounts a join (
        select l.account_code, sum(l.debit_minor) d, sum(l.credit_minor) c
        from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
        where l.currency=p_currency::public.currency and e.entry_date between p_from and p_to
        group by l.account_code) s on s.account_code=a.code
      where a.account_type in ('revenue','contra_revenue','expense')));
end; $$;

-- Balance sheet as of a date.
create or replace function public.finance_balance_sheet(p_as_of date default current_date, p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_assets bigint; v_liab bigint; v_equity bigint; v_ni bigint;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_assets
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='asset' and l.currency=p_currency::public.currency and e.entry_date <= p_as_of;
  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_liab
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='liability' and l.currency=p_currency::public.currency and e.entry_date <= p_as_of;
  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_equity
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='equity' and l.currency=p_currency::public.currency and e.entry_date <= p_as_of;
  -- retained earnings from P&L accounts (net income) folded into equity
  select coalesce(sum(case when a.account_type='revenue' then l.credit_minor-l.debit_minor
                           else l.debit_minor-l.credit_minor end *
                      case when a.account_type='revenue' then 1 else -1 end),0) into v_ni
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type in ('revenue','contra_revenue','expense') and l.currency=p_currency::public.currency and e.entry_date <= p_as_of;
  return jsonb_build_object(
    'as_of', p_as_of, 'currency', p_currency,
    'assets_minor', v_assets, 'liabilities_minor', v_liab,
    'equity_minor', v_equity, 'retained_earnings_minor', v_ni,
    'total_equity_minor', v_equity + v_ni,
    'balances', (v_assets = v_liab + v_equity + v_ni),
    'accounts', (
      select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'type', a.account_type,
        'amount_minor', case when a.normal_balance='debit' then s.d-s.c else s.c-s.d end) order by a.sort_order), '[]'::jsonb)
      from public.finance_accounts a join (
        select l.account_code, sum(l.debit_minor) d, sum(l.credit_minor) c
        from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
        where l.currency=p_currency::public.currency and e.entry_date <= p_as_of group by l.account_code) s on s.account_code=a.code
      where a.account_type in ('asset','liability','equity')));
end; $$;

-- GL browser.
create or replace function public.finance_ledger_entries(
  p_from date default (current_date - 90), p_to date default current_date,
  p_account text default null, p_source text default null, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'entry_no', e.entry_no, 'entry_date', e.entry_date, 'period_month', to_char(e.period_month,'YYYY-MM'),
      'currency', e.currency, 'source', e.source, 'memo', e.memo, 'is_reversed', e.is_reversed,
      'reversal_of', e.reversal_of,
      'lines', (select jsonb_agg(jsonb_build_object('account_code', account_code,
                  'name', (select name from public.finance_accounts where code=account_code),
                  'debit_minor', debit_minor, 'credit_minor', credit_minor, 'counterparty', counterparty, 'memo', memo)
                  order by line_no) from public.finance_journal_lines where entry_id=e.id))
      order by e.entry_date desc, e.entry_no desc)
    from public.finance_journal_entries e
    where e.entry_date between p_from and p_to
      and (p_source is null or e.source = p_source)
      and (p_account is null or exists (select 1 from public.finance_journal_lines l where l.entry_id=e.id and l.account_code=p_account))
    limit greatest(p_limit,1)
  ), '[]'::jsonb);
end; $$;

-- Tax period summary.
create or replace function public.finance_tax_summary(p_from date, p_to date, p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'currency', p_currency,
    'output_vat_minor', (select coalesce(sum(l.credit_minor-l.debit_minor),0) from public.finance_journal_lines l
       join public.finance_journal_entries e on e.id=l.entry_id
       where l.account_code='2200' and l.currency=p_currency::public.currency and e.entry_date between p_from and p_to),
    'input_vat_minor', (select coalesce(sum(l.debit_minor-l.credit_minor),0) from public.finance_journal_lines l
       join public.finance_journal_entries e on e.id=l.entry_id
       where l.account_code='1300' and l.currency=p_currency::public.currency and e.entry_date between p_from and p_to),
    'wht_payable_minor', (select coalesce(sum(l.credit_minor-l.debit_minor),0) from public.finance_journal_lines l
       join public.finance_journal_entries e on e.id=l.entry_id
       where l.account_code='2300' and l.currency=p_currency::public.currency and e.entry_date between p_from and p_to),
    'revenue_by_vat_treatment', (
      select coalesce(jsonb_agg(jsonb_build_object('treatment', vt, 'revenue_minor', rev) order by rev desc), '[]'::jsonb)
      from (select a.vat_treatment vt, sum(l.credit_minor-l.debit_minor) rev
            from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
            join public.finance_journal_entries e on e.id=l.entry_id
            where a.account_type='revenue' and l.currency=p_currency::public.currency and e.entry_date between p_from and p_to
            group by a.vat_treatment) x),
    'rates', (select coalesce(jsonb_agg(jsonb_build_object('type', tax_type, 'name', name, 'rate_pct', rate_pct,
                'applies_to', applies_to, 'is_active', is_active) order by tax_type, rate_pct), '[]'::jsonb)
              from public.finance_tax_rates));
end; $$;

-- Reconciliation summary: settlements + unmatched captured payments.
create or replace function public.finance_reconciliation_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'settlements', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'provider', s.provider, 'external_ref', s.external_ref, 'settlement_date', s.settlement_date,
        'currency', s.currency, 'gross_minor', s.gross_minor, 'fees_minor', s.fees_minor, 'net_minor', s.net_minor,
        'status', s.status, 'variance_minor', s.gross_minor - (s.net_minor + s.fees_minor),
        'matched_count', (select count(*) from public.finance_settlement_matches m where m.settlement_id=s.id))
        order by s.settlement_date desc), '[]'::jsonb) from public.finance_settlements s),
    'unmatched', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pt.id, 'provider', pt.provider, 'event_type', pt.event_type, 'amount_minor', pt.amount_minor,
        'currency', pt.currency, 'processed_at', pt.processed_at, 'reference', pt.provider_event_id)
        order by pt.processed_at desc), '[]'::jsonb)
      from public.payment_transactions pt
      where pt.processed_at is not null and coalesce(pt.amount_minor,0) > 0
        and pt.event_type::text in ('charge.success','checkout.session.completed','invoice.payment_succeeded')
        and not exists (select 1 from public.finance_settlement_matches m where m.payment_transaction_id = pt.id)));
end; $$;

-- Revenue-recognition summary.
create or replace function public.finance_revrec_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'total_deferred_minor', (select coalesce(sum(total_minor - recognized_minor),0) from public.revenue_recognition_schedules where status='active'),
    'total_recognized_minor', (select coalesce(sum(recognized_minor),0) from public.revenue_recognition_schedules),
    'active_schedules', (select count(*) from public.revenue_recognition_schedules where status='active'),
    'schedules', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'source_kind', source_kind, 'currency', currency, 'total_minor', total_minor,
        'recognized_minor', recognized_minor, 'remaining_minor', total_minor - recognized_minor,
        'period_start', period_start, 'period_end', period_end, 'status', status)
        order by period_end desc) , '[]'::jsonb) from public.revenue_recognition_schedules));
end; $$;

-- Config list RPCs for the settings pages.
create or replace function public.finance_accounts_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'type', account_type,
    'normal_balance', normal_balance, 'vat_treatment', vat_treatment, 'is_active', is_active,
    'sort_order', sort_order, 'description', description) order by sort_order, code)
    from public.finance_accounts), '[]'::jsonb);
end; $$;

create or replace function public.finance_periods_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('period_month', to_char(period_month,'YYYY-MM'),
    'status', status, 'closed_at', closed_at) order by period_month desc) from public.finance_periods), '[]'::jsonb);
end; $$;

create or replace function public.finance_tax_rates_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'jurisdiction', jurisdiction, 'tax_type', tax_type,
    'name', name, 'rate_pct', rate_pct, 'applies_to', applies_to, 'effective_from', effective_from,
    'is_active', is_active, 'notes', notes) order by tax_type, rate_pct) from public.finance_tax_rates), '[]'::jsonb);
end; $$;

-- Manual trigger for revenue recognition (gated).
create or replace function public.finance_run_revenue_recognition()
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;
  return private.finance_recognize_revenue(current_date);
end; $$;

-- ---------------------------------------------------------------------------
-- Grant sweep: every public.finance_* function is authenticated-only.
-- Explicitly revoke from anon (revoking from public does NOT strip the default
-- anon EXECUTE grant on this project — see prior migrations' anon-revoke fixes).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'finance\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
