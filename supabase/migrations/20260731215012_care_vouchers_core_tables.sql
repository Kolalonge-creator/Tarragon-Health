-- Care Vouchers, part 2: core tables, config, immutability guards, RLS.
--
-- The four properties this schema has to make structurally true, not merely
-- promised in copy:
--   1. NON-TRANSFERABLE  — beneficiary_profile_id is immutable after insert
--      (trigger), and there is no transfer column, RPC or policy anywhere.
--   2. SINGLE-PURPOSE    — a prepaid voucher carries a panel_bundle_id and is
--      redeemable only against an order for that same bundle. Enforced in the
--      redemption RPC (part 4), never as a balance comparison.
--   3. NEVER CASH-REDEEMABLE — no path debits a voucher to anything but a
--      Tarragon order. Cancellation exists for staff, and deliberately does
--      not move money; any refund is an out-of-band provider refund against
--      the original charge, so it returns to the card that paid.
--   4. EXPIRY — 24 months by default, admin-configurable, extendable on
--      request. Deliberately not shorter: the FCCPC would not look kindly on
--      an aggressive forfeiture window, and a long window is also the honest
--      answer for a health product somebody may be saving toward.
--
-- No user INSERT/UPDATE/DELETE policy exists on any table here. Every write
-- goes through a SECURITY DEFINER RPC, the same discipline payment_transactions
-- and wallet_ledger already used.

create table public.care_voucher_config (
  id                     boolean primary key default true check (id),
  validity_months        integer not null default 24 check (validity_months between 1 and 120),
  max_extensions         integer not null default 2 check (max_extensions >= 0),
  extension_months       integer not null default 12 check (extension_months between 1 and 60),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles (id)
);

insert into public.care_voucher_config (id) values (true) on conflict (id) do nothing;

create sequence if not exists public.care_voucher_number_seq;

create table public.care_vouchers (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  voucher_number         text not null unique,
  kind                   public.care_voucher_kind not null,

  -- Who the care is for. Immutable: see enforce_care_voucher_immutability.
  beneficiary_profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Who paid. NULL for reward vouchers precisely because nobody paid for
  -- them — that null is what keeps promotional credit out of the customer
  -- money accounting.
  purchaser_profile_id   uuid references public.profiles (id) on delete set null,

  -- The SKU. A prepaid voucher IS this service, it is not money that happens
  -- to be worth this much.
  panel_bundle_id        uuid references public.panel_bundles (id) on delete restrict,
  sku_code               text,
  sku_name               text,

  face_value_kobo        bigint not null check (face_value_kobo > 0),
  amount_paid_kobo       bigint not null default 0 check (amount_paid_kobo >= 0),

  status                 public.care_voucher_status not null default 'reserved',
  expires_at             timestamptz,
  activated_at           timestamptz,
  redeemed_at            timestamptz,
  cancelled_at           timestamptz,
  cancelled_reason       text,
  redeemed_order_type    public.commission_type,
  redeemed_order_id      uuid,
  extension_count        integer not null default 0 check (extension_count >= 0),
  gift_message           text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint care_vouchers_paid_within_face check (amount_paid_kobo <= face_value_kobo),

  -- A bought voucher names a service and a payer; a granted one does neither.
  constraint care_vouchers_kind_shape check (
    (kind = 'prepaid_service'
       and panel_bundle_id is not null
       and purchaser_profile_id is not null
       and sku_code is not null)
    or
    (kind = 'reward_discount'
       and panel_bundle_id is null
       and purchaser_profile_id is null)
  ),

  -- A prepaid voucher may only be redeemable once it is actually paid for.
  constraint care_vouchers_active_is_paid check (
    kind <> 'prepaid_service'
    or status not in ('active', 'redeemed')
    or amount_paid_kobo = face_value_kobo
  ),

  constraint care_vouchers_redeemed_has_order check (
    status <> 'redeemed' or (redeemed_order_id is not null and redeemed_at is not null)
  )
);

create index care_vouchers_beneficiary_idx
  on public.care_vouchers (beneficiary_profile_id, status, expires_at);
create index care_vouchers_purchaser_idx
  on public.care_vouchers (purchaser_profile_id) where purchaser_profile_id is not null;
create index care_vouchers_expiry_sweep_idx
  on public.care_vouchers (expires_at) where status = 'active';

