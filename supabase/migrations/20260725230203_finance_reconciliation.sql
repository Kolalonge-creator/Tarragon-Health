-- Tarragon Health — Finance: settlement reconciliation.
--
-- Confirms that every card charge we captured (payment_transactions) actually
-- landed in a provider payout, and books the processor fee. A finance officer
-- imports a settlement batch (gross / fees / net as reported by Paystack/Stripe),
-- matches the captured payments that belong to it, then posts it — which moves
-- money out of the Payment-processor-clearing account into Bank and expenses the
-- fee. Posting REQUIRES gross = net + fees (a real reconciliation control): a
-- mismatch is surfaced as a variance rather than silently posting.

create table public.finance_settlements (
  id              uuid primary key default gen_random_uuid(),
  provider        public.payment_provider not null,
  external_ref    text,
  settlement_date date not null,
  currency        public.currency not null default 'NGN',
  gross_minor     bigint not null default 0,   -- as reported by the provider
  fees_minor      bigint not null default 0,
  net_minor       bigint not null default 0,
  bank_account_code text not null default '1000' references public.finance_accounts (code),
  status          text not null default 'draft' check (status in ('draft','reconciled')),
  journal_entry_id uuid references public.finance_journal_entries (id) on delete set null,
  notes           text,
  imported_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.finance_settlements enable row level security;
create unique index finance_settlements_provider_ref_uniq
  on public.finance_settlements (provider, external_ref) where external_ref is not null;

create trigger finance_settlements_set_updated_at
  before update on public.finance_settlements
  for each row execute function private.set_updated_at();

-- One captured payment reconciles to at most one settlement.
create table public.finance_settlement_matches (
  id                     uuid primary key default gen_random_uuid(),
  settlement_id          uuid not null references public.finance_settlements (id) on delete cascade,
  payment_transaction_id uuid not null references public.payment_transactions (id) on delete cascade,
  amount_minor           bigint not null,
  matched_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (payment_transaction_id)
);
alter table public.finance_settlement_matches enable row level security;
create index finance_settlement_matches_settlement_idx
  on public.finance_settlement_matches (settlement_id);

-- ---------------------------------------------------------------------------
-- Write RPCs (gated finance.reconcile).
-- ---------------------------------------------------------------------------
create or replace function public.finance_import_settlement(
  p_provider text, p_external_ref text, p_settlement_date date, p_currency text,
  p_gross bigint, p_fees bigint, p_net bigint, p_bank_account text, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  insert into public.finance_settlements
    (provider, external_ref, settlement_date, currency, gross_minor, fees_minor, net_minor,
     bank_account_code, notes, imported_by)
  values (p_provider::public.payment_provider, nullif(p_external_ref,''), p_settlement_date,
          coalesce(p_currency,'NGN')::public.currency, coalesce(p_gross,0), coalesce(p_fees,0),
          coalesce(p_net,0), coalesce(p_bank_account,'1000'), nullif(p_notes,''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.finance_match_payment(
  p_settlement_id uuid, p_payment_transaction_id uuid, p_amount bigint
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  select status into v_status from public.finance_settlements where id = p_settlement_id;
  if v_status is null then raise exception 'settlement not found'; end if;
  if v_status <> 'draft' then raise exception 'settlement already reconciled — cannot change matches'; end if;
  insert into public.finance_settlement_matches (settlement_id, payment_transaction_id, amount_minor, matched_by)
  values (p_settlement_id, p_payment_transaction_id, p_amount, (select auth.uid()))
  on conflict (payment_transaction_id) do update set
    settlement_id = excluded.settlement_id, amount_minor = excluded.amount_minor, matched_by = excluded.matched_by
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.finance_unmatch_payment(p_payment_transaction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  delete from public.finance_settlement_matches m
    using public.finance_settlements s
    where m.settlement_id = s.id and m.payment_transaction_id = p_payment_transaction_id and s.status = 'draft';
end; $$;

-- Reconcile + post: Dr Bank(net) + Dr Fees(fees) = Cr Clearing(gross). Requires
-- gross = net + fees, else raises a variance. Idempotent via source_ref.
create or replace function public.finance_post_settlement(p_settlement_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  st public.finance_settlements%rowtype;
  v_entry uuid;
begin
  if not private.finance_can('finance.reconcile') then raise exception 'not authorised'; end if;
  select * into st from public.finance_settlements where id = p_settlement_id;
  if st.id is null then raise exception 'settlement not found'; end if;
  if st.status = 'reconciled' then return st.journal_entry_id; end if;
  if st.gross_minor <> st.net_minor + st.fees_minor then
    raise exception 'settlement does not balance: gross % <> net % + fees % (variance %)',
      st.gross_minor, st.net_minor, st.fees_minor, st.gross_minor - (st.net_minor + st.fees_minor)
      using errcode = 'check_violation';
  end if;

  v_entry := private.finance_post_journal(
    st.settlement_date, st.currency, 'payment', 'settlement:' || st.id::text,
    'Settlement ' || st.provider::text || coalesce(' ' || st.external_ref, ''),
    jsonb_build_array(
      jsonb_build_object('account_code', st.bank_account_code, 'debit_minor', st.net_minor, 'credit_minor', 0,
                         'counterparty', st.provider::text),
      jsonb_build_object('account_code', '5000', 'debit_minor', st.fees_minor, 'credit_minor', 0,
                         'counterparty', st.provider::text),
      jsonb_build_object('account_code', '1020', 'debit_minor', 0, 'credit_minor', st.gross_minor,
                         'counterparty', st.provider::text)
    ),
    (select auth.uid()));

  update public.finance_settlements
    set status = 'reconciled', journal_entry_id = v_entry
    where id = st.id;
  return v_entry;
end; $$;
