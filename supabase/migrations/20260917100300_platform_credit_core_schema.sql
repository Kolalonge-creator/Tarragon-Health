-- Tarragon Health — Platform Credit, part 1: core schema.
--
-- Founder ask (2026-09-17): a fal.ai/SaveAI-style prepaid balance — top up any
-- amount (suggested ₦10k/20k/50k/100k or custom), never expires, never cashed
-- out, spend it on any service_products purchase with the cost shown up front
-- and a top-up prompt when short.
--
-- This is NOT a re-run of the Health Wallet, which was deliberately deleted
-- 2026-07-31 (see 20260731215735_retire_health_wallet.sql) with an explicit,
-- still-correct objection: "mixing [prepayment liability and marketing
-- credit] is what made wallet balances indistinguishable between customer
-- money and marketing credit." That objection is answered here structurally,
-- not by policy: every balance is split into two buckets from the ledger up —
-- paid_balance_kobo (only ever funded by a real, verified Paystack charge) and
-- promo_balance_kobo (only ever funded by an admin-issued goodwill grant) —
-- so "how much of this is Tarragon's money vs the customer's money" is always
-- a stored fact, never a reconstruction. Spending draws from promo first, then
-- paid (documented in private.platform_credit_apply), and the finance posting
-- in a later migration in this set credits the correct liability account
-- (2100 customer prepayments vs 2600 promotional credit) per bucket, per the
-- same discipline the care_vouchers accounting already established — reusing
-- those two accounts rather than adding new ones, since the economic
-- substance is identical (see 20260731215910_finance_care_voucher_accounting.sql).
--
-- Naming deliberately avoids "wallet" anywhere (table/function/column names)
-- to keep grep-for-wallet clean should anyone ever re-run the 2026-07-31
-- removal-audit query, and because "platform credit" is what the founder
-- actually asked for, not a wallet by another name — see the finding recorded
-- in this migration set's own PR description for the full reasoning.
--
-- Hardening lesson applied from day one rather than as a later patch: no
-- table here ever grants `authenticated` INSERT/UPDATE/DELETE. Every write
-- goes through a SECURITY DEFINER function (private.platform_credit_apply and
-- its public-facing callers in the next migrations) — see
-- 20260905000123_service_purchases_insert_only_via_intent_rpc.sql for the
-- exact vulnerability this avoids repeating: an unconstrained INSERT policy
-- on a money-adjacent table let a patient forge their own entitlement.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.platform_credit_entry_type as enum (
  'topup',              -- a real, verified Paystack charge landed
  'admin_grant',        -- goodwill/promotional credit, nobody paid
  'spend',              -- drawn down to pay for a service_products purchase
  'admin_correction'    -- a rare manual fix (e.g. a reconciled bank-transfer
                         -- top-up, or reversing an erroneous grant/topup)
);

create type public.platform_credit_bucket as enum ('paid', 'promo');