-- Instalments toward ONE named voucher ("pay small small"). This is layaway
-- against a specific product, not a growing balance: the money is only ever
-- attached to voucher_id, and the voucher only becomes redeemable at
-- amount_paid_kobo = face_value_kobo.
create table public.care_voucher_payments (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  voucher_id             uuid not null references public.care_vouchers (id) on delete cascade,
  payer_profile_id       uuid not null references public.profiles (id) on delete restrict,
  amount_minor           bigint not null check (amount_minor > 0),
  currency               text not null default 'NGN' check (currency in ('NGN', 'GBP', 'USD')),
  credit_kobo            bigint not null check (credit_kobo > 0),
  provider               public.payment_provider,
  pending_provider_ref   text,
  status                 text not null default 'pending' check (status in ('pending', 'applied', 'failed')),
  payment_transaction_id uuid references public.payment_transactions (id),
  created_at             timestamptz not null default now()
);

create index care_voucher_payments_voucher_idx on public.care_voucher_payments (voucher_id);
create unique index care_voucher_payments_pending_ref_idx
  on public.care_voucher_payments (pending_provider_ref) where pending_provider_ref is not null;

-- Append-only lifecycle audit. Exists so the whole life of every naira a
-- patient prepaid can be shown end to end without reconstructing it from
-- column history.
create table public.care_voucher_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  voucher_id       uuid not null references public.care_vouchers (id) on delete cascade,
  event_type       public.care_voucher_event_type not null,
  actor_profile_id uuid references public.profiles (id) on delete restrict,
  amount_kobo      bigint,
  note             text,
  created_at       timestamptz not null default now()
);

create index care_voucher_events_voucher_idx on public.care_voucher_events (voucher_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Immutability: the non-transferability guarantee, structural rather than
-- conventional. Also pins the commercial terms of a sold voucher so neither a
-- client nor a later bug can restate what somebody bought.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_care_voucher_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.beneficiary_profile_id is distinct from old.beneficiary_profile_id then
    raise exception 'A care voucher cannot be transferred to another person'
      using errcode = '23514';
  end if;
  if new.kind is distinct from old.kind
     or new.panel_bundle_id is distinct from old.panel_bundle_id
     or new.face_value_kobo is distinct from old.face_value_kobo
     or new.purchaser_profile_id is distinct from old.purchaser_profile_id
     or new.voucher_number is distinct from old.voucher_number then
    raise exception 'The terms of an issued voucher cannot be changed'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger care_vouchers_immutability
  before update on public.care_vouchers
  for each row execute function private.enforce_care_voucher_immutability();

create or replace function private.next_voucher_number()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'TAR-VCH-' || lpad(nextval('public.care_voucher_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- RLS. Read for the people with a real stake; every write via definer RPC.
-- ---------------------------------------------------------------------------

alter table public.care_vouchers enable row level security;
alter table public.care_voucher_payments enable row level security;
alter table public.care_voucher_events enable row level security;
alter table public.care_voucher_config enable row level security;

-- The purchaser is named here so a sponsor can see the gift they bought
-- without needing any grant over the beneficiary's record. A gift receipt is
-- not clinical access.
create policy care_vouchers_select on public.care_vouchers
  for select to authenticated
  using (
    beneficiary_profile_id = (select auth.uid())
    or purchaser_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = care_vouchers.beneficiary_profile_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy care_voucher_payments_select on public.care_voucher_payments
  for select to authenticated
  using (
    payer_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.care_vouchers v
      where v.id = care_voucher_payments.voucher_id
        and v.beneficiary_profile_id = (select auth.uid())
    )
  );

create policy care_voucher_events_select on public.care_voucher_events
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.care_vouchers v
      where v.id = care_voucher_events.voucher_id
        and (v.beneficiary_profile_id = (select auth.uid())
             or v.purchaser_profile_id = (select auth.uid()))
    )
  );

create policy care_voucher_config_select on public.care_voucher_config
  for select to authenticated using (true);

create policy care_voucher_config_update on public.care_voucher_config
  for update to authenticated
  using (private.is_admin() or private.has_permission('vouchers.manage'))
  with check (private.is_admin() or private.has_permission('vouchers.manage'));

grant select on public.care_vouchers to authenticated;
grant select on public.care_voucher_payments to authenticated;
grant select on public.care_voucher_events to authenticated;
grant select, update on public.care_voucher_config to authenticated;

insert into public.permissions (key, label, category, description)
values ('vouchers.manage', 'Manage care vouchers', 'Commercial',
        'Extend voucher expiry, cancel vouchers, and edit voucher settings')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'care_vouchers_immutability') then
    raise exception 'the non-transferability trigger was not attached';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'care_vouchers' and cmd <> 'SELECT'
  ) then
    raise exception 'care_vouchers must have no write policy: writes go through definer RPCs only';
  end if;
  if not has_table_privilege('authenticated', 'public.care_vouchers', 'SELECT') then
    raise exception 'authenticated needs the base SELECT grant, RLS alone is not enough';
  end if;
end $$;;
