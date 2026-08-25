-- Tarragon Health — a real way to pay a doctor for a video consult.
--
-- Tiers 1-3 are employed/salaried (docs/Tarragon_Health_Master_Operating_Plan_v4.md
-- §4/§8) — nothing here touches them. Tier 4 (Senior Registrar) and Tier 5
-- (Partner Specialist) are contracted/per-consult, and until now there was
-- no schema or payment rail for that at all: a completed paid video visit
-- generated platform revenue but never recorded what the platform owes the
-- doctor who actually took the call.
--
-- Rather than inventing a new payout rail, this plugs into the accounts-
-- payable machinery already built and tested (finance_vendors,
-- finance_bills, finance_create_bill/finance_approve_bill/finance_pay_bill —
-- 20260726120400_finance_accounts_payable.sql), the same reuse the
-- lab-partner liability work used (20260821191942/20260821192256): accrue a
-- liability per completed consult, settle it into an ordinary bill against
-- that SAME liability account (so approval clears it rather than
-- double-posting an expense), then approve/pay it through the existing WHT-
-- aware bill lifecycle — real, auditable, no new money-movement code.

insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, sort_order, description) values
  ('2750', 'Clinician fees payable — contracted', 'liability', 'credit', 'exempt', 46,
   'Per-consult fees owed to Tier 4/5 contracted doctors, accrued on consult completion, not yet paid.'),
  ('6300', 'Clinical staff fees — contracted', 'expense', 'debit', 'exempt', 84,
   'Per-consult fees expensed to Tier 4/5 contracted doctors.')
on conflict (code) do nothing;

do $$
begin
  if (select name from public.finance_accounts where code = '2750') <> 'Clinician fees payable — contracted' then
    raise exception 'account 2750 already exists under a different name — pick a free code instead of colliding with it (see CLAUDE.md''s chart-of-accounts collision lesson)';
  end if;
  if (select name from public.finance_accounts where code = '6300') <> 'Clinical staff fees — contracted' then
    raise exception 'account 6300 already exists under a different name — pick a free code instead of colliding with it';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Rate book: platform default (organisation_id null) with optional per-org
-- overrides, same override shape as video_visit_prices/cohort_cost_model_
-- constants. Constrained to the two contracted tiers — Tier 1-3 and Care
-- Coordinator are salaried and must never accrue a per-consult fee here.
-- ---------------------------------------------------------------------------
create table public.clinician_consult_rates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid references public.organisations (id) on delete cascade,
  doctor_tier      public.doctor_tier not null
    check (doctor_tier in ('tier_4_senior_registrar', 'tier_5_partner_specialist')),
  amount_minor     bigint not null check (amount_minor > 0),
  currency         public.currency not null default 'NGN',
  is_enabled       boolean not null default true,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null
);

create unique index clinician_consult_rates_org_tier_unique
  on public.clinician_consult_rates (organisation_id, doctor_tier)
  where organisation_id is not null;
create unique index clinician_consult_rates_default_tier_unique
  on public.clinician_consult_rates (doctor_tier)
  where organisation_id is null;

create trigger clinician_consult_rates_set_updated_at
  before update on public.clinician_consult_rates
  for each row execute function private.set_updated_at();

