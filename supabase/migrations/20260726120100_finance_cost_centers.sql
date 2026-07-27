-- Tarragon Health — Finance: cost centers.
--
-- Lets P&L be sliced by department — standard for any finance function
-- serious enough to report to investors/HMO partners, and directly useful
-- here given the master plan's per-tier clinical staffing cost model. A
-- journal line's cost_center_code is optional (unassigned lines still post
-- fine); private.finance_post_journal is extended to read it from each line's
-- jsonb object, so every existing caller (automated postings, manual entries,
-- settlements) keeps working unchanged and simply leaves it null unless set.

create table public.finance_cost_centers (
  code       text primary key,
  name       text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.finance_cost_centers enable row level security;

create trigger finance_cost_centers_set_updated_at
  before update on public.finance_cost_centers
  for each row execute function private.set_updated_at();

insert into public.finance_cost_centers (code, name, sort_order) values
  ('CLINICAL',       'Clinical care delivery (doctor tiers, care coordinators)', 10),
  ('PARTNER_NET',    'Partner network operations (labs, pharmacy, logistics)',   20),
  ('CORP_HMO',       'Corporate & HMO account management',                       30),
  ('MARKETING',      'Marketing & acquisition',                                   40),
  ('PRODUCT_ENG',    'Product & engineering',                                     50),
  ('OPS_ADMIN',      'General operations & administration',                       60)
on conflict (code) do nothing;

alter table public.finance_journal_lines
  add column if not exists cost_center_code text references public.finance_cost_centers (code) on delete set null;
create index if not exists finance_journal_lines_cost_center_idx on public.finance_journal_lines (cost_center_code);

-- ---------------------------------------------------------------------------
-- Re-post primitive: same balance/period/idempotency logic as before, now
-- also reading an optional cost_center_code per line.
-- ---------------------------------------------------------------------------
create or replace function private.finance_post_journal(
  p_entry_date date,
  p_currency public.currency,
  p_source text,
  p_source_ref text,
  p_memo text,
  p_lines jsonb,
  p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_period date := date_trunc('month', p_entry_date)::date;
  v_status text;
  v_existing uuid;
  v_entry uuid;
  v_debits bigint;
  v_credits bigint;
  v_count int;
begin
  if p_source_ref is not null then
    select id into v_existing from public.finance_journal_entries
      where source = p_source and source_ref = p_source_ref;
    if v_existing is not null then return v_existing; end if;
  end if;

  insert into public.finance_periods (period_month) values (v_period)
    on conflict (period_month) do nothing;
  select status into v_status from public.finance_periods where period_month = v_period;
  if v_status <> 'open' then
    raise exception 'accounting period % is % — cannot post', v_period, v_status
      using errcode = 'check_violation';
  end if;

  select coalesce(sum((l->>'debit_minor')::bigint),0),
         coalesce(sum((l->>'credit_minor')::bigint),0),
         count(*)
    into v_debits, v_credits, v_count
  from jsonb_array_elements(p_lines) l;

  if v_count < 2 then
    raise exception 'a journal entry needs at least two lines' using errcode = 'check_violation';
  end if;
  if v_debits <> v_credits then
    raise exception 'unbalanced journal: debits % <> credits %', v_debits, v_credits
      using errcode = 'check_violation';
  end if;
  if v_debits = 0 then
    raise exception 'a journal entry cannot be zero-value' using errcode = 'check_violation';
  end if;

  insert into public.finance_journal_entries
    (entry_date, period_month, currency, source, source_ref, memo, created_by)
  values (p_entry_date, v_period, p_currency, p_source, p_source_ref, p_memo,
          coalesce(p_created_by, (select auth.uid())))
  returning id into v_entry;

  insert into public.finance_journal_lines
    (entry_id, line_no, account_code, debit_minor, credit_minor, currency, organisation_id, counterparty, memo, cost_center_code)
  select v_entry, row_number() over (),
         l->>'account_code',
         coalesce((l->>'debit_minor')::bigint,0),
         coalesce((l->>'credit_minor')::bigint,0),
         p_currency,
         nullif(l->>'organisation_id','')::uuid,
         l->>'counterparty',
         l->>'memo',
         nullif(l->>'cost_center_code','')
  from jsonb_array_elements(p_lines) l;

  return v_entry;
end; $$;

-- Reversal already round-trips whatever a line carries via jsonb_build_object
-- from the row — extend it to preserve cost_center_code too.
create or replace function private.finance_reverse_entry(
  p_entry uuid, p_reason text, p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_orig public.finance_journal_entries%rowtype;
  v_new uuid;
  v_lines jsonb;
begin
  select * into v_orig from public.finance_journal_entries where id = p_entry;
  if v_orig.id is null then raise exception 'entry not found'; end if;
  if v_orig.is_reversed then raise exception 'entry already reversed'; end if;

  select jsonb_agg(jsonb_build_object(
    'account_code', account_code,
    'debit_minor', credit_minor,
    'credit_minor', debit_minor,
    'organisation_id', organisation_id,
    'counterparty', counterparty,
    'cost_center_code', cost_center_code,
    'memo', 'Reversal: ' || coalesce(memo,'')))
  into v_lines
  from public.finance_journal_lines where entry_id = p_entry;

  v_new := private.finance_post_journal(
    current_date, v_orig.currency, 'adjustment', 'reversal:' || p_entry::text,
    coalesce(p_reason, 'Reversal of #' || v_orig.entry_no), v_lines, p_created_by);

  update public.finance_journal_entries set reversal_of = p_entry where id = v_new;
  update public.finance_journal_entries set is_reversed = true where id = p_entry;
  return v_new;
end; $$;

-- ---------------------------------------------------------------------------
-- Config + reporting RPCs.
-- ---------------------------------------------------------------------------
create or replace function public.finance_cost_centers_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'is_active', is_active, 'sort_order', sort_order)
      order by sort_order, code)
    from public.finance_cost_centers), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

