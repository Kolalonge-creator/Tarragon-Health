-- Tarragon Health
-- Group/community screening days — "bring your church, market association,
-- cooperative, or SME office and get a discounted rate." Raised directly by a
-- founder growth pitch and scoped 2026-08-29 (see
-- docs/DIASPORA_HEALTH_CHECK_BUSINESS_MODEL_RECONCILIATION.md §2 for the full
-- reasoning). Founder decisions this migration implements:
--   - Either a self-serve request (any authenticated user submits one) or an
--     ops-created one (staff sets it up after a phone/WhatsApp negotiation) —
--     modelled as one request path rather than two, since a request row is
--     the same shape either way.
--   - A flat percentage discount off an existing self-bookable panel bundle,
--     not a separately negotiated per-event SKU.
--   - One payer covers the whole cohort upfront — matches the pitch's own
--     "cash upfront, no procurement cycle" framing.
--   - Phlebotomist dispatch stays a manual ops task outside the app, same as
--     lab-order transmission to Synlab already works today
--     (public.mark_lab_order_transmitted records a reference; nothing
--     automated contacts the lab).
--
-- Deliberately reuses public.care_vouchers for the actual per-attendee
-- entitlement rather than inventing a second prepaid-service concept: once an
-- attendee has a real Tarragon profile, they are issued one ordinary,
-- non-transferable, single-purpose, price-frozen voucher through the exact
-- machinery every other voucher already uses
-- (20260731215012_care_vouchers_core_tables.sql) — already fully paid,
-- because the group's bulk payment covers it. This does not weaken the
-- voucher's non-transferability guarantee: each one is still issued to one
-- named, real beneficiary and immutable from that point on; it only changes
-- where the money came from. This migration only adds the group-level
-- bookkeeping a voucher has no shape for: one event, one discounted price,
-- one bulk payment funding many vouchers at once.

create type public.screening_day_status as enum ('requested', 'confirmed', 'completed', 'cancelled');
create type public.screening_day_slot_status as enum ('unclaimed', 'issued', 'removed');

create table public.screening_days (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  requested_by          uuid not null references public.profiles (id) on delete restrict,

  -- The event. host_name/contact_phone name the actual community contact
  -- (a church, association, or SME), which is not the same thing as
  -- requested_by when staff lodge the request on a group's behalf.
  host_name             text not null check (length(trim(host_name)) > 0),
  contact_phone         text,
  location              text not null check (length(trim(location)) > 0),
  event_date            date not null,

  -- The SKU. Always an existing self-bookable panel bundle, priced from the
  -- same catalogue every individual patient books from — a screening day is a
  -- discount on a real product, never a separate price list.
  panel_bundle_id       uuid not null references public.panel_bundles (id) on delete restrict,

  slots_requested       integer not null check (slots_requested > 0),

  -- Everything below is null until private.confirm_screening_day freezes it —
  -- see screening_days_confirmed_has_pricing.
  slots_confirmed       integer check (slots_confirmed > 0),
  discount_percent      numeric(5,2) check (discount_percent >= 0 and discount_percent < 100),
  price_per_head_kobo   bigint check (price_per_head_kobo > 0),
  total_kobo            bigint check (total_kobo > 0),
  payer_profile_id      uuid references public.profiles (id) on delete restrict,

  status                public.screening_day_status not null default 'requested',
  amount_paid_kobo      bigint not null default 0 check (amount_paid_kobo >= 0),
  notes                 text,
  confirmed_by          uuid references public.profiles (id) on delete set null,
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint screening_days_paid_within_total check (total_kobo is null or amount_paid_kobo <= total_kobo),
  constraint screening_days_confirmed_has_pricing check (
    status = 'requested'
    or (slots_confirmed is not null and discount_percent is not null
        and price_per_head_kobo is not null and total_kobo is not null
        and payer_profile_id is not null)
  )
);

comment on column public.screening_days.slots_requested is
  'What the requester asked for. Distinct from slots_confirmed (what was actually agreed and priced) so a request never silently restates itself.';

create index screening_days_requested_by_idx on public.screening_days (requested_by);
create index screening_days_payer_idx on public.screening_days (payer_profile_id) where payer_profile_id is not null;
create index screening_days_org_status_idx on public.screening_days (organisation_id, status);

