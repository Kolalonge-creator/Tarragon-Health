-- Tarragon Health — Finance: accounts payable (vendors + bills).
--
-- A minimal AP subledger for the operating-expense spend that doesn't already
-- post automatically (rent, SaaS, marketing agencies, indemnity cover,
-- professional/legal fees, equipment) — commissions and payment-processor
-- settlements already have their own automated posting and are untouched.
-- Lifecycle: draft → approved (books Dr Expense / Cr AP [+ Cr WHT payable if
-- the vendor is WHT-applicable]) → paid (books Dr AP / Cr Bank, net of any
-- WHT already withheld at approval). A draft bill can be voided outright;
-- an approved/paid bill is corrected the same way as any other ledger entry
-- — by reversing the resulting journal entry, never by editing the bill.

create table public.finance_vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  vendor_type    text,
  contact_email  text,
  contact_phone  text,
  tin            text,
  wht_applicable boolean not null default false,
  wht_rate_pct   numeric,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.finance_vendors enable row level security;

create trigger finance_vendors_set_updated_at
  before update on public.finance_vendors
  for each row execute function private.set_updated_at();

create sequence if not exists public.finance_bill_no_seq;

create table public.finance_bills (
  id                     uuid primary key default gen_random_uuid(),
  bill_no                bigint not null default nextval('public.finance_bill_no_seq'),
  vendor_id              uuid not null references public.finance_vendors (id),
  bill_date              date not null,
  due_date               date,
  currency               public.currency not null default 'NGN',
  amount_minor           bigint not null check (amount_minor > 0),
  expense_account_code   text not null references public.finance_accounts (code),
  cost_center_code       text references public.finance_cost_centers (code) on delete set null,
  description            text,
  status                 text not null default 'draft' check (status in ('draft','approved','paid','void')),
  wht_rate_pct           numeric not null default 0,
  wht_minor              bigint not null default 0 check (wht_minor >= 0),
  bank_account_code      text references public.finance_accounts (code),
  approve_journal_entry_id uuid references public.finance_journal_entries (id) on delete set null,
  pay_journal_entry_id   uuid references public.finance_journal_entries (id) on delete set null,
  created_by             uuid references public.profiles (id) on delete set null,
  approved_by            uuid references public.profiles (id) on delete set null,
  approved_at            timestamptz,
  paid_at                timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint finance_bills_wht_not_over_amount check (wht_minor <= amount_minor)
);
alter table public.finance_bills enable row level security;
create index finance_bills_vendor_idx on public.finance_bills (vendor_id);
create index finance_bills_status_idx on public.finance_bills (status);

create trigger finance_bills_set_updated_at
  before update on public.finance_bills
  for each row execute function private.set_updated_at();

insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, sort_order, description) values
  ('2500','Accounts payable — vendors','liability','credit','exempt',45,'Approved vendor bills not yet paid.')
on conflict (code) do nothing;

insert into public.permissions (key, label, category, description) values
  ('finance.vendors.manage', 'Manage vendors & bills', 'Finance', 'Create vendors, and create/approve/pay/void vendor bills.')
on conflict (key) do nothing;

create or replace function public.finance_upsert_vendor(
  p_id uuid, p_name text, p_vendor_type text, p_contact_email text, p_contact_phone text,
  p_tin text, p_wht_applicable boolean, p_wht_rate_pct numeric, p_is_active boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.vendors.manage') then raise exception 'not authorised'; end if;
  if p_id is null then
    insert into public.finance_vendors (name, vendor_type, contact_email, contact_phone, tin, wht_applicable, wht_rate_pct, is_active)
    values (p_name, nullif(p_vendor_type,''), nullif(p_contact_email,''), nullif(p_contact_phone,''), nullif(p_tin,''),
            coalesce(p_wht_applicable,false), p_wht_rate_pct, coalesce(p_is_active,true))
    returning id into v_id;
  else
    update public.finance_vendors set
      name=p_name, vendor_type=nullif(p_vendor_type,''), contact_email=nullif(p_contact_email,''),
      contact_phone=nullif(p_contact_phone,''), tin=nullif(p_tin,''), wht_applicable=coalesce(p_wht_applicable,false),
      wht_rate_pct=p_wht_rate_pct, is_active=coalesce(p_is_active,true), updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  perform private.log_audit('finance.vendor.upsert', 'finance_vendors', v_id, jsonb_build_object('name', p_name));
  return v_id;
end; $$;

create or replace function public.finance_vendors_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'vendor_type', vendor_type, 'contact_email', contact_email,
      'contact_phone', contact_phone, 'tin', tin, 'wht_applicable', wht_applicable,
      'wht_rate_pct', wht_rate_pct, 'is_active', is_active) order by name)
    from public.finance_vendors), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