create or replace function public.finance_upsert_cost_center(p_code text, p_name text, p_is_active boolean, p_sort_order integer)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.cost_centers.manage') then raise exception 'not authorised'; end if;
  insert into public.finance_cost_centers (code, name, is_active, sort_order)
  values (p_code, p_name, coalesce(p_is_active, true), coalesce(p_sort_order, 0))
  on conflict (code) do update set
    name = excluded.name, is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = now();
  perform private.log_audit('finance.cost_center.upsert', 'finance_cost_centers', null,
    jsonb_build_object('code', p_code, 'name', p_name, 'is_active', p_is_active));
  return p_code;
end; $$;

create or replace function public.finance_pnl_by_cost_center(p_from date, p_to date, p_currency text default 'NGN')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_finance() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'cost_center_code', x.cost_center_code,
      'cost_center_name', x.cost_center_name,
      'revenue_minor', x.revenue_minor,
      'expense_minor', x.expense_minor,
      'net_minor', x.net_minor
    ) order by x.sort_order, x.cost_center_code)
    from (
      select coalesce(cc.code, 'UNASSIGNED') as cost_center_code,
             coalesce(cc.name, 'Unassigned') as cost_center_name,
             coalesce(sum(case when a.account_type='revenue' then l.credit_minor-l.debit_minor else 0 end),0) as revenue_minor,
             coalesce(sum(case when a.account_type='expense' then l.debit_minor-l.credit_minor else 0 end),0) as expense_minor,
             coalesce(sum(case when a.account_type='revenue' then l.credit_minor-l.debit_minor
                                when a.account_type='expense' then l.credit_minor-l.debit_minor
                                else 0 end),0) as net_minor,
             coalesce(cc.sort_order, 999) as sort_order
      from public.finance_journal_lines l
      join public.finance_accounts a on a.code = l.account_code
      join public.finance_journal_entries e on e.id = l.entry_id
      left join public.finance_cost_centers cc on cc.code = l.cost_center_code
      where a.account_type in ('revenue','expense') and l.currency = p_currency::public.currency
        and e.entry_date between p_from and p_to
      group by cc.code, cc.name, cc.sort_order
    ) x
  ), '[]'::jsonb);
end; $$;

insert into public.permissions (key, label, category, description) values
  ('finance.cost_centers.manage', 'Manage cost centers', 'Finance', 'Create/edit cost centers and tag journal lines with them.')
on conflict (key) do nothing;

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