-- PLACEHOLDER launch rates — founder/finance to confirm or adjust (this
-- table is exactly what they'd edit to do that; no code change needed).
insert into public.clinician_consult_rates (organisation_id, doctor_tier, amount_minor, currency) values
  (null, 'tier_4_senior_registrar', 400000, 'NGN'),
  (null, 'tier_5_partner_specialist', 600000, 'NGN');

-- Pay rates are sensitive HR/compensation data — unlike video_visit_prices
-- (customer-facing pricing, open to any authenticated read), this is
-- finance/admin only, both to read and to write.
alter table public.clinician_consult_rates enable row level security;
create policy clinician_consult_rates_select on public.clinician_consult_rates
  for select to authenticated using (private.is_finance());
create policy clinician_consult_rates_write on public.clinician_consult_rates
  for all to authenticated using (private.is_finance()) with check (private.is_finance());
grant select, insert, update, delete on public.clinician_consult_rates to authenticated;

-- ---------------------------------------------------------------------------
-- The earnings ledger itself — one row per completed, fee-earning consult.
-- No insert/update/delete policy for `authenticated` at all: every write
-- happens through the completion trigger below or the settle/paid-sync
-- functions further down, all SECURITY DEFINER, same forge-proof shape as
-- video_visit_requests.accepted_by. A clinician session can read their own
-- rows (self-service "what have I earned") but can never write one.
-- ---------------------------------------------------------------------------
create table public.clinician_consult_earnings (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id       uuid not null references public.clinical_staff (id) on delete restrict,
  video_consultation_id   uuid not null references public.video_consultations (id) on delete restrict,
  doctor_tier_at_time     public.doctor_tier not null,
  amount_minor            bigint not null check (amount_minor >= 0),
  currency                public.currency not null default 'NGN',
  status                  text not null default 'accrued' check (status in ('accrued', 'billed', 'paid', 'void')),
  finance_bill_id         uuid references public.finance_bills (id) on delete set null,
  journal_entry_id        uuid references public.finance_journal_entries (id) on delete set null,
  accrued_at              timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint clinician_consult_earnings_one_per_consult unique (video_consultation_id)
);

create index clinician_consult_earnings_staff_idx
  on public.clinician_consult_earnings (clinical_staff_id, status);
create index clinician_consult_earnings_bill_idx
  on public.clinician_consult_earnings (finance_bill_id) where finance_bill_id is not null;

create trigger clinician_consult_earnings_set_updated_at
  before update on public.clinician_consult_earnings
  for each row execute function private.set_updated_at();

alter table public.clinician_consult_earnings enable row level security;
create policy clinician_consult_earnings_select on public.clinician_consult_earnings
  for select to authenticated
  using (
    private.is_finance()
    or clinical_staff_id in (
      select id from public.clinical_staff where profile_id = (select auth.uid())
    )
  );
grant select on public.clinician_consult_earnings to authenticated;

-- ---------------------------------------------------------------------------
-- Accrual: fires when a video_consultations row completes. Only the paid
-- video-visit product (a row in video_visit_requests pointing at it, with a
-- doctor who accepted it) can earn a fee — a consult opened for escalation
-- triage/specialist referral/annual review is ordinary duty for an employed
-- doctor, or (for a Tier 5) covered separately by the referral relationship,
-- not this per-visit product. A missing/disabled rate accrues nothing rather
-- than guessing an amount — same "never silently default" posture as
-- pin_video_visit_amount refusing an unpriced request outright, except here
-- the safe default is "accrue nothing, let ops notice and set a rate" since
-- refusing to complete a consult that already happened isn't an option.
-- ---------------------------------------------------------------------------
create or replace function private.accrue_clinician_consult_earning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
  v_staff record;
  v_rate record;
  v_earning_id uuid;
  v_journal uuid;
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then
    return new;
  end if;

  select r.accepted_by into v_request
  from public.video_visit_requests r
  where r.video_consultation_id = new.id
  limit 1;
  if v_request.accepted_by is null then
    return new;
  end if;

  select cs.id, cs.organisation_id, cs.doctor_tier, cs.full_name into v_staff
  from public.clinical_staff cs
  where cs.id = v_request.accepted_by;
  if v_staff.id is null
    or v_staff.doctor_tier not in ('tier_4_senior_registrar', 'tier_5_partner_specialist')
  then
    return new;
  end if;

  select amount_minor, currency into v_rate
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.clinician_consult_rates
    where organisation_id = v_staff.organisation_id and doctor_tier = v_staff.doctor_tier
    union all
    select amount_minor, currency, is_enabled, 1
    from public.clinician_consult_rates
    where organisation_id is null and doctor_tier = v_staff.doctor_tier
  ) r
  where r.is_enabled
  order by r.pri
  limit 1;
  if v_rate.amount_minor is null then
    return new;
  end if;

  insert into public.clinician_consult_earnings
    (organisation_id, clinical_staff_id, video_consultation_id, doctor_tier_at_time, amount_minor, currency)
  values
    (v_staff.organisation_id, v_staff.id, new.id, v_staff.doctor_tier, v_rate.amount_minor, v_rate.currency)
  on conflict (video_consultation_id) do nothing
  returning id into v_earning_id;
  if v_earning_id is null then
    return new;
  end if;

  v_journal := private.finance_post_journal(
    current_date, v_rate.currency, 'clinician_consult_earning', v_earning_id::text,
    'Clinician consult fee accrued — ' || v_staff.full_name,
    jsonb_build_array(
      jsonb_build_object('account_code', '6300', 'debit_minor', v_rate.amount_minor, 'credit_minor', 0),
      jsonb_build_object('account_code', '2750', 'debit_minor', 0, 'credit_minor', v_rate.amount_minor)),
    null);

  update public.clinician_consult_earnings set journal_entry_id = v_journal where id = v_earning_id;

  return new;
