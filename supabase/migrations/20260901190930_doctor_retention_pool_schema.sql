-- Tarragon Health
-- Diaspora doctor-retention pool — data model + admin tracking only.
--
-- Context: Japa (doctor emigration) is mostly a funding problem this platform
-- can't solve alone, but one buildable lever fits the shape already here —
-- the same diaspora hard-currency rail that funds a patient's Care Voucher
-- (see care_voucher_payments, sponsored-subscription-checkout.ts) can equally
-- fund a top-up for the domestic doctors who stay. This migration builds the
-- record-keeping only: a pledge from a diaspora sponsor, earmarked for
-- clinical staff retention, and an admin-recorded allocation of that pledge
-- to a named clinical_staff member for a named period.
--
-- Deliberately NOT built here, on founder instruction:
--   - No real payment collection (no Stripe/Paystack checkout, no
--     payment_transactions row). A pledge is recorded once an admin confirms
--     money actually arrived through the org's existing off-platform banking
--     (wire transfer etc.) — see collection_method/collection_reference.
--   - No automated payout/payroll integration. "Disbursed" is an admin
--     attestation that the top-up was paid through the org's normal payroll
--     process outside the platform, not a money-movement event.
--   - No forex conversion. Pledges are recorded in the currency actually
--     given (GBP or USD only — this is explicitly a hard-currency retention
--     lever, not another route into the NGN pricing system) at face value.
-- Paying real Nigerian-resident doctors in hard currency raises real
-- forex/tax/labour-law questions a solo founder needs to decide for
-- themself; this schema exists so those decisions have somewhere to land
-- once made, without this migration taking a position on any of them.
--
-- Modelled on the care_voucher schema's discipline (20260731215012 and
-- neighbours): every write goes through a SECURITY DEFINER RPC, no direct
-- INSERT/UPDATE/DELETE policy on either table, and status transitions are
-- one-directional except where a trigger explicitly reconciles a computed
-- state (pledge status vs. its allocations' balance).

create type public.doctor_retention_pledge_status as enum (
  'pledged',         -- sponsor has committed; funds not yet confirmed received
  'collected',       -- funds confirmed received off-platform; available to allocate
  'fully_allocated', -- the entire collected amount has been earmarked to staff top-ups
  'cancelled'
);

create type public.doctor_retention_allocation_status as enum (
  'allocated',  -- earmarked for a named clinical_staff member and period, not yet paid
  'disbursed',  -- admin has attested the top-up was actually paid, off-platform
  'cancelled'
);

create sequence if not exists public.doctor_retention_pledge_number_seq;

create table public.doctor_retention_pledges (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  pledge_number      text not null unique,

  -- The sponsor is often not a platform user at all (a diaspora donor who
  -- never signs up). sponsor_profile_id links it when they are one — e.g. an
  -- existing account_purpose='support' sponsor (20260801093000) — but stays
  -- optional; sponsor_name/sponsor_contact carry the record either way.
  sponsor_name       text not null,
  sponsor_profile_id uuid references public.profiles (id) on delete set null,
  sponsor_contact    text,

  currency           public.currency not null,
  amount_minor       bigint not null check (amount_minor > 0),

  status             public.doctor_retention_pledge_status not null default 'pledged',
  -- How the org actually confirmed the money arrived (wire transfer
  -- reference, a reconciled bank statement line, etc.) — a free-text record,
  -- not a payment integration.
  collection_method  text,
  collection_reference text,
  collected_at       timestamptz,
  cancelled_at       timestamptz,
  cancelled_reason   text,

  recorded_by        uuid not null references public.profiles (id) on delete restrict,
  note               text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint doctor_retention_pledges_hard_currency
    check (currency in ('GBP', 'USD')),
  constraint doctor_retention_pledges_collected_has_date
    check (status not in ('collected', 'fully_allocated') or collected_at is not null),
  constraint doctor_retention_pledges_cancelled_is_final
    check (status <> 'cancelled' or (cancelled_at is not null and cancelled_reason is not null))
);

create index doctor_retention_pledges_org_status_idx
  on public.doctor_retention_pledges (organisation_id, status);
create index doctor_retention_pledges_sponsor_profile_idx
  on public.doctor_retention_pledges (sponsor_profile_id) where sponsor_profile_id is not null;

create table public.doctor_retention_allocations (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  pledge_id              uuid not null references public.doctor_retention_pledges (id) on delete restrict,
  clinical_staff_id      uuid not null references public.clinical_staff (id) on delete restrict,

  period_start           date not null,
  period_end             date not null,
  -- Same currency as the parent pledge, by construction (see
  -- private.enforce_doctor_retention_allocation_balance) — deliberately no
  -- currency column here, so there is no column to drift out of sync.
  amount_minor           bigint not null check (amount_minor > 0),

  status                 public.doctor_retention_allocation_status not null default 'allocated',

  allocated_by           uuid not null references public.profiles (id) on delete restrict,
  allocated_at           timestamptz not null default now(),

  disbursed_by           uuid references public.profiles (id) on delete set null,
  disbursed_at           timestamptz,
  disbursement_reference text,

  cancelled_at           timestamptz,
  cancelled_reason       text,

  note                   text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint doctor_retention_allocations_period_order
    check (period_end >= period_start),
  constraint doctor_retention_allocations_disbursed_is_attested
    check (status <> 'disbursed' or (disbursed_at is not null and disbursed_by is not null)),
  constraint doctor_retention_allocations_cancelled_is_final
    check (status <> 'cancelled' or (cancelled_at is not null and cancelled_reason is not null)),
  -- Money already attested as paid cannot be un-cancelled back into the
  -- pool by mistake — a disbursed allocation is a closed record.
  constraint doctor_retention_allocations_no_disbursed_cancel
    check (not (status = 'cancelled' and disbursed_at is not null))
);

create index doctor_retention_allocations_pledge_idx
  on public.doctor_retention_allocations (pledge_id);
create index doctor_retention_allocations_staff_idx
  on public.doctor_retention_allocations (clinical_staff_id, status);

-- ---------------------------------------------------------------------------
-- Balance enforcement: the sum of every non-cancelled allocation against a
-- pledge can never exceed that pledge's amount_minor, and an allocation can
-- only be made against a pledge whose funds are actually confirmed collected.
-- A trigger, not a CHECK, because this compares one row against the sum of
-- its siblings.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_doctor_retention_allocation_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pledge public.doctor_retention_pledges%rowtype;
  v_staff_org uuid;
  v_allocated_elsewhere bigint;
begin
  select * into v_pledge from public.doctor_retention_pledges where id = new.pledge_id for update;
  if not found then
    raise exception 'doctor retention pledge not found';
  end if;
  if v_pledge.status not in ('collected', 'fully_allocated') then
    raise exception 'a pledge can only be allocated once its funds are confirmed collected'
      using errcode = '23514';
  end if;

  select organisation_id into v_staff_org from public.clinical_staff where id = new.clinical_staff_id;
  if v_staff_org is null or v_staff_org <> v_pledge.organisation_id then
    raise exception 'the clinical staff member must belong to the same organisation as the pledge'
      using errcode = '23514';
  end if;
  if new.organisation_id is distinct from v_pledge.organisation_id then
    raise exception 'organisation_id must match the parent pledge' using errcode = '23514';
  end if;

  select coalesce(sum(amount_minor), 0) into v_allocated_elsewhere
    from public.doctor_retention_allocations
    where pledge_id = new.pledge_id
      and status <> 'cancelled'
      and id is distinct from new.id;

  if v_allocated_elsewhere + new.amount_minor > v_pledge.amount_minor then
    raise exception 'this allocation would exceed the pledge''s remaining balance'
      using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger doctor_retention_allocations_balance_check
  before insert or update of amount_minor, status, pledge_id
  on public.doctor_retention_allocations
  for each row execute function private.enforce_doctor_retention_allocation_balance();

-- After any allocation change, reconcile the parent pledge's status against
-- its remaining balance — never touches a 'pledged' or 'cancelled' pledge.
create or replace function private.sync_doctor_retention_pledge_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pledge_id uuid := coalesce(new.pledge_id, old.pledge_id);
  v_pledge public.doctor_retention_pledges%rowtype;
  v_allocated bigint;
begin
  select * into v_pledge from public.doctor_retention_pledges where id = v_pledge_id for update;
  if not found or v_pledge.status not in ('collected', 'fully_allocated') then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount_minor), 0) into v_allocated
    from public.doctor_retention_allocations
    where pledge_id = v_pledge_id and status <> 'cancelled';

  if v_allocated >= v_pledge.amount_minor and v_pledge.status = 'collected' then
    update public.doctor_retention_pledges set status = 'fully_allocated' where id = v_pledge_id;
  elsif v_allocated < v_pledge.amount_minor and v_pledge.status = 'fully_allocated' then
    update public.doctor_retention_pledges set status = 'collected' where id = v_pledge_id;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger doctor_retention_allocations_sync_pledge_status
  after insert or update or delete
  on public.doctor_retention_allocations
  for each row execute function private.sync_doctor_retention_pledge_status();

