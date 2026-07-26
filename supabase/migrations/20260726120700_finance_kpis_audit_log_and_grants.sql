-- Tarragon Health — Finance: KPI strip, audit log viewer, risk flags, and a
-- final grant sweep covering every finance_* function this whole pass added.

-- ---------------------------------------------------------------------------
-- KPI summary — the ratios a CFO dashboard actually shows: margin, growth,
-- days-sales-outstanding on commission receivable, and a cash-runway estimate.
-- Direct costs = payment-processing fees (5000), the closest thing this
-- ledger has to a cost-of-revenue line — everything else in 'expense' is
-- opex, so gross margin here is deliberately narrow (revenue less processing
-- fees), not a full COGS calculation this business doesn't have.
-- ---------------------------------------------------------------------------
create or replace function public.finance_kpi_summary(p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cur public.currency := coalesce(p_currency,'NGN')::public.currency;
  v_today date := current_date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_last_month_start date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_last_month_end date := v_month_start - 1;
  v_year_ago_month_start date := (date_trunc('month', v_today) - interval '1 year')::date;
  v_year_ago_month_end date := (v_year_ago_month_start + interval '1 month' - interval '1 day')::date;
  v_revenue_mtd bigint;
  v_revenue_last_month bigint;
  v_revenue_year_ago_month bigint;
  v_expense_mtd bigint;
  v_direct_costs_mtd bigint;
  v_cash bigint;
  v_receivable bigint;
  v_revenue_90d bigint;
  v_expense_3mo_avg numeric;
begin
  if not private.is_finance() then return '{}'::jsonb; end if;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_mtd
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date>=v_month_start and e.entry_date<=v_today;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_last_month
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date>=v_last_month_start and e.entry_date<=v_last_month_end;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_year_ago_month
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date>=v_year_ago_month_start and e.entry_date<=v_year_ago_month_end;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_expense_mtd
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='expense' and l.currency=v_cur and e.entry_date>=v_month_start and e.entry_date<=v_today;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_direct_costs_mtd
    from public.finance_journal_lines l join public.finance_journal_entries e on e.id=l.entry_id
    where l.account_code='5000' and l.currency=v_cur and e.entry_date>=v_month_start and e.entry_date<=v_today;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_cash
    from public.finance_journal_lines l where l.account_code in ('1000','1010') and l.currency=v_cur;

  select coalesce(sum(l.debit_minor-l.credit_minor),0) into v_receivable
    from public.finance_journal_lines l where l.account_code='1200' and l.currency=v_cur;

  select coalesce(sum(l.credit_minor-l.debit_minor),0) into v_revenue_90d
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='revenue' and l.currency=v_cur and e.entry_date >= v_today - 90;

  select coalesce(sum(l.debit_minor-l.credit_minor),0)/3.0 into v_expense_3mo_avg
    from public.finance_journal_lines l join public.finance_accounts a on a.code=l.account_code
    join public.finance_journal_entries e on e.id=l.entry_id
    where a.account_type='expense' and l.currency=v_cur and e.entry_date >= v_today - 90;

  return jsonb_build_object(
    'currency', p_currency,
    'revenue_mtd_minor', v_revenue_mtd,
    'gross_profit_mtd_minor', v_revenue_mtd - v_direct_costs_mtd,
    'gross_margin_pct', case when v_revenue_mtd > 0 then round(((v_revenue_mtd - v_direct_costs_mtd)::numeric / v_revenue_mtd) * 100, 1) else null end,
    'net_income_mtd_minor', v_revenue_mtd - v_expense_mtd,
    'net_margin_pct', case when v_revenue_mtd > 0 then round(((v_revenue_mtd - v_expense_mtd)::numeric / v_revenue_mtd) * 100, 1) else null end,
    'mom_revenue_growth_pct', case when v_revenue_last_month > 0 then round(((v_revenue_mtd - v_revenue_last_month)::numeric / v_revenue_last_month) * 100, 1) else null end,
    'yoy_revenue_growth_pct', case when v_revenue_year_ago_month > 0 then round(((v_revenue_mtd - v_revenue_year_ago_month)::numeric / v_revenue_year_ago_month) * 100, 1) else null end,
    'dso_days', case when v_revenue_90d > 0 then round((v_receivable::numeric / (v_revenue_90d::numeric/90)), 1) else null end,
    'cash_runway_months', case when v_expense_3mo_avg > 0 then round((v_cash::numeric / v_expense_3mo_avg), 1) else null end,
    'cash_minor', v_cash,
    'receivable_minor', v_receivable
  );
end; $$;

-- ---------------------------------------------------------------------------
-- Risk / anomaly flags — surfaced on the Overview, so bookkeeping health
-- issues don't hide until someone thinks to check a specific tab.
-- ---------------------------------------------------------------------------
create or replace function public.finance_risk_flags()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'pending_approvals_count', (select count(*) from public.finance_approval_requests where status='pending'),
    'aged_unreconciled_count', (
      select count(*) from public.payment_transactions pt
      where pt.processed_at is not null and coalesce(pt.amount_minor,0) > 0
        and pt.event_type::text in ('charge.success','checkout.session.completed','invoice.payment_succeeded')
        and pt.processed_at < now() - interval '7 days'
        and not exists (select 1 from public.finance_settlement_matches m where m.payment_transaction_id = pt.id)),
    'ap_due_soon_count', (select count(*) from public.finance_bills where status='approved' and due_date is not null and due_date <= current_date + 7),
    'ap_overdue_count', (select count(*) from public.finance_bills where status='approved' and due_date is not null and due_date < current_date),
    'compliance_overdue_count', (
      select count(*) from jsonb_array_elements(public.finance_compliance_calendar(1)) x
      where x->>'status' = 'overdue')
  );
end; $$;

-- ---------------------------------------------------------------------------
-- Audit log viewer — the human-triggered finance actions logged by this
-- pass's private.log_audit() calls, read straight from the platform's
-- immutable public.audit_log (same table the super-admin RBAC console uses).
-- ---------------------------------------------------------------------------
create or replace function public.finance_audit_log(
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now(),
  p_action text default null,
  p_limit int default 200
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', al.id, 'created_at', al.created_at, 'actor_name', p.full_name, 'action', al.action,
      'entity_type', al.entity_type, 'entity_id', al.entity_id, 'event', al.event)
      order by al.created_at desc)
    from public.audit_log al
    left join public.profiles p on p.id = al.actor_id
    where al.action like 'finance.%'
      and al.created_at between p_from and p_to
      and (p_action is null or al.action = p_action)
    limit greatest(p_limit,1)
  ), '[]'::jsonb);
end; $$;

create or replace function public.finance_audit_actions_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(distinct action order by action)
    from public.audit_log where action like 'finance.%'), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

-- ---------------------------------------------------------------------------
-- Final grant sweep for this whole pass — belt and braces on top of each
-- migration's own sweep, in case a later migration in the same pass added a
-- function after an earlier sweep already ran.
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