end;
$$;

create trigger video_consultations_accrue_clinician_earning
  after update on public.video_consultations
  for each row execute function private.accrue_clinician_consult_earning();

-- ---------------------------------------------------------------------------
-- Link a contracted clinician to their AP vendor record — additive column,
-- one vendor per clinician, auto-created by the settle function below the
-- first time they're paid rather than requiring finance to pre-provision one.
-- ---------------------------------------------------------------------------
alter table public.finance_vendors
  add column clinical_staff_id uuid references public.clinical_staff (id) on delete set null;
create unique index finance_vendors_clinical_staff_unique
  on public.finance_vendors (clinical_staff_id)
  where clinical_staff_id is not null;

-- ---------------------------------------------------------------------------
-- Settle: roll every 'accrued' earning for one clinician into a single bill,
-- expensed against 2750 itself — the same liability the accrual journal
-- credited — so finance_approve_bill's own Dr Expense/Cr AP journal debits
-- 2750 and clears it, instead of double-booking a second expense line (this
-- is exactly the SETTLE step the partner-lab liability work established;
-- see 20260821192256_partner_billing_reconcile_settle_refund.sql). A 5% WHT
-- default is Nigeria's standard rate for professional fees paid to an
-- individual contractor — finance can correct the vendor's rate before
-- approving if a specific clinician's circumstances differ.
-- ---------------------------------------------------------------------------
create or replace function public.finance_settle_clinician_earnings(
  p_clinical_staff_id uuid, p_bill_date date default current_date, p_due_date date default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record;
  v_vendor_id uuid;
  v_total bigint;
  v_currency public.currency;
  v_bill_id uuid;
begin
  if not private.finance_can('finance.vendors.manage') then
    raise exception 'not authorised';
  end if;

  select id, full_name into v_staff
  from public.clinical_staff where id = p_clinical_staff_id;
  if v_staff.id is null then
    raise exception 'clinician not found';
  end if;

  select coalesce(sum(amount_minor), 0), min(currency) into v_total, v_currency
  from public.clinician_consult_earnings
  where clinical_staff_id = p_clinical_staff_id and status = 'accrued';
  if v_total = 0 then
    raise exception 'no unbilled earnings for this clinician';
  end if;

  select id into v_vendor_id from public.finance_vendors where clinical_staff_id = p_clinical_staff_id;
  if v_vendor_id is null then
    insert into public.finance_vendors (name, vendor_type, wht_applicable, wht_rate_pct, clinical_staff_id)
    values (v_staff.full_name, 'clinician_contractor', true, 5, p_clinical_staff_id)
    returning id into v_vendor_id;
  end if;

  v_bill_id := public.finance_create_bill(
    v_vendor_id, coalesce(p_bill_date, current_date), p_due_date, v_currency::text, v_total,
    '2750', null, 'Contracted consult fees — ' || v_staff.full_name);

  update public.clinician_consult_earnings
    set status = 'billed', finance_bill_id = v_bill_id
    where clinical_staff_id = p_clinical_staff_id and status = 'accrued';

  return v_bill_id;
end;
$$;

revoke execute on function public.finance_settle_clinician_earnings(uuid, date, date) from public, anon;
grant execute on function public.finance_settle_clinician_earnings(uuid, date, date) to authenticated;

-- Earnings ledger tracks 'paid' the moment the bill they were settled into
-- is actually paid — closes the loop without ops needing to remember a
-- separate step once finance_pay_bill runs.
create or replace function private.mark_clinician_earnings_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    update public.clinician_consult_earnings
      set status = 'paid'
      where finance_bill_id = new.id and status = 'billed';
  end if;
  return new;
end;
$$;

create trigger finance_bills_mark_clinician_earnings_paid
  after update on public.finance_bills
  for each row execute function private.mark_clinician_earnings_paid();

do $$
begin
  if to_regclass('public.clinician_consult_earnings') is null then
    raise exception 'clinician_consult_earnings was not created';
  end if;
  if not exists (select 1 from pg_proc where proname = 'finance_settle_clinician_earnings') then
    raise exception 'finance_settle_clinician_earnings was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_vendors' and column_name = 'clinical_staff_id'
  ) then
    raise exception 'finance_vendors.clinical_staff_id was not added';
  end if;
end $$;