-- Attendees. Pre-registered by name/phone the same way employer_roster_members
-- already does (20260715162958_employer_roster_members.sql) — most attendees
-- will not have a Tarragon account yet at the point a screening day is paid
-- for, so a slot has to be able to exist before a profile does.
create table public.screening_day_slots (
  id                     uuid primary key default gen_random_uuid(),
  screening_day_id       uuid not null references public.screening_days (id) on delete cascade,
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  full_name              text,
  phone                  text,
  status                 public.screening_day_slot_status not null default 'unclaimed',
  beneficiary_profile_id uuid references public.profiles (id) on delete set null,
  voucher_id             uuid references public.care_vouchers (id) on delete set null,
  added_by               uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),

  constraint screening_day_slots_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint screening_day_slots_issued_has_voucher check (
    status <> 'issued' or (beneficiary_profile_id is not null and voucher_id is not null)
  )
);

create index screening_day_slots_day_idx on public.screening_day_slots (screening_day_id, status);
create unique index screening_day_slots_day_phone_idx
  on public.screening_day_slots (screening_day_id, phone) where phone is not null;

-- Bulk payment ledger, same layaway shape as care_voucher_payments
-- (20260731215226_care_vouchers_purchase_and_layaway.sql): money is only ever
-- attached to one screening_day_id, and slots/vouchers cannot be issued until
-- amount_paid_kobo reaches total_kobo. A single lump payment is the expected
-- case, but nothing here forces it into exactly one charge.
create table public.screening_day_payments (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  screening_day_id       uuid not null references public.screening_days (id) on delete cascade,
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

create index screening_day_payments_day_idx on public.screening_day_payments (screening_day_id);
create unique index screening_day_payments_pending_ref_idx
  on public.screening_day_payments (pending_provider_ref) where pending_provider_ref is not null;

-- ---------------------------------------------------------------------------
-- RLS. Read for the people with a real stake; every write via definer RPC,
-- same discipline care_vouchers already uses.
-- ---------------------------------------------------------------------------

alter table public.screening_days enable row level security;
alter table public.screening_day_slots enable row level security;
alter table public.screening_day_payments enable row level security;

create policy screening_days_select on public.screening_days
  for select to authenticated
  using (
    requested_by = (select auth.uid())
    or payer_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create policy screening_day_slots_select on public.screening_day_slots
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.screening_days sd
      where sd.id = screening_day_slots.screening_day_id
        and (sd.requested_by = (select auth.uid()) or sd.payer_profile_id = (select auth.uid()))
    )
  );