create or replace function private.next_doctor_retention_pledge_number()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'TAR-DRP-' || lpad(nextval('public.doctor_retention_pledge_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- RLS. Compensation-adjacent data is more sensitive than a general org-staff
-- read — gated on the same permission as the write RPCs, not plain
-- is_org_staff. The one exception is a clinical_staff member reading their
-- own allocations (not other sponsors' pledges), for basic pay transparency.
-- ---------------------------------------------------------------------------

alter table public.doctor_retention_pledges enable row level security;
alter table public.doctor_retention_allocations enable row level security;

create policy doctor_retention_pledges_select on public.doctor_retention_pledges
  for select to authenticated
  using (private.is_admin() or private.has_permission('doctor_retention_pool.manage'));

create policy doctor_retention_allocations_select on public.doctor_retention_allocations
  for select to authenticated
  using (
    private.is_admin()
    or private.has_permission('doctor_retention_pool.manage')
    or exists (
      select 1 from public.clinical_staff cs
      where cs.id = doctor_retention_allocations.clinical_staff_id
        and cs.profile_id = (select auth.uid())
    )
  );

grant select on public.doctor_retention_pledges to authenticated;
grant select on public.doctor_retention_allocations to authenticated;

insert into public.permissions (key, label, category, description)
values (
  'doctor_retention_pool.manage',
  'Manage doctor retention pool',
  'Finance',
  'Record diaspora pledges earmarked for clinical staff retention top-ups and allocate them to named clinical staff'
)
on conflict (key) do nothing;

-- Fold the new tables into the standing row-change audit sweep
-- (20260812030853) — same generic trigger, same append-only public.audit_log.
create trigger audit_row_change_trg
  after insert or update or delete on public.doctor_retention_pledges
  for each row execute function private.audit_row_change();
create trigger audit_row_change_trg
  after insert or update or delete on public.doctor_retention_allocations
  for each row execute function private.audit_row_change();

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'doctor_retention_pledges' and cmd <> 'SELECT'
  ) then
    raise exception 'doctor_retention_pledges must have no write policy: writes go through definer RPCs only';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'doctor_retention_allocations' and cmd <> 'SELECT'
  ) then
    raise exception 'doctor_retention_allocations must have no write policy: writes go through definer RPCs only';
  end if;
  if not has_table_privilege('authenticated', 'public.doctor_retention_pledges', 'SELECT') then
    raise exception 'authenticated needs the base SELECT grant, RLS alone is not enough';
  end if;
  if not has_table_privilege('authenticated', 'public.doctor_retention_allocations', 'SELECT') then
    raise exception 'authenticated needs the base SELECT grant, RLS alone is not enough';
  end if;
  if not exists (select 1 from public.permissions where key = 'doctor_retention_pool.manage') then
    raise exception 'doctor_retention_pool.manage permission was not registered';
  end if;
  if (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where c.relname = 'doctor_retention_pledges' and tg.tgname = 'audit_row_change_trg'
        and not tg.tgisinternal) <> 1 then
    raise exception 'audit_row_change_trg missing or duplicated on doctor_retention_pledges';
  end if;
  if (select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where c.relname = 'doctor_retention_allocations' and tg.tgname = 'audit_row_change_trg'
        and not tg.tgisinternal) <> 1 then
    raise exception 'audit_row_change_trg missing or duplicated on doctor_retention_allocations';
  end if;
end $$;
