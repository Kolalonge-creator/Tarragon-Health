-- Tarragon Health — Finance subsystem: general ledger core.
--
-- Real double-entry backbone (chart of accounts + periods + append-only
-- balanced journal), distinct from the modeled /analytics accounting evidence
-- layer. All finance tables carry RLS ON with NO policies — access is only ever
-- through SECURITY DEFINER RPCs gated by private.is_finance() (same discipline
-- as the analytics governance tables). Corrections are made by posting reversal
-- entries, never by editing a posted entry (audit integrity).

-- ---------------------------------------------------------------------------
-- 1. Chart of accounts (global, platform-level — no organisation_id).
-- ---------------------------------------------------------------------------
create table public.finance_accounts (
  code           text primary key,
  name           text not null,
  account_type   text not null check (account_type in ('asset','liability','equity','revenue','contra_revenue','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')),
  -- VAT treatment of amounts posted to this account. Default 'exempt': most
  -- Nigerian medical/health services are VAT-exempt under the VAT Act, so we do
  -- NOT split output VAT by default. Finance flips a specific account to
  -- 'standard' when a revenue line is genuinely VATable (founder/tax-adviser call).
  vat_treatment  text not null default 'exempt' check (vat_treatment in ('exempt','standard','zero_rated')),
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  description    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.finance_accounts enable row level security;

create trigger finance_accounts_set_updated_at
  before update on public.finance_accounts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Accounting periods. One row per calendar month; posting is blocked once a
--    period is closed/locked. Auto-created 'open' by the posting RPC.
-- ---------------------------------------------------------------------------
create table public.finance_periods (
  period_month date primary key,          -- first day of the month
  status       text not null default 'open' check (status in ('open','closed','locked')),
  closed_at    timestamptz,
  closed_by    uuid references public.profiles (id) on delete set null,
  locked_at    timestamptz,
  locked_by    uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.finance_periods enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Journal entries (header) + lines. Human-readable entry_no via a sequence.
-- ---------------------------------------------------------------------------
create sequence if not exists public.finance_entry_no_seq;

create table public.finance_journal_entries (
  id           uuid primary key default gen_random_uuid(),
  entry_no     bigint not null default nextval('public.finance_entry_no_seq'),
  entry_date   date not null,
  period_month date not null,
  currency     public.currency not null default 'NGN',
  source       text not null check (source in ('payment','commission','refund','wallet','revenue_recognition','fx','manual','adjustment','opening')),
  source_ref   text,                       -- idempotency key within a source
  memo         text,
  reversal_of  uuid references public.finance_journal_entries (id) on delete set null,
  is_reversed  boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
alter table public.finance_journal_entries enable row level security;

-- Idempotent posting: a source event (a Paystack charge, a monthly rev-rec run)
-- posts exactly once. Null source_ref (ad-hoc manual entries) is exempt.
create unique index finance_journal_entries_source_uniq
  on public.finance_journal_entries (source, source_ref)
  where source_ref is not null;
create index finance_journal_entries_period_idx on public.finance_journal_entries (period_month);
create index finance_journal_entries_date_idx on public.finance_journal_entries (entry_date);

create table public.finance_journal_lines (
  id              uuid primary key default gen_random_uuid(),
  entry_id        uuid not null references public.finance_journal_entries (id) on delete cascade,
  line_no         integer not null default 1,
  account_code    text not null references public.finance_accounts (code),
  debit_minor     bigint not null default 0 check (debit_minor >= 0),
  credit_minor    bigint not null default 0 check (credit_minor >= 0),
  currency        public.currency not null default 'NGN',
  organisation_id uuid references public.organisations (id) on delete set null,
  counterparty    text,
  memo            text,
  created_at      timestamptz not null default now(),
  -- a line is exactly one side of the entry
  constraint finance_journal_lines_one_side check (
    (debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0)
  )
);
alter table public.finance_journal_lines enable row level security;
create index finance_journal_lines_entry_idx on public.finance_journal_lines (entry_id);
create index finance_journal_lines_account_idx on public.finance_journal_lines (account_code);

-- ---------------------------------------------------------------------------
-- 4. Balance invariant — DEFERRABLE constraint trigger checked at commit, so a
--    journal entry can never persist with total debits <> total credits, even
--    if written outside the posting RPC. Checked per (entry, currency).
-- ---------------------------------------------------------------------------
create or replace function private.finance_assert_entry_balanced()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_entry uuid := coalesce(new.entry_id, old.entry_id);
  v_unbalanced int;
begin
  -- Entry may have been deleted (cascade) — nothing to check.
  if not exists (select 1 from public.finance_journal_entries where id = v_entry) then
    return null;
  end if;
  select count(*) into v_unbalanced
  from (
    select currency, sum(debit_minor) d, sum(credit_minor) c
    from public.finance_journal_lines
    where entry_id = v_entry
    group by currency
    having sum(debit_minor) <> sum(credit_minor)
  ) x;
  if v_unbalanced > 0 then
    raise exception 'finance journal entry % is unbalanced (debits <> credits)', v_entry
      using errcode = 'check_violation';
  end if;
  return null;
end; $$;

create constraint trigger finance_journal_lines_balanced
  after insert or update or delete on public.finance_journal_lines
  deferrable initially deferred
  for each row execute function private.finance_assert_entry_balanced();
