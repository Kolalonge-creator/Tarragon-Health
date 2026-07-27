-- Surface cost_center_code in the GL browser's per-line output (it was added to
-- finance_journal_lines in the cost-centers migration, but the read RPC predates
-- that column and needs updating so the UI can actually show it).
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
                  'debit_minor', debit_minor, 'credit_minor', credit_minor, 'counterparty', counterparty,
                  'memo', memo, 'cost_center_code', cost_center_code)
                  order by line_no) from public.finance_journal_lines where entry_id=e.id))
      order by e.entry_date desc, e.entry_no desc)
    from public.finance_journal_entries e
    where e.entry_date between p_from and p_to
      and (p_source is null or e.source = p_source)
      and (p_account is null or exists (select 1 from public.finance_journal_lines l where l.entry_id=e.id and l.account_code=p_account))
    limit greatest(p_limit,1)
  ), '[]'::jsonb);
end; $$;

revoke execute on function public.finance_ledger_entries(date, date, text, text, int) from public, anon;
grant execute on function public.finance_ledger_entries(date, date, text, text, int) to authenticated;