create or replace function public.finance_create_bill(
  p_vendor_id uuid, p_bill_date date, p_due_date date, p_currency text, p_amount_minor bigint,
  p_expense_account_code text, p_cost_center_code text, p_description text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_wht_rate numeric; v_wht_applicable boolean; v_wht_minor bigint := 0;
begin
  if not private.finance_can('finance.vendors.manage') then raise exception 'not authorised'; end if;
  if coalesce(p_amount_minor,0) <= 0 then raise exception 'bill amount must be positive'; end if;
  select wht_applicable, wht_rate_pct into v_wht_applicable, v_wht_rate from public.finance_vendors where id = p_vendor_id;
  if v_wht_applicable and v_wht_rate is not null then
    v_wht_minor := round(p_amount_minor * v_wht_rate / 100.0);
  end if;

  insert into public.finance_bills
    (vendor_id, bill_date, due_date, currency, amount_minor, expense_account_code, cost_center_code,
     description, wht_rate_pct, wht_minor, created_by)
  values (p_vendor_id, p_bill_date, p_due_date, coalesce(p_currency,'NGN')::public.currency, p_amount_minor,
          p_expense_account_code, nullif(p_cost_center_code,''), p_description, coalesce(v_wht_rate,0), v_wht_minor,
          (select auth.uid()))
  returning id into v_id;

  perform private.log_audit('finance.bill.create', 'finance_bills', v_id,
    jsonb_build_object('vendor_id', p_vendor_id, 'amount_minor', p_amount_minor));
  return v_id;
end; $$;

create or replace function public.finance_approve_bill(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.finance_bills%rowtype; v_entry uuid; v_ap_minor bigint;
begin
  if not private.finance_can('finance.vendors.manage') then raise exception 'not authorised'; end if;
  select * into b from public.finance_bills where id = p_id;
  if b.id is null then raise exception 'bill not found'; end if;
  if b.status <> 'draft' then raise exception 'only a draft bill can be approved'; end if;

  v_ap_minor := b.amount_minor - b.wht_minor;
  v_entry := private.finance_post_journal(
    b.bill_date, b.currency, 'manual', 'bill_approve:' || b.id::text,
    'Bill approved — ' || (select name from public.finance_vendors where id = b.vendor_id),
    (case when b.wht_minor > 0 then
      jsonb_build_array(
        jsonb_build_object('account_code', b.expense_account_code, 'debit_minor', b.amount_minor, 'credit_minor', 0, 'cost_center_code', b.cost_center_code),
        jsonb_build_object('account_code', '2500', 'debit_minor', 0, 'credit_minor', v_ap_minor),
        jsonb_build_object('account_code', '2300', 'debit_minor', 0, 'credit_minor', b.wht_minor))
    else
      jsonb_build_array(
        jsonb_build_object('account_code', b.expense_account_code, 'debit_minor', b.amount_minor, 'credit_minor', 0, 'cost_center_code', b.cost_center_code),
        jsonb_build_object('account_code', '2500', 'debit_minor', 0, 'credit_minor', v_ap_minor))
    end),
    (select auth.uid()));

  update public.finance_bills set status='approved', approve_journal_entry_id=v_entry,
    approved_by=(select auth.uid()), approved_at=now() where id=p_id;
  perform private.log_audit('finance.bill.approve', 'finance_bills', p_id, jsonb_build_object('journal_entry_id', v_entry));
  return v_entry;
end; $$;

create or replace function public.finance_pay_bill(p_id uuid, p_bank_account_code text, p_paid_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.finance_bills%rowtype; v_entry uuid; v_ap_minor bigint;
begin
  if not private.finance_can('finance.vendors.manage') then raise exception 'not authorised'; end if;
  select * into b from public.finance_bills where id = p_id;
  if b.id is null then raise exception 'bill not found'; end if;
  if b.status <> 'approved' then raise exception 'only an approved bill can be paid'; end if;

  v_ap_minor := b.amount_minor - b.wht_minor;
  v_entry := private.finance_post_journal(
    coalesce(p_paid_date, current_date), b.currency, 'manual', 'bill_pay:' || b.id::text,
    'Bill paid — ' || (select name from public.finance_vendors where id = b.vendor_id),
    jsonb_build_array(
      jsonb_build_object('account_code', '2500', 'debit_minor', v_ap_minor, 'credit_minor', 0),
      jsonb_build_object('account_code', coalesce(p_bank_account_code,'1000'), 'debit_minor', 0, 'credit_minor', v_ap_minor)),
    (select auth.uid()));

  update public.finance_bills set status='paid', pay_journal_entry_id=v_entry,
    bank_account_code=coalesce(p_bank_account_code,'1000'), paid_at=now() where id=p_id;
  perform private.log_audit('finance.bill.pay', 'finance_bills', p_id, jsonb_build_object('journal_entry_id', v_entry));
  return v_entry;
end; $$;

create or replace function public.finance_void_bill(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.vendors.manage') then raise exception 'not authorised'; end if;
  update public.finance_bills set status='void' where id=p_id and status='draft';
  if not found then raise exception 'only a draft bill can be voided directly — reverse its journal entry instead'; end if;
  perform private.log_audit('finance.bill.void', 'finance_bills', p_id, jsonb_build_object('reason', p_reason));
end; $$;

create or replace function public.finance_bills_list(p_status text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'bill_no', b.bill_no, 'vendor_id', b.vendor_id, 'vendor_name', v.name,
      'bill_date', b.bill_date, 'due_date', b.due_date, 'currency', b.currency,
      'amount_minor', b.amount_minor, 'expense_account_code', b.expense_account_code,
      'cost_center_code', b.cost_center_code, 'description', b.description, 'status', b.status,
      'wht_minor', b.wht_minor, 'paid_at', b.paid_at)
      order by b.bill_date desc, b.bill_no desc)
    from public.finance_bills b join public.finance_vendors v on v.id = b.vendor_id
    where p_status is null or b.status = p_status), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

-- Aging: unpaid (approved, not yet paid) bills bucketed by days past due.
create or replace function public.finance_ap_aging()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'bill_no', b.bill_no, 'vendor_name', v.name, 'currency', b.currency,
      'amount_minor', b.amount_minor - b.wht_minor, 'due_date', b.due_date,
      'days_overdue', greatest(0, (current_date - coalesce(b.due_date, b.bill_date))))
      order by coalesce(b.due_date, b.bill_date))
    from public.finance_bills b join public.finance_vendors v on v.id = b.vendor_id
    where b.status = 'approved'), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

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
