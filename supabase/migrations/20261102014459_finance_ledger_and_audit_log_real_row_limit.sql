-- finance_ledger_entries and finance_audit_log: make p_limit real, add p_offset.
--
-- Both functions wrote `select jsonb_agg(...) from ... limit greatest(p_limit,1)`.
-- A LIMIT applies to the rows a query returns, and an aggregate returns one row,
-- so the limit never cut anything: every entry in the date range came back, and
-- the "200" default and the printed audit pack's "5000" were not limits at all
-- (checked live: `select jsonb_agg(x) from generate_series(1,10) x limit 3`
-- returns all 10). Two things followed. The page and pack warnings that say "the
-- newest N are shown, there may be more" (hitLimit, PrintTruncation) fired on
-- any range of N or more entries although nothing was left out, and the payload
-- grew with the ledger without bound. Live today: 16 journal entries and 3
-- finance audit rows, so no figure was ever wrong in practice.
--
-- finance_approval_history was written correctly (the limit sits in the
-- subquery) and is not touched.
--
-- The limit now sits in a subquery, ordered newest first with the row id as the
-- last tie-break so paging is stable, and a p_offset lets the audit pack read
-- the whole ledger a page at a time instead of choosing a cap. Adding a
-- parameter changes the signature, so each old function is dropped and the new
-- one is the only one: nothing is left to make a bare call ambiguous. No other
-- function calls either one (checked in pg_proc). Output shape is unchanged.

drop function public.finance_ledger_entries(date, date, text, text, int);
drop function public.finance_audit_log(timestamptz, timestamptz, text, int);

create function public.finance_ledger_entries(
  p_from date default (current_date - 90), p_to date default current_date,
  p_account text default null, p_source text default null,
  p_limit int default 200, p_offset int default 0)
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
      order by e.entry_date desc, e.entry_no desc, e.id desc)
    from (
      select x.* from public.finance_journal_entries x
      where x.entry_date between p_from and p_to
        and (p_source is null or x.source = p_source)
        and (p_account is null or exists (select 1 from public.finance_journal_lines l where l.entry_id=x.id and l.account_code=p_account))
      order by x.entry_date desc, x.entry_no desc, x.id desc
      limit greatest(p_limit,1) offset greatest(p_offset,0)
    ) e
  ), '[]'::jsonb);
end; $$;

create function public.finance_audit_log(
  p_from timestamptz default (now() - interval '30 days'), p_to timestamptz default now(),
  p_action text default null, p_limit int default 200, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', al.id, 'created_at', al.created_at, 'actor_name', p.full_name, 'action', al.action,
      'entity_type', al.entity_type, 'entity_id', al.entity_id, 'event', al.event)
      order by al.created_at desc, al.id desc)
    from (
      select a.* from public.audit_log a
      where a.action like 'finance.%'
        and a.created_at between p_from and p_to
        and (p_action is null or a.action = p_action)
      order by a.created_at desc, a.id desc
      limit greatest(p_limit,1) offset greatest(p_offset,0)
    ) al
    left join public.profiles p on p.id = al.actor_id
  ), '[]'::jsonb);
end; $$;

revoke execute on function public.finance_ledger_entries(date, date, text, text, int, int) from public, anon;
grant execute on function public.finance_ledger_entries(date, date, text, text, int, int) to authenticated;
revoke execute on function public.finance_audit_log(timestamptz, timestamptz, text, int, int) from public, anon;
grant execute on function public.finance_audit_log(timestamptz, timestamptz, text, int, int) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('finance_ledger_entries','finance_audit_log')) <> 2 then
    raise exception 'expected exactly one finance_ledger_entries and one finance_audit_log';
  end if;
  if has_function_privilege('anon', 'public.finance_ledger_entries(date, date, text, text, int, int)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_audit_log(timestamptz, timestamptz, text, int, int)', 'EXECUTE') then
    raise exception 'anon can execute a finance reporting function';
  end if;
  if not has_function_privilege('authenticated', 'public.finance_ledger_entries(date, date, text, text, int, int)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.finance_audit_log(timestamptz, timestamptz, text, int, int)', 'EXECUTE') then
    raise exception 'authenticated lost execute on a finance reporting function';
  end if;
end $$;
