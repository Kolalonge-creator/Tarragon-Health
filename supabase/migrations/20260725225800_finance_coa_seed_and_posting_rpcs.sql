-- Tarragon Health — Finance: chart-of-accounts seed + posting/reversal/period RPCs.

-- ---------------------------------------------------------------------------
-- Chart of accounts (Nigeria-first, multi-currency). Amounts in minor units.
-- Revenue accounts default to VAT 'exempt' (medical-services exemption) — a
-- finance officer flips a specific account to 'standard' if a line is VATable.
-- ---------------------------------------------------------------------------
insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, sort_order, description) values
  ('1000','Bank — Paystack (NGN settlement)','asset','debit','exempt',10,'Cash settled from Paystack to the operating account.'),
  ('1010','Bank — Stripe (diaspora settlement)','asset','debit','exempt',11,'Cash settled from Stripe (GBP/USD).'),
  ('1020','Payment processor clearing','asset','debit','exempt',12,'Card charges captured but not yet settled/paid out by the processor.'),
  ('1200','Commission receivable','asset','debit','exempt',20,'Partner commissions earned but not yet collected.'),
  ('1300','Input VAT recoverable','asset','debit','exempt',30,'VAT paid on purchases, recoverable against output VAT.'),
  ('2000','Deferred revenue','liability','credit','exempt',40,'Subscription/add-on payments received but not yet earned.'),
  ('2100','Customer wallet funds','liability','credit','exempt',41,'Health-wallet balances held on behalf of patients (customer money).'),
  ('2200','Output VAT payable','liability','credit','exempt',42,'VAT charged on standard-rated sales, payable to FIRS.'),
  ('2300','Withholding tax payable','liability','credit','exempt',43,'WHT withheld from partner payouts, remittable to FIRS.'),
  ('2400','Refunds payable','liability','credit','exempt',44,'Refunds/held payments due back to customers.'),
  ('3000','Retained earnings','equity','credit','exempt',50,'Accumulated net result.'),
  ('3100','Opening balance equity','equity','credit','exempt',51,'Contra used when entering opening balances.'),
  ('4000','Subscription revenue','revenue','credit','exempt',60,'Recurring plan revenue, recognised over the billing period.'),
  ('4010','Add-on revenue','revenue','credit','exempt',61,'Recurring add-on revenue, recognised over the billing period.'),
  ('4100','Booking & service revenue','revenue','credit','exempt',62,'One-off labs/pharmacy/video-visit service revenue.'),
  ('4200','Commission income','revenue','credit','exempt',63,'Partner-network commission income.'),
  ('4900','Refunds & chargebacks','contra_revenue','debit','exempt',70,'Contra-revenue for refunded/charged-back sales.'),
  ('5000','Payment processing fees','expense','debit','exempt',80,'Paystack/Stripe transaction fees.'),
  ('6000','Marketing expense','expense','debit','exempt',81,'Acquisition/marketing spend.'),
  ('6100','Operating expense','expense','debit','exempt',82,'General operating expense.'),
  ('6200','Bank & FX charges','expense','debit','exempt',83,'FX conversion and bank charges.')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Write-authorization helper: the finance/admin role holds every finance
-- capability implicitly; a delegated member needs the specific RBAC grant.
-- ---------------------------------------------------------------------------
create or replace function private.finance_can(perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('finance','admin')
  ) or private.has_permission(perm);
$$;

-- ---------------------------------------------------------------------------
-- Core posting primitive — the ONLY write path into the ledger. Atomic,
-- idempotent (per source+source_ref), balance-validated, period-gated.
-- p_lines: jsonb array of {account_code, debit_minor, credit_minor,
--          organisation_id?, counterparty?, memo?}. Debits must equal credits.
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
  -- Idempotency: a source event posts exactly once.
  if p_source_ref is not null then
    select id into v_existing from public.finance_journal_entries
      where source = p_source and source_ref = p_source_ref;
    if v_existing is not null then return v_existing; end if;
  end if;

  -- Period gate: auto-create an open period, refuse if closed/locked.
  insert into public.finance_periods (period_month) values (v_period)
    on conflict (period_month) do nothing;
  select status into v_status from public.finance_periods where period_month = v_period;
  if v_status <> 'open' then
    raise exception 'accounting period % is % — cannot post', v_period, v_status
      using errcode = 'check_violation';
  end if;

  -- Validate the balanced set of lines.
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
    (entry_id, line_no, account_code, debit_minor, credit_minor, currency, organisation_id, counterparty, memo)
  select v_entry, row_number() over (),
         l->>'account_code',
         coalesce((l->>'debit_minor')::bigint,0),
         coalesce((l->>'credit_minor')::bigint,0),
         p_currency,
         nullif(l->>'organisation_id','')::uuid,
         l->>'counterparty',
         l->>'memo'
  from jsonb_array_elements(p_lines) l;

  return v_entry;
end; $$;

-- Reverse a posted entry by mirroring its lines into a new adjustment entry
-- (dated today, so it never posts into a closed period). Never edits the original.
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
    'debit_minor', credit_minor,     -- swap sides
    'credit_minor', debit_minor,
    'organisation_id', organisation_id,
    'counterparty', counterparty,
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
-- Authenticated wrappers (UI paths), each gated on the specific capability.
-- ---------------------------------------------------------------------------
create or replace function public.finance_post_manual_journal(
  p_entry_date date, p_currency text, p_memo text, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;
  v_id := private.finance_post_journal(
    coalesce(p_entry_date, current_date), coalesce(p_currency,'NGN')::public.currency,
    'manual', null, p_memo, p_lines, (select auth.uid()));
  return v_id;
end; $$;

create or replace function public.finance_reverse_journal(p_entry uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.gl.post') then raise exception 'not authorised'; end if;
  return private.finance_reverse_entry(p_entry, p_reason, (select auth.uid()));
end; $$;

create or replace function public.finance_set_period_status(p_month date, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.periods.manage') then raise exception 'not authorised'; end if;
  if p_status not in ('open','closed','locked') then raise exception 'invalid status'; end if;
  insert into public.finance_periods (period_month, status)
  values (date_trunc('month', p_month)::date, p_status)
  on conflict (period_month) do update set
    status = excluded.status,
    closed_at = case when excluded.status in ('closed','locked') then now() else null end,
    closed_by = case when excluded.status in ('closed','locked') then (select auth.uid()) else null end,
    locked_at = case when excluded.status = 'locked' then now() else null end,
    locked_by = case when excluded.status = 'locked' then (select auth.uid()) else null end;
end; $$;

create or replace function public.finance_upsert_account(
  p_code text, p_name text, p_type text, p_normal_balance text,
  p_vat_treatment text, p_is_active boolean, p_sort_order integer, p_description text
) returns text language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.tax.manage') then raise exception 'not authorised'; end if;
  insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, is_active, sort_order, description)
  values (p_code, p_name, p_type, p_normal_balance, coalesce(p_vat_treatment,'exempt'),
          coalesce(p_is_active,true), coalesce(p_sort_order,0), p_description)
  on conflict (code) do update set
    name = excluded.name, account_type = excluded.account_type, normal_balance = excluded.normal_balance,
    vat_treatment = excluded.vat_treatment, is_active = excluded.is_active,
    sort_order = excluded.sort_order, description = excluded.description, updated_at = now();
  return p_code;
end; $$;
