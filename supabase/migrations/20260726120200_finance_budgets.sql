-- Tarragon Health — Finance: budgets + budget-vs-actual.
--
-- A monthly budget per account (optionally per cost center), compared against
-- real GL postings for the same period. Manual upsert logic (select-then-
-- insert/update) rather than ON CONFLICT, since the natural key involves a
-- nullable cost_center_code and keeping the RPC simple beats an expression-
-- index conflict target.

create table public.finance_budgets (
  id                uuid primary key default gen_random_uuid(),
  account_code      text not null references public.finance_accounts (code),
  cost_center_code  text references public.finance_cost_centers (code) on delete set null,
  period_month      date not null,
  currency          public.currency not null default 'NGN',
  amount_minor      bigint not null check (amount_minor >= 0),
  notes             text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.finance_budgets enable row level security;
create index finance_budgets_period_idx on public.finance_budgets (period_month);

create trigger finance_budgets_set_updated_at
  before update on public.finance_budgets
  for each row execute function private.set_updated_at();

insert into public.permissions (key, label, category, description) values
  ('finance.budgets.manage', 'Manage budgets', 'Finance', 'Set monthly budgets per account/cost-center.')
on conflict (key) do nothing;

create or replace function public.finance_upsert_budget(
  p_account_code text, p_cost_center_code text, p_period_month date,
  p_currency text, p_amount_minor bigint, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_month date := date_trunc('month', p_period_month)::date;
begin
  if not private.finance_can('finance.budgets.manage') then raise exception 'not authorised'; end if;
  if coalesce(p_amount_minor, 0) < 0 then raise exception 'budget amount cannot be negative'; end if;

  select id into v_id from public.finance_budgets
    where account_code = p_account_code
      and coalesce(cost_center_code,'') = coalesce(nullif(p_cost_center_code,''), '')
      and period_month = v_month
      and currency = coalesce(p_currency,'NGN')::public.currency;

  if v_id is null then
    insert into public.finance_budgets (account_code, cost_center_code, period_month, currency, amount_minor, notes, created_by)
    values (p_account_code, nullif(p_cost_center_code,''), v_month, coalesce(p_currency,'NGN')::public.currency,
            p_amount_minor, p_notes, (select auth.uid()))
    returning id into v_id;
  else
    update public.finance_budgets set amount_minor = p_amount_minor, notes = p_notes, updated_at = now()
    where id = v_id;
  end if;

  perform private.log_audit('finance.budget.upsert', 'finance_budgets', v_id,
    jsonb_build_object('account_code', p_account_code, 'cost_center_code', p_cost_center_code,
      'period_month', v_month, 'amount_minor', p_amount_minor));
  return v_id;
end; $$;

create or replace function public.finance_delete_budget(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.budgets.manage') then raise exception 'not authorised'; end if;
  delete from public.finance_budgets where id = p_id;
  perform private.log_audit('finance.budget.delete', 'finance_budgets', p_id, '{}'::jsonb);
end; $$;

-- Budget vs actual for a date range, grouped by account (+ cost center when set).
create or replace function public.finance_budget_variance(p_from date, p_to date, p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    with budgeted as (
      select b.account_code, b.cost_center_code, sum(b.amount_minor) budget_minor
      from public.finance_budgets b
      where b.period_month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
        and b.currency = p_currency::public.currency
      group by b.account_code, b.cost_center_code
    ),
    actual as (
      select l.account_code, l.cost_center_code,
        sum(case when a.account_type = 'revenue' then l.credit_minor - l.debit_minor
                 else l.debit_minor - l.credit_minor end) actual_minor
      from public.finance_journal_lines l
      join public.finance_accounts a on a.code = l.account_code
      join public.finance_journal_entries e on e.id = l.entry_id
      where l.currency = p_currency::public.currency and e.entry_date between p_from and p_to
      group by l.account_code, l.cost_center_code
    )
    select jsonb_agg(jsonb_build_object(
      'account_code', coalesce(bd.account_code, ac.account_code),
      'account_name', (select name from public.finance_accounts where code = coalesce(bd.account_code, ac.account_code)),
      'account_type', (select account_type from public.finance_accounts where code = coalesce(bd.account_code, ac.account_code)),
      'cost_center_code', coalesce(bd.cost_center_code, ac.cost_center_code),
      'budget_minor', coalesce(bd.budget_minor, 0),
      'actual_minor', coalesce(ac.actual_minor, 0),
      'variance_minor', coalesce(ac.actual_minor, 0) - coalesce(bd.budget_minor, 0)
    ) order by coalesce(bd.account_code, ac.account_code))
    from budgeted bd
    full outer join actual ac
      on ac.account_code = bd.account_code and coalesce(ac.cost_center_code,'') = coalesce(bd.cost_center_code,'')
  ), '[]'::jsonb);
end; $$;

create or replace function public.finance_budgets_list(p_period_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'account_code', b.account_code, 'account_name', a.name,
      'cost_center_code', b.cost_center_code, 'period_month', to_char(b.period_month,'YYYY-MM'),
      'currency', b.currency, 'amount_minor', b.amount_minor, 'notes', b.notes)
      order by b.period_month desc, b.account_code)
    from public.finance_budgets b
    join public.finance_accounts a on a.code = b.account_code
    where p_period_month is null or b.period_month = date_trunc('month', p_period_month)::date
  ), '[]'::jsonb);
end; $$;

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