create policy screening_day_payments_select on public.screening_day_payments
  for select to authenticated
  using (
    payer_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.screening_days to authenticated;
grant select on public.screening_day_slots to authenticated;
grant select on public.screening_day_payments to authenticated;

insert into public.permissions (key, label, category, description)
values ('screening_days.manage', 'Manage group screening days', 'Commercial',
        'Confirm a screening-day request, set its discounted price, and issue attendee vouchers once it is paid')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Request: self-serve or staff-lodged, same function either way.
-- ---------------------------------------------------------------------------

create or replace function public.request_screening_day(
  p_host_name text,
  p_contact_phone text,
  p_location text,
  p_event_date date,
  p_panel_bundle_id uuid,
  p_slots_requested integer,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_bundle public.panel_bundles%rowtype;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_slots_requested is null or p_slots_requested <= 0 then
    raise exception 'how many people are coming?';
  end if;
  if p_event_date is null or p_event_date <= current_date then
    raise exception 'the event date must be in the future';
  end if;
  if p_host_name is null or length(trim(p_host_name)) = 0 then
    raise exception 'who is this screening day for?';
  end if;
  if p_location is null or length(trim(p_location)) = 0 then
    raise exception 'where will this happen?';
  end if;

  select * into v_bundle from public.panel_bundles where id = p_panel_bundle_id;
  if not found or not v_bundle.self_bookable or not v_bundle.is_active then
    raise exception 'that screening package is not available to book';
  end if;

  select organisation_id into v_org from public.profiles where id = v_caller;

  insert into public.screening_days (
    organisation_id, requested_by, host_name, contact_phone, location,
    event_date, panel_bundle_id, slots_requested, notes
  ) values (
    coalesce(v_org, '00000000-0000-0000-0000-000000000001'), v_caller,
    trim(p_host_name), nullif(trim(coalesce(p_contact_phone, '')), ''), trim(p_location),
    p_event_date, v_bundle.id, p_slots_requested, nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'screening_day_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirm: staff freeze the discounted price and open it for payment. Gated
-- on the commercial permission, not blanket care-team staff — this sets a
-- real price, unlike most of what is_org_staff otherwise covers.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_screening_day(
  p_screening_day_id uuid,
  p_slots_confirmed integer,
  p_discount_percent numeric,
  p_payer_profile_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_day public.screening_days%rowtype;
  v_bundle public.panel_bundles%rowtype;
  v_price_per_head bigint;
  v_total bigint;
  v_payer uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('screening_days.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_day from public.screening_days where id = p_screening_day_id for update;
  if not found then raise exception 'screening day not found'; end if;
  if v_day.status <> 'requested' then
    raise exception 'only a requested screening day can be confirmed';
  end if;
  if p_slots_confirmed is null or p_slots_confirmed <= 0 then
    raise exception 'confirm at least one slot';
  end if;
  if p_discount_percent is null or p_discount_percent < 0 or p_discount_percent >= 100 then
    raise exception 'discount must be between 0 and 100';
  end if;

  select * into v_bundle from public.panel_bundles where id = v_day.panel_bundle_id;
  if not found or not v_bundle.self_bookable or not v_bundle.is_active or v_bundle.price_kobo is null then
    raise exception 'that screening package is no longer available to book';
  end if;

  v_price_per_head := round(v_bundle.price_kobo * (1 - p_discount_percent / 100.0));
  v_total := v_price_per_head * p_slots_confirmed;
  v_payer := coalesce(p_payer_profile_id, v_day.requested_by);

  update public.screening_days
     set slots_confirmed     = p_slots_confirmed,
         discount_percent    = p_discount_percent,
         price_per_head_kobo = v_price_per_head,
         total_kobo          = v_total,
         payer_profile_id    = v_payer,
         status              = 'confirmed',
         confirmed_by        = v_caller,
         confirmed_at        = now(),
         updated_at          = now()
   where id = p_screening_day_id;

  return jsonb_build_object('ok', true, 'price_per_head_kobo', v_price_per_head, 'total_kobo', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment: record an intent before checkout, apply it from the same
-- payment_transactions webhook path every other product already uses. No
-- Edge Function edit needed — the deployed webhooks already write every
-- verified charge into payment_transactions before branching on
-- metadata.kind.
-- ---------------------------------------------------------------------------

create or replace function public.record_screening_day_payment_intent(
  p_screening_day uuid,
  p_amount_minor bigint,
  p_currency text,
  p_credit_kobo bigint,
  p_provider public.payment_provider,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_day public.screening_days%rowtype;
  v_outstanding bigint;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_day from public.screening_days where id = p_screening_day for update;
  if not found then raise exception 'screening day not found'; end if;
  if v_day.status <> 'confirmed' then
    raise exception 'this screening day is not ready for payment';
  end if;
  if v_day.payer_profile_id <> v_caller and not private.is_org_staff(v_day.organisation_id) then
    raise exception 'only the named payer can pay for this screening day' using errcode = '42501';
  end if;

  v_outstanding := v_day.total_kobo - v_day.amount_paid_kobo
                   - coalesce((select sum(credit_kobo) from public.screening_day_payments
                               where screening_day_id = p_screening_day and status = 'pending'), 0);

  if p_credit_kobo <= 0 then raise exception 'amount must be positive'; end if;
  if p_credit_kobo > v_outstanding then
    raise exception 'that is more than is outstanding for this screening day';
  end if;

  insert into public.screening_day_payments (
    organisation_id, screening_day_id, payer_profile_id,
    amount_minor, currency, credit_kobo, provider, pending_provider_ref, status
  ) values (
    v_day.organisation_id, p_screening_day, v_caller,
    p_amount_minor, p_currency, p_credit_kobo, p_provider, p_reference, 'pending'
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function private.apply_screening_day_payment_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_pay public.screening_day_payments%rowtype;
  v_day public.screening_days%rowtype;
  v_new_paid bigint;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'screening_day_payment' then return new; end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then return new; end if;

  select * into v_pay from public.screening_day_payments
   where pending_provider_ref = v_ref and status = 'pending' for update;
  if not found then return new; end if;

  select * into v_day from public.screening_days where id = v_pay.screening_day_id for update;
  if not found then return new; end if;

  v_new_paid := least(v_day.amount_paid_kobo + v_pay.credit_kobo, v_day.total_kobo);

  update public.screening_days set amount_paid_kobo = v_new_paid, updated_at = now() where id = v_day.id;

  update public.screening_day_payments
     set status = 'applied', payment_transaction_id = new.id
   where id = v_pay.id;

  return new;
end;
$$;

create trigger payment_transactions_apply_screening_day_payment
  after insert on public.payment_transactions
  for each row execute function private.apply_screening_day_payment_from_transaction();

-- ---------------------------------------------------------------------------
-- Attendees: register ahead of time or on the day, then issue each one their
-- own named voucher once they have a real profile to receive it.
-- ---------------------------------------------------------------------------

create or replace function public.add_screening_day_slot(
  p_screening_day_id uuid,
  p_full_name text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_day public.screening_days%rowtype;
  v_count integer;
  v_phone text;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_day from public.screening_days where id = p_screening_day_id for update;
  if not found then raise exception 'screening day not found'; end if;
  if v_day.status <> 'confirmed' then
    raise exception 'this screening day is not confirmed yet';
  end if;
  if v_day.total_kobo is null or v_day.amount_paid_kobo < v_day.total_kobo then
    raise exception 'this screening day has not been paid for in full yet';
  end if;
  if v_caller <> v_day.requested_by and v_caller <> v_day.payer_profile_id
     and not private.is_org_staff(v_day.organisation_id) then
    raise exception 'not authorised for this screening day' using errcode = '42501';
  end if;

  select count(*) into v_count from public.screening_day_slots
   where screening_day_id = p_screening_day_id and status <> 'removed';
  if v_count >= v_day.slots_confirmed then
    raise exception 'every paid slot for this screening day is already taken';
  end if;

  v_phone := case
    when p_phone is null or trim(p_phone) = '' then null
    when p_phone ~ '^\+' then trim(p_phone)
    else '+' || trim(p_phone)
  end;

  insert into public.screening_day_slots (
    screening_day_id, organisation_id, full_name, phone, added_by
  ) values (
    p_screening_day_id, v_day.organisation_id,
    nullif(trim(coalesce(p_full_name, '')), ''), v_phone, v_caller
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.issue_screening_day_voucher(
  p_slot_id uuid,
  p_beneficiary_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_slot public.screening_day_slots%rowtype;
  v_day public.screening_days%rowtype;
  v_bundle public.panel_bundles%rowtype;
  v_beneficiary_org uuid;
  v_months integer;
  v_number text;
  v_voucher_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_slot from public.screening_day_slots where id = p_slot_id for update;
  if not found then raise exception 'slot not found'; end if;
  if v_slot.status <> 'unclaimed' then
    raise exception 'this slot has already been issued';
  end if;

  select * into v_day from public.screening_days where id = v_slot.screening_day_id for update;
  if not found then raise exception 'screening day not found'; end if;
  if not (private.is_admin() or private.has_permission('screening_days.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if v_day.total_kobo is null or v_day.amount_paid_kobo < v_day.total_kobo then
    raise exception 'this screening day has not been paid for in full yet';
  end if;

  select organisation_id into v_beneficiary_org from public.profiles where id = p_beneficiary_profile_id;
  if v_beneficiary_org is null then raise exception 'that person has no Tarragon account yet'; end if;

  select * into v_bundle from public.panel_bundles where id = v_day.panel_bundle_id;
  if not found then raise exception 'that screening package no longer exists'; end if;

  select validity_months into v_months from public.care_voucher_config where id = true;
  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    panel_bundle_id, sku_code, sku_name,
    face_value_kobo, amount_paid_kobo, status, activated_at, expires_at, gift_message
  ) values (
    v_beneficiary_org, v_number, 'prepaid_service',
    p_beneficiary_profile_id, v_day.payer_profile_id,
    v_bundle.id, v_bundle.code, v_bundle.name,
    v_day.price_per_head_kobo, v_day.price_per_head_kobo, 'active', now(),
    now() + make_interval(months => v_months),
    'Screening day: ' || v_day.host_name
  )
  returning id into v_voucher_id;

  insert into public.care_voucher_events (organisation_id, voucher_id, event_type, actor_profile_id, note)
  values (v_beneficiary_org, v_voucher_id, 'created', v_caller,
          'Issued from the ' || v_day.host_name || ' screening day');

  update public.screening_day_slots
     set status = 'issued', beneficiary_profile_id = p_beneficiary_profile_id, voucher_id = v_voucher_id
   where id = p_slot_id;

  return jsonb_build_object('ok', true, 'voucher_id', v_voucher_id, 'voucher_number', v_number);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. anon gets nothing — same anon-inherits-via-PUBLIC gotcha this
-- codebase has re-broken before: Supabase grants EXECUTE directly to anon via
-- a default-privileges setting independent of the PUBLIC pseudo-role, so
-- revoking from public alone is not enough — anon must be revoked explicitly
-- too (see feedback_supabase_anon_execute_gotcha memory, and
-- 20260803165959_emergency_card_hardening.sql's own comment).
-- ---------------------------------------------------------------------------

revoke all on function public.request_screening_day(text, text, text, date, uuid, integer, text) from public;
revoke all on function public.request_screening_day(text, text, text, date, uuid, integer, text) from anon;
revoke all on function public.confirm_screening_day(uuid, integer, numeric, uuid) from public;
revoke all on function public.confirm_screening_day(uuid, integer, numeric, uuid) from anon;
revoke all on function public.record_screening_day_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from public;
revoke all on function public.record_screening_day_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) from anon;
revoke all on function public.add_screening_day_slot(uuid, text, text) from public;
revoke all on function public.add_screening_day_slot(uuid, text, text) from anon;
revoke all on function public.issue_screening_day_voucher(uuid, uuid) from public;
revoke all on function public.issue_screening_day_voucher(uuid, uuid) from anon;

grant execute on function public.request_screening_day(text, text, text, date, uuid, integer, text) to authenticated;
grant execute on function public.confirm_screening_day(uuid, integer, numeric, uuid) to authenticated;
grant execute on function public.record_screening_day_payment_intent(uuid, bigint, text, bigint, public.payment_provider, text) to authenticated;
grant execute on function public.add_screening_day_slot(uuid, text, text) to authenticated;
grant execute on function public.issue_screening_day_voucher(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — proved, not assumed.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('screening_days', 'screening_day_slots', 'screening_day_payments')
      and cmd <> 'SELECT'
  ) then
    raise exception 'these tables must have no write policy: writes go through definer RPCs only';
  end if;

  if not has_table_privilege('authenticated', 'public.screening_days', 'SELECT')
     or not has_table_privilege('authenticated', 'public.screening_day_slots', 'SELECT')
     or not has_table_privilege('authenticated', 'public.screening_day_payments', 'SELECT') then
    raise exception 'authenticated needs the base SELECT grant, RLS alone is not enough';
  end if;

  if has_function_privilege('anon', 'public.request_screening_day(text,text,text,date,uuid,integer,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_screening_day(uuid,integer,numeric,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_screening_day_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.add_screening_day_slot(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.issue_screening_day_voucher(uuid,uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to request, confirm, pay for, or issue a screening day voucher';
  end if;

  if not has_function_privilege('authenticated', 'public.request_screening_day(text,text,text,date,uuid,integer,text)', 'EXECUTE') then
    raise exception 'any authenticated user must be able to self-serve request a screening day';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'payment_transactions_apply_screening_day_payment') then
    raise exception 'the screening-day payment trigger was not attached';
  end if;

  if not exists (select 1 from public.permissions where key = 'screening_days.manage') then
    raise exception 'the screening_days.manage permission was not seeded';
  end if;
end $$;
