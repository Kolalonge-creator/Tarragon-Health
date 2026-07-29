-- Tarragon Health — Finance: cash flow statement (indirect method).
--
-- The third core financial statement, alongside the existing income statement
-- and balance sheet. Built from the same ledger — no new source of truth.
-- Every non-cash balance-sheet account is tagged with a cash_flow_category
-- ('operating'/'investing'/'financing'/'none'); the two real bank accounts
-- (1000/1010) are 'none' — they ARE the cash line, not an adjustment to it.
-- Nothing has been posted yet to an investing or financing account (no fixed-
-- asset purchases or capital raises are in the ledger), so those sections
-- read zero honestly rather than being invented.

alter table public.finance_accounts
  add column if not exists cash_flow_category text
    check (cash_flow_category in ('operating','investing','financing','none'))
    default 'operating';

update public.finance_accounts set cash_flow_category = 'none' where code in ('1000','1010');
update public.finance_accounts set cash_flow_category = 'financing' where code in ('3000','3100');
update public.finance_accounts set cash_flow_category = 'none' where account_type in ('revenue','contra_revenue','expense');
-- everything else (1020, 1200, 1300, 2000-2400, and the AP/capitation accounts
-- added by later migrations) keeps the 'operating' default — real working-
-- capital movement, not the cash balance itself.

create or replace function public.finance_cash_flow_statement(p_from date, p_to date, p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_prior date := p_from - 1;
  v_cur public.currency := coalesce(p_currency,'NGN')::public.currency;
  v_net_income bigint;
  v_cash_begin bigint;
  v_cash_end bigint;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;

  select coalesce(sum(case when a.account_type='revenue' then l.credit_minor-l.debit_minor
                           when a.account_type='contra_revenue' then l.debit_minor-l.credit_minor
                           when a.account_type='expense' then -(l.debit_minor-l.credit_minor)
                           else 0 end),0)
    into v_net_income
  from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
  join public.finance_journal_entries e on e.id=l.entry_id
  where a.account_type in ('revenue','contra_revenue','expense') and l.currency=v_cur
    and e.entry_date between p_from and p_to;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_cash_begin
  from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
  where l.account_code in ('1000','1010') and l.currency=v_cur and e.entry_date <= v_prior;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_cash_end
  from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
  where l.account_code in ('1000','1010') and l.currency=v_cur and e.entry_date <= p_to;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'currency', p_currency,
    'net_income_minor', v_net_income,
    'cash_beginning_minor', v_cash_begin,
    'cash_ending_minor', v_cash_end,
    'net_change_in_cash_minor', v_cash_end - v_cash_begin,
    'operating', (
      select jsonb_build_object(
        'adjustments', coalesce(jsonb_agg(jsonb_build_object(
            'code', code, 'name', name, 'delta_minor', delta) order by code)
          filter (where delta <> 0), '[]'::jsonb),
        'net_cash_from_operating_minor', v_net_income + coalesce(sum(delta),0))
      from (
        select a.code, a.name,
          case when a.account_type='asset' then -1 else 1 end *
          (coalesce((select sum(l.debit_minor-l.credit_minor) from public.finance_journal_lines l
             join public.finance_journal_entries e on e.id=l.entry_id
             where l.account_code=a.code and l.currency=v_cur and e.entry_date<=p_to),0)
           - coalesce((select sum(l.debit_minor-l.credit_minor) from public.finance_journal_lines l
             join public.finance_journal_entries e on e.id=l.entry_id
             where l.account_code=a.code and l.currency=v_cur and e.entry_date<=v_prior),0)) delta
        from public.finance_accounts a
        where a.cash_flow_category = 'operating' and a.account_type in ('asset','liability')
      ) x),
    'investing', (
      select jsonb_build_object('adjustments', coalesce(jsonb_agg(jsonb_build_object(
            'code', code, 'name', name, 'delta_minor', delta) order by code) filter (where delta <> 0), '[]'::jsonb),
          'net_cash_from_investing_minor', coalesce(sum(delta),0))
      from (
        select a.code, a.name,
          coalesce((select sum(l.debit_minor-l.credit_minor) from public.finance_journal_lines l
             join public.finance_journal_entries e on e.id=l.entry_id
             where l.account_code=a.code and l.currency=v_cur and e.entry_date<=v_prior),0)
          - coalesce((select sum(l.debit_minor-l.credit_minor) from public.finance_journal_lines l
             join public.finance_journal_entries e on e.id=l.entry_id
             where l.account_code=a.code and l.currency=v_cur and e.entry_date<=p_to),0) delta
        from public.finance_accounts a where a.cash_flow_category = 'investing'
      ) x),
    'financing', (
      select jsonb_build_object('adjustments', coalesce(jsonb_agg(jsonb_build_object(
            'code', code, 'name', name, 'delta_minor', delta) order by code) filter (where delta <> 0), '[]'::jsonb),
          'net_cash_from_financing_minor', coalesce(sum(delta),0))
      from (
        select a.code, a.name,
          coalesce((select sum(l.credit_minor-l.debit_minor) from public.finance_journal_lines l
             join public.finance_journal_entries e on e.id=l.entry_id
             where l.account_code=a.code and l.currency=v_cur and e.entry_date<=p_to),0)
          - coalesce((select sum(l.credit_minor-l.debit_minor) from public.finance_journal_lines l
             join public.finance_journal_entries e on e.id=l.entry_id
             where l.account_code=a.code and l.currency=v_cur and e.entry_date<=v_prior),0) delta
        from public.finance_accounts a where a.cash_flow_category = 'financing'
      ) x)
  );
end; $$;

revoke execute on function public.finance_cash_flow_statement(date, date, text) from public, anon;
grant execute on function public.finance_cash_flow_statement(date, date, text) to authenticated;