create type public.platform_credit_topup_status as enum (
  'pending_payment', 'completed', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- platform_credit_balances — one row per patient. balance_kobo is generated,
-- never written directly, so it can never drift from its two components.
-- ---------------------------------------------------------------------------

create table public.platform_credit_balances (
  patient_id            uuid primary key references public.profiles (id) on delete cascade,
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  paid_balance_kobo      bigint not null default 0 check (paid_balance_kobo >= 0),
  promo_balance_kobo     bigint not null default 0 check (promo_balance_kobo >= 0),
  balance_kobo           bigint generated always as (paid_balance_kobo + promo_balance_kobo) stored,
  lifetime_funded_kobo   bigint not null default 0 check (lifetime_funded_kobo >= 0),
  lifetime_granted_kobo  bigint not null default 0 check (lifetime_granted_kobo >= 0),
  lifetime_spent_kobo    bigint not null default 0 check (lifetime_spent_kobo >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger platform_credit_balances_set_updated_at
  before update on public.platform_credit_balances
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- platform_credit_ledger_entries — append-only. paid_amount_kobo/
-- promo_amount_kobo record exactly which bucket(s) a movement touched;
-- amount_kobo is their generated sum, kept only for easy display.
-- ---------------------------------------------------------------------------

create table public.platform_credit_ledger_entries (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  entry_type              public.platform_credit_entry_type not null,
  paid_amount_kobo        bigint not null default 0 check (paid_amount_kobo >= 0),
  promo_amount_kobo       bigint not null default 0 check (promo_amount_kobo >= 0),
  amount_kobo             bigint generated always as (paid_amount_kobo + promo_amount_kobo) stored,
  balance_after_kobo      bigint not null check (balance_after_kobo >= 0),
  service_purchase_id     uuid references public.service_purchases (id) on delete set null,
  payment_transaction_id  uuid references public.payment_transactions (id) on delete set null,
  topup_intent_id         uuid, -- FK added in the next migration, once that table exists
  description             text,
  created_by              uuid references public.profiles (id) on delete set null, -- admin_grant/admin_correction only
  created_at              timestamptz not null default now(),
  constraint platform_credit_ledger_entries_has_amount check (paid_amount_kobo + promo_amount_kobo > 0)
);

create index platform_credit_ledger_entries_patient_idx
  on public.platform_credit_ledger_entries (patient_id, created_at desc);
create index platform_credit_ledger_entries_org_idx
  on public.platform_credit_ledger_entries (organisation_id, created_at desc);
create index platform_credit_ledger_entries_service_purchase_idx
  on public.platform_credit_ledger_entries (service_purchase_id) where service_purchase_id is not null;

-- ---------------------------------------------------------------------------
-- platform_credit_topup_intents — the pending row created before checkout,
-- same role as record_service_purchase_intent's row for service_purchases.
-- ---------------------------------------------------------------------------

create table public.platform_credit_topup_intents (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  purchaser_profile_id          uuid not null references public.profiles (id) on delete restrict,
  amount_kobo                   bigint not null,
  currency                      public.currency not null default 'NGN',
  status                        public.platform_credit_topup_status not null default 'pending_payment',
  payment_provider              public.payment_provider,
  payment_provider_ref          text,
  pending_payment_provider_ref  text,
  created_at                    timestamptz not null default now(),
  completed_at                  timestamptz,
  cancelled_at                  timestamptz,
  constraint platform_credit_topup_intents_amount_positive check (amount_kobo > 0)
);

create index platform_credit_topup_intents_patient_idx
  on public.platform_credit_topup_intents (patient_id, created_at desc);
create unique index platform_credit_topup_intents_pending_ref_unique
  on public.platform_credit_topup_intents (pending_payment_provider_ref) where pending_payment_provider_ref is not null;

alter table public.platform_credit_ledger_entries
  add constraint platform_credit_ledger_entries_topup_intent_fkey
  foreign key (topup_intent_id) references public.platform_credit_topup_intents (id) on delete set null;

-- ---------------------------------------------------------------------------
-- platform_credit_config — singleton. Suggested top-up amounts are exactly
-- what the founder asked for: ₦10k/20k/50k/100k, in kobo.
-- ---------------------------------------------------------------------------

create table public.platform_credit_config (
  id                       boolean primary key default true check (id),
  min_topup_kobo           bigint not null default 100000,      -- ₦1,000
  max_topup_kobo           bigint not null default 500000000,   -- ₦5,000,000 — a sane ceiling, admin-adjustable
  suggested_amounts_kobo   bigint[] not null default array[1000000, 2000000, 5000000, 10000000], -- ₦10k/20k/50k/100k
  updated_at               timestamptz not null default now()
);
insert into public.platform_credit_config (id) values (true) on conflict (id) do nothing;

create trigger platform_credit_config_set_updated_at
  before update on public.platform_credit_config
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Deliberately no INSERT/UPDATE/DELETE grant to `authenticated` on any
-- of these four tables — every write is via a SECURITY DEFINER function owned
-- by postgres, which does not consult RLS. See the migration header.
-- ---------------------------------------------------------------------------

alter table public.platform_credit_balances       enable row level security;
alter table public.platform_credit_ledger_entries  enable row level security;
alter table public.platform_credit_topup_intents   enable row level security;
alter table public.platform_credit_config          enable row level security;

create policy platform_credit_balances_select on public.platform_credit_balances
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy platform_credit_ledger_entries_select on public.platform_credit_ledger_entries
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy platform_credit_topup_intents_select on public.platform_credit_topup_intents
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or purchaser_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create policy platform_credit_config_select on public.platform_credit_config
  for select to authenticated using (true);
create policy platform_credit_config_update on public.platform_credit_config
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- This project's `alter default privileges ... grant ... to authenticated`
-- root-cause fix (see CLAUDE.md's "authenticated table grants" entry) means a
-- freshly created table is now born with full DML already granted to
-- `authenticated` by default — the opposite failure mode from the one that
-- fix closed, and exactly the attack surface
-- 20260905000123_service_purchases_insert_only_via_intent_rpc.sql removed
-- from service_purchases after the fact. Revoke it explicitly here, from the
-- start, rather than as a later patch.
revoke insert, update, delete on public.platform_credit_balances       from authenticated;
revoke insert, update, delete on public.platform_credit_ledger_entries  from authenticated;
revoke insert, update, delete on public.platform_credit_topup_intents   from authenticated;
revoke insert, delete         on public.platform_credit_config          from authenticated;

grant select on public.platform_credit_balances        to authenticated;
grant select on public.platform_credit_ledger_entries   to authenticated;
grant select on public.platform_credit_topup_intents    to authenticated;
grant select, update on public.platform_credit_config   to authenticated;

revoke all on public.platform_credit_balances       from anon;
revoke all on public.platform_credit_ledger_entries  from anon;
revoke all on public.platform_credit_topup_intents   from anon;
revoke all on public.platform_credit_config          from anon;

do $$
begin
  if has_table_privilege('authenticated', 'public.platform_credit_balances', 'INSERT') then
    raise exception 'FAIL: authenticated must not be able to insert platform_credit_balances directly';
  end if;
  if has_table_privilege('authenticated', 'public.platform_credit_ledger_entries', 'INSERT') then
    raise exception 'FAIL: authenticated must not be able to insert platform_credit_ledger_entries directly';
  end if;
  if has_table_privilege('authenticated', 'public.platform_credit_topup_intents', 'INSERT') then
    raise exception 'FAIL: authenticated must not be able to insert platform_credit_topup_intents directly';
  end if;
  if has_table_privilege('authenticated', 'public.platform_credit_balances', 'UPDATE') then
    raise exception 'FAIL: authenticated must not be able to update platform_credit_balances directly';
  end if;
  if has_table_privilege('authenticated', 'public.platform_credit_ledger_entries', 'DELETE') then
    raise exception 'FAIL: authenticated must not be able to delete platform_credit_ledger_entries directly';
  end if;
  if has_table_privilege('anon', 'public.platform_credit_balances', 'SELECT') then
    raise exception 'FAIL: anon must not read platform_credit_balances';
  end if;
  raise notice 'PASS: platform_credit core schema + hardened RLS in place';
end $$;
