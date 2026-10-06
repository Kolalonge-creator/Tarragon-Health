-- S25: catalogue, prices, orders, payments and the first entitlement row (spec 4.8, safety case 24, docs/design/S25.md).
--
-- Beside the live per-domain purchase tables (OQ-23: live wins for commerce), not on top of them. Nothing here touches
-- payment_transactions or any legacy trigger. A v5 order is paid in exactly one place, public.record_order_payment(), which is
-- service-role only and idempotent on the Paystack reference. Money is bigint kobo (INV-15); no balance of any kind (INV-09);
-- prices are versioned and immutable (INV-16); test orders are flagged (INV-13); sales are dormant until the platform module
-- v5_checkout is switched on and, for a care pack or membership, until a lead clinician has a free slot (INV-14, OQ-127).
-- Live counts before this migration: none of these five names existed, so there is nothing to convert.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.catalog_items (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  code             text not null check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  kind             text not null check (kind in ('consultation', 'care_pack', 'lab_panel', 'membership')),
  name_key         text not null,
  description_key  text not null,
  included_keys    text[] not null default '{}',
  duration_days    integer check (duration_days is null or duration_days between 1 and 800),
  uses             integer check (uses is null or uses between 1 and 1000),
  grants_lead      boolean not null default false,
  active           boolean not null default false,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, code),
  check (kind not in ('care_pack', 'membership') or duration_days is not null),
  check (kind <> 'consultation' or uses is not null)
);
alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from public, anon, authenticated;
-- No table grant: notes, price reasons and staff ids are internal. Patients read the catalogue() function, staff admin_catalogue().

create table public.prices (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  catalog_item_id  uuid not null references public.catalog_items (id) on delete restrict,
  amount_kobo      bigint not null check (amount_kobo > 0 and amount_kobo <= 100000000000),
  components       jsonb not null default '{}'::jsonb check (jsonb_typeof(components) = 'object'),
  valid_from       timestamptz not null default now(),
  valid_to         timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  reason           text,
  created_at       timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (catalog_item_id with =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz)) with &&)
);
alter table public.prices enable row level security;
revoke all on public.prices from public, anon, authenticated;

-- A price is a fact about a time range: only its end can be set, once. Nothing deletes one.
create function private.prices_immutable() returns trigger language plpgsql set search_path = '' as $$
declare k text; v bigint; s bigint := 0;
begin
  if tg_op = 'DELETE' then raise exception 'price_immutable' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then
    if new.amount_kobo is distinct from old.amount_kobo or new.components is distinct from old.components
       or new.catalog_item_id is distinct from old.catalog_item_id or new.valid_from is distinct from old.valid_from
       or new.organisation_id is distinct from old.organisation_id or old.valid_to is not null then
      raise exception 'price_immutable' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- insert: an itemised split must add up to the price (19.7), and every part is whole kobo
  if new.components <> '{}'::jsonb then
    for k, v in select key, (value #>> '{}')::bigint from jsonb_each(new.components) loop
      if v < 0 then raise exception 'price_components_invalid' using errcode = '22023'; end if;
      s := s + v;
    end loop;
    if s <> new.amount_kobo then raise exception 'price_components_must_sum' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
create trigger prices_immutable before insert or update or delete on public.prices
  for each row execute function private.prices_immutable();

-- ---------------------------------------------------------------------------
-- Orders, payments, entitlements
-- ---------------------------------------------------------------------------
create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  buyer_profile_id       uuid not null references public.profiles (id) on delete restrict,
  beneficiary_patient_id uuid not null references public.profiles (id) on delete restrict,
  catalog_item_id        uuid not null references public.catalog_items (id) on delete restrict,
  price_id               uuid not null references public.prices (id) on delete restrict,
  amount_kobo            bigint not null check (amount_kobo > 0 and amount_kobo <= 100000000000),
  components             jsonb not null default '{}'::jsonb,
  fee_kobo               bigint check (fee_kobo is null or fee_kobo >= 0),
  total_kobo             bigint check (total_kobo is null or total_kobo >= amount_kobo),
  state                  text not null default 'created' check (state in ('created', 'paid', 'failed', 'refunded', 'cancelled')),
  paystack_reference     text not null unique check (paystack_reference ~ '^[A-Za-z0-9._=-]{8,100}$'),
  checkout_url           text check (checkout_url is null or checkout_url ~ '^https://'),
  client_key             uuid,
  expires_at             timestamptz not null default now() + interval '24 hours',
  paid_at                timestamptz,
  cancelled_at           timestamptz,
  failure_reason         text,
  is_test                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((state = 'paid') = (paid_at is not null) or state = 'refunded'),
  check (state <> 'paid' or (fee_kobo is not null and total_kobo is not null and total_kobo = amount_kobo + fee_kobo))
);
create unique index orders_buyer_client_key on public.orders (buyer_profile_id, client_key) where client_key is not null;
create index orders_beneficiary_idx on public.orders (beneficiary_patient_id, state);
create index orders_open_idx on public.orders (created_at) where state = 'created';
alter table public.orders enable row level security;
revoke all on public.orders from public, anon, authenticated;
grant select on public.orders to authenticated;
create policy orders_read on public.orders for select to authenticated
  using (buyer_profile_id = (select auth.uid()) or beneficiary_patient_id = (select auth.uid())
         or (private.is_admin() and organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))));

create function private.orders_state_machine() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'order_immutable' using errcode = 'P0001'; end if;
  if new.amount_kobo is distinct from old.amount_kobo or new.price_id is distinct from old.price_id
     or new.buyer_profile_id is distinct from old.buyer_profile_id or new.beneficiary_patient_id is distinct from old.beneficiary_patient_id
     or new.catalog_item_id is distinct from old.catalog_item_id or new.paystack_reference is distinct from old.paystack_reference then
    raise exception 'order_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'created'   and new.state in ('paid', 'failed', 'cancelled'))
    or (old.state in ('failed', 'cancelled') and new.state = 'paid')   -- a verified late payment is never ignored
    or (old.state = 'paid'      and new.state = 'refunded')) then
    raise exception 'order_bad_transition % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger orders_state_machine before update or delete on public.orders
  for each row execute function private.orders_state_machine();

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  order_id           uuid not null references public.orders (id) on delete restrict,
  provider           text not null default 'paystack' check (provider = 'paystack'),
  provider_reference text not null,
  amount_kobo        bigint not null check (amount_kobo >= 0),
  fee_kobo           bigint not null default 0 check (fee_kobo >= 0),
  total_kobo         bigint not null check (total_kobo >= 0),
  status             text not null check (status in ('success', 'mismatch')),
  mismatch_reason    text,
  source             text not null check (source in ('webhook', 'return', 'sweep')),
  event_key          text,
  raw                jsonb not null default '{}'::jsonb,
  verified_at        timestamptz not null default now(),
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  check (status <> 'mismatch' or mismatch_reason is not null)
);
-- one success per reference: a replay can never become a second payment
create unique index payments_one_success on public.payments (provider, provider_reference) where status = 'success';
create unique index payments_one_mismatch on public.payments (provider, provider_reference, mismatch_reason, amount_kobo, total_kobo) where status = 'mismatch';
create index payments_order_idx on public.payments (order_id);
alter table public.payments enable row level security;
revoke all on public.payments from public, anon, authenticated;
grant select on public.payments to authenticated;
create policy payments_read on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = payments.order_id
                   and (o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
                        or (private.is_admin() and o.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))))));

create table public.entitlements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  order_id        uuid not null unique references public.orders (id) on delete restrict,
  kind            text not null check (kind in ('consultation_credit', 'care_pack', 'lab_panel', 'membership')),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  remaining_uses  integer check (remaining_uses is null or remaining_uses >= 0),
  state           text not null default 'active' check (state in ('active', 'expired', 'used', 'revoked')),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index entitlements_patient_idx on public.entitlements (patient_id, state);
alter table public.entitlements enable row level security;
revoke all on public.entitlements from public, anon, authenticated;
grant select on public.entitlements to authenticated;
create policy entitlements_read on public.entitlements for select to authenticated
  using (patient_id = (select auth.uid())
         or (private.is_admin() and organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))));

-- ---------------------------------------------------------------------------
-- Dormant gate (INV-14)
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description)
values ('v5_checkout', 'Catalogue checkout',
        'Lets a patient buy a catalogue item (membership, care pack, consultation, lab panel) through Paystack. Dormant until the founder confirms prices, the first lead clinicians are active and the on-call rota covers sold hours. Items are also individually switched on.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------
create function private.current_price(p_item uuid) returns public.prices
language sql stable security definer set search_path = '' as $$
  select p.* from public.prices p
   where p.catalog_item_id = p_item and p.valid_from <= now() and (p.valid_to is null or p.valid_to > now())
   order by p.valid_from desc limit 1
$$;
revoke all on function private.current_price(uuid) from public, anon, authenticated;

create function public.create_order(p_code text, p_client_key uuid default null, p_beneficiary uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  it public.catalog_items%rowtype;
  px public.prices%rowtype;
  o public.orders%rowtype;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if p_beneficiary is not null and p_beneficiary <> v_uid then raise exception 'order_beneficiary_not_allowed' using errcode = '42501'; end if;

  -- a retry of the same tap returns the first order
  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then
      return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
    end if;
  end if;

  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = p_code;
  if not found or not it.active then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  px := private.current_price(it.id);
  if px.id is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;

  if it.kind = 'membership' and exists (
       select 1 from public.patient_memberships m where m.patient_id = v_uid and m.state = 'active' and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if it.grants_lead and not exists (select 1 from private.lead_candidates(v_uid, '{}', true)) then
    raise exception 'no_capacity' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders where buyer_profile_id = v_uid and state = 'created' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_open_orders' using errcode = 'P0001';
  end if;

  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test)
  values (pr.organisation_id, v_uid, v_uid, it.id, px.id, px.amount_kobo, px.components,
          'tho_' || replace(gen_random_uuid()::text, '-', ''), p_client_key, coalesce(pr.is_test, false))
  on conflict (buyer_profile_id, client_key) where client_key is not null do nothing
  returning * into o;
  if o.id is null then
    -- a second tap of the same key raced the first: return the first order
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
  end if;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', null, 'replay', false);
end $$;

create function public.cancel_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.orders set state = 'cancelled', cancelled_at = now()
   where id = p_order and buyer_profile_id = (select auth.uid()) and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

create function private.order_incident(p_org uuid, p_ref text, p_title text, p_summary text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = p_summary where external_reference = p_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'financial', 'sev2', p_title, p_summary, p_ref, now() + interval '4 hours', now() + interval '24 hours');
  end if;
end $$;
revoke all on function private.order_incident(uuid, text, text, text) from public, anon, authenticated;

-- A payment Paystack confirmed that does not match its order: kept as evidence, never fulfilled, always a person's problem.
create function private.record_order_mismatch(o public.orders, p_reason text, p_amount bigint, p_fee bigint, p_total bigint, p_source text, p_event_key text, p_raw jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, mismatch_reason, source, event_key, raw, is_test)
  values (o.organisation_id, o.id, o.paystack_reference, greatest(coalesce(p_amount, 0), 0), greatest(coalesce(p_fee, 0), 0),
          greatest(coalesce(p_total, 0), 0), 'mismatch', p_reason, p_source, p_event_key, coalesce(p_raw, '{}'), o.is_test)
  on conflict (provider, provider_reference, mismatch_reason, amount_kobo, total_kobo) where status = 'mismatch' do nothing;
  perform private.order_incident(o.organisation_id, 'order-mismatch:' || o.id, 'Payment did not match its order',
    'Paystack reported a payment whose ' || p_reason || ' differs from order ' || o.id || '. The order was NOT marked paid. A person must check the Paystack dashboard.');
  return jsonb_build_object('result', 'mismatch', 'reason', p_reason, 'order_id', o.id);
end $$;
revoke all on function private.record_order_mismatch(public.orders, text, bigint, bigint, bigint, text, text, jsonb) from public, anon, authenticated;

-- The one place an order becomes paid. Idempotent: the order row lock serialises racing callers and every effect below is
-- keyed on the order, so the second caller finds the work done. Returns 'paid', 'replay', 'mismatch' or 'not_found'.
create function public.record_order_payment(
  p_reference text, p_amount_kobo bigint, p_fee_kobo bigint, p_total_kobo bigint, p_currency text, p_status text,
  p_source text, p_event_key text default null, p_paid_at timestamptz default null, p_raw jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_reason text;
  v_ent uuid;
  v_start timestamptz := coalesce(p_paid_at, now());
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if p_status is distinct from 'success' then return jsonb_build_object('result', 'not_paid', 'order_id', o.id); end if;
  if o.state in ('paid', 'refunded') and exists (select 1 from public.payments where provider = 'paystack' and provider_reference = p_reference and status = 'success') then
    return jsonb_build_object('result', 'replay', 'order_id', o.id);
  end if;

  v_reason := case
    when p_currency is distinct from 'NGN' then 'currency'
    when p_amount_kobo is distinct from o.amount_kobo then 'amount'
    when p_fee_kobo is null or p_fee_kobo < 0 or p_total_kobo is distinct from p_amount_kobo + p_fee_kobo then 'fee'
    else null end;
  if v_reason is not null then
    return private.record_order_mismatch(o, v_reason, p_amount_kobo, p_fee_kobo, p_total_kobo, p_source, p_event_key, p_raw);
  end if;

  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, event_key, raw, verified_at, is_test)
  values (o.organisation_id, o.id, p_reference, p_amount_kobo, p_fee_kobo, p_total_kobo, 'success', p_source, p_event_key, coalesce(p_raw, '{}'), now(), o.is_test)
  on conflict (provider, provider_reference) where status = 'success' do nothing;

  if o.state in ('created', 'failed', 'cancelled') then
    update public.orders set state = 'paid', paid_at = v_start, fee_kobo = p_fee_kobo, total_kobo = p_total_kobo, failure_reason = null where id = o.id;
    if o.state in ('failed', 'cancelled') then
      perform private.order_incident(o.organisation_id, 'order-late-payment:' || o.id, 'A payment arrived for a closed order',
        'Order ' || o.id || ' was ' || o.state || ' when a verified payment arrived. It was honoured as paid.');
    end if;
  end if;

  select * into it from public.catalog_items where id = o.catalog_item_id;
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, is_test)
  values (o.organisation_id, o.beneficiary_patient_id, o.id,
          case it.kind when 'consultation' then 'consultation_credit' else it.kind end, v_start,
          case when it.duration_days is not null then v_start + make_interval(days => it.duration_days) end,
          it.uses, o.is_test)
  on conflict (order_id) do nothing
  returning id into v_ent;

  if v_ent is not null and it.kind = 'membership' then
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
     where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null and ends_at <= now();
    if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
      -- Already a Member (two orders paid, or a grant landed after this order was made): the payment is honoured, never rolled back.
      -- A dated membership is extended by the paid period; an undated one is left alone. A person is told either way.
      update public.patient_memberships
         set ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days)
       where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null;
      perform private.order_incident(o.organisation_id, 'order-membership-overlap:' || o.id, 'A membership was paid for by someone who already had one',
        'Order ' || o.id || ' was paid while the patient already had an active membership. A dated one was extended by the paid period; check whether a refund is due.');
    else
      insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
      values (o.organisation_id, o.beneficiary_patient_id, 'purchase', v_start, v_start + make_interval(days => it.duration_days), o.is_test);
    end if;
  end if;

  -- Capacity is checked when the order is made, not reserved, so a rush can sell more than the free slots. Say so to a person.
  if v_ent is not null and it.grants_lead and not exists (select 1 from private.lead_candidates(o.beneficiary_patient_id, '{}', true)) then
    perform private.order_incident(o.organisation_id, 'order-no-lead-slot:' || o.id, 'A paid order has no lead clinician slot',
      'Order ' || o.id || ' was paid but no lead clinician has a free slot. Arrange a lead for this patient.');
  end if;

  perform private.emit_domain_event('order.paid', o.organisation_id,
    jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead, 'kind', it.kind, 'code', it.code),
    'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);

  return jsonb_build_object('result', case when v_ent is null then 'replay' else 'paid' end, 'order_id', o.id, 'entitlement_id', v_ent);
end $$;

-- The adapter's own check (price, reference, currency, and a fee that does not exceed what Paystack took) failed.
create function public.flag_order_payment_mismatch(p_reference text, p_reason text, p_amount_kobo bigint, p_total_kobo bigint, p_source text, p_event_key text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state in ('paid', 'refunded') then return jsonb_build_object('result', 'replay', 'order_id', o.id); end if;
  return private.record_order_mismatch(o, left(coalesce(p_reason, 'unknown'), 40), p_amount_kobo, 0, p_total_kobo, p_source, p_event_key, '{}'::jsonb);
end $$;

-- The hosted checkout link, kept so a retry of the same order reopens the same page (Paystack refuses a reused reference).
create function public.set_order_checkout_url(p_reference text, p_url text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  update public.orders set checkout_url = p_url where paystack_reference = p_reference and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- A failure Paystack tells us about for sure (abandoned, failed): close the order. Never closes a paid one.
create function public.close_unpaid_order(p_reference text, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  update public.orders set state = case when p_reason = 'expired' then 'cancelled' else 'failed' end,
         cancelled_at = case when p_reason = 'expired' then now() end, failure_reason = left(p_reason, 200)
   where paystack_reference = p_reference and state = 'created';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Orders the sweeper must ask Paystack about: unpaid for 2 minutes up to 3 days (late bank transfer and USSD).
create function public.orders_needing_reconcile(p_limit integer default 50)
returns table (reference text, order_id uuid, expired boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  return query
    select o.paystack_reference, o.id, o.expires_at < now()
      from public.orders o
     where o.state = 'created' and o.created_at < now() - interval '2 minutes' and o.created_at > now() - interval '3 days'
     order by o.created_at limit least(greatest(p_limit, 1), 200);
end $$;

-- What the checkout screen needs about one order: the owner only.
create function public.order_for_checkout(p_reference text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare o public.orders%rowtype; it public.catalog_items%rowtype;
begin
  select * into o from public.orders where paystack_reference = p_reference
     and (buyer_profile_id = (select auth.uid()) or beneficiary_patient_id = (select auth.uid()));
  if not found then return null; end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'state', o.state, 'amount_kobo', o.amount_kobo,
    'fee_kobo', o.fee_kobo, 'total_kobo', o.total_kobo, 'code', it.code, 'kind', it.kind, 'name_key', it.name_key,
    'beneficiary_patient_id', o.beneficiary_patient_id, 'paid_at', o.paid_at);
end $$;

create function public.my_orders() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'state', o.state, 'amount_kobo', o.amount_kobo, 'fee_kobo', o.fee_kobo,
         'total_kobo', o.total_kobo, 'code', i.code, 'name_key', i.name_key, 'created_at', o.created_at, 'paid_at', o.paid_at) order by o.created_at desc), '[]'::jsonb)
    from public.orders o join public.catalog_items i on i.id = o.catalog_item_id
   where o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
$$;

-- The shop window: active items with their current price, for any signed-in patient.
create function public.catalogue() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'kind', i.kind, 'name_key', i.name_key, 'description_key', i.description_key,
         'included_keys', i.included_keys, 'duration_days', i.duration_days, 'uses', i.uses, 'amount_kobo', p.amount_kobo, 'components', p.components)
         order by i.kind, i.code), '[]'::jsonb)
    from public.catalog_items i
    cross join lateral (select * from private.current_price(i.id)) p
   where i.active and p.id is not null
     and i.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))
     and coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false)
$$;

-- Staff: switch an item on or off, set a price (new row, old one closed), both audited with a reason.
create function public.set_catalog_item_active(p_code text, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare it public.catalog_items%rowtype; v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = p_code for update;
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  if p_active and private.current_price(it.id) is null then raise exception 'item_has_no_price' using errcode = 'P0001'; end if;
  update public.catalog_items set active = p_active, updated_at = now() where id = it.id;
  perform private.log_audit('catalogue.item_active', 'catalog_items', it.id, jsonb_build_object('code', p_code, 'active', p_active, 'reason', p_reason));
end $$;

create function public.set_item_price(p_code text, p_amount_kobo bigint, p_components jsonb, p_reason text, p_valid_from timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare it public.catalog_items%rowtype; v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
        v_from timestamptz := coalesce(p_valid_from, now()); v_old public.prices%rowtype; v_id uuid;
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = p_code for update;
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  select * into v_old from public.prices where catalog_item_id = it.id and valid_to is null;
  if found then
    if v_from <= v_old.valid_from then raise exception 'price_start_before_current' using errcode = '22023'; end if;
    update public.prices set valid_to = v_from where id = v_old.id;
  end if;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, valid_from, created_by, reason)
  values (v_org, it.id, p_amount_kobo, coalesce(p_components, '{}'), v_from, (select auth.uid()), p_reason) returning id into v_id;
  perform private.log_audit('catalogue.price_set', 'catalog_items', it.id, jsonb_build_object('code', p_code, 'amount_kobo', p_amount_kobo, 'reason', p_reason));
  return v_id;
end $$;

-- The patient's own membership state for the Membership screen. patient_memberships has no patient read policy (S22b), so this is the
-- one safe way for the app to ask. Returns is_member false with no dates when there is none.
create function public.my_membership() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.patient_memberships%rowtype;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into m from public.patient_memberships
   where patient_id = v_uid and state = 'active' and starts_at <= now() and (ends_at is null or ends_at > now())
   order by starts_at desc limit 1;
  if not found then return jsonb_build_object('is_member', false, 'ends_at', null, 'source', null); end if;
  return jsonb_build_object('is_member', true, 'ends_at', m.ends_at, 'source', m.source);
end $$;

-- Staff: every item with its price history and a count of paid orders (the admin catalogue screen).
create function public.admin_catalogue() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'checkout_open', coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', i.code, 'kind', i.kind, 'name_key', i.name_key, 'active', i.active, 'note', i.note, 'duration_days', i.duration_days, 'uses', i.uses,
        'grants_lead', i.grants_lead,
        'paid_orders', (select count(*) from public.orders o where o.catalog_item_id = i.id and o.state = 'paid' and not o.is_test),
        'prices', coalesce((select jsonb_agg(jsonb_build_object('amount_kobo', p.amount_kobo, 'components', p.components, 'valid_from', p.valid_from,
                    'valid_to', p.valid_to, 'reason', p.reason) order by p.valid_from desc) from public.prices p where p.catalog_item_id = i.id), '[]'::jsonb))
        order by i.kind, i.code)
      from public.catalog_items i where i.organisation_id = v_org), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Housekeeping and the sweeper schedule
-- ---------------------------------------------------------------------------
-- An unpaid order nobody paid for three days is cancelled (the sweeper stops asking Paystack after three days). A late payment on
-- one is still honoured by record_order_payment.
create function private.expire_stale_orders() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.orders set state = 'cancelled', cancelled_at = now(), failure_reason = 'expired'
   where state = 'created' and created_at < now() - interval '3 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.expire_stale_orders() from public, anon, authenticated;
select cron.schedule('order-expire-stale', '17 * * * *', $$ select private.expire_stale_orders(); $$);

-- Every 5 minutes: the order-reconcile edge function asks Paystack about unpaid orders. Fails closed until the Vault secret
-- order_reconcile_secret exists and the function has the same value as ORDER_RECONCILE_SECRET (it answers 401 otherwise), exactly
-- like process-events. project_url and edge_function_publishable_key are the shared secrets S10 and S13 already use.
select cron.schedule(
  'order-reconcile',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/order-reconcile',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-order-reconcile-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'order_reconcile_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 25000
  ) as request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- Grants (anon and PUBLIC revoked explicitly: execute is inherited through PUBLIC)
-- ---------------------------------------------------------------------------
revoke all on function public.create_order(text, uuid, uuid) from public, anon;
revoke all on function public.cancel_order(uuid) from public, anon;
revoke all on function public.order_for_checkout(text) from public, anon;
revoke all on function public.my_orders() from public, anon;
revoke all on function public.catalogue() from public, anon;
revoke all on function public.set_catalog_item_active(text, boolean, text) from public, anon;
revoke all on function public.set_item_price(text, bigint, jsonb, text, timestamptz) from public, anon;
revoke all on function public.admin_catalogue() from public, anon;
revoke all on function public.my_membership() from public, anon;
grant execute on function public.create_order(text, uuid, uuid), public.cancel_order(uuid), public.order_for_checkout(text),
  public.my_orders(), public.catalogue(), public.set_catalog_item_active(text, boolean, text),
  public.set_item_price(text, bigint, jsonb, text, timestamptz), public.admin_catalogue(), public.my_membership() to authenticated;
-- service role only
revoke all on function public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.close_unpaid_order(text, text) from public, anon, authenticated;
revoke all on function public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function public.set_order_checkout_url(text, text) from public, anon, authenticated;
revoke all on function public.orders_needing_reconcile(integer) from public, anon, authenticated;
grant execute on function public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb),
  public.close_unpaid_order(text, text), public.orders_needing_reconcile(integer),
  public.flag_order_payment_mismatch(text, text, bigint, bigint, text, text), public.set_order_checkout_url(text, text) to service_role;
revoke all on function private.prices_immutable(), private.orders_state_machine() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed: two inactive items for the first organisation. Prices are data, versioned in prices; an item stays off until staff switch it on
-- AND the v5_checkout module is enabled. Membership 100,000 naira is the founder-confirmed 2026-10-05 value; the 12,000 naira care pack is
-- PROPOSED (spec line 696, registry key commerce.care_pack_price_kobo) and is not on sale until the founder confirms it (OQ-160).
-- ---------------------------------------------------------------------------
with org as (select id from public.organisations order by created_at limit 1),
  ins as (
    insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, included_keys, duration_days, grants_lead, active, note)
    select org.id, v.code, v.kind, v.code_key || '.name', v.code_key || '.description',
           array[v.code_key || '.incl.1', v.code_key || '.incl.2', v.code_key || '.incl.3', v.code_key || '.incl.4'],
           v.days, true, false, v.note
      from org, (values
        ('membership_annual', 'membership', 'catalog.membership_annual', 365, 'Founder confirmed 2026-10-05 (docs/MEMBERSHIP_MODEL_PLAN.md).'),
        ('bp_care_pack_3m',   'care_pack',  'catalog.bp_care_pack_3m',    90,  'PROPOSED price, see OQ-160.')
      ) as v(code, kind, code_key, days, note)
    on conflict (organisation_id, code) do nothing
    returning id, organisation_id, code
  )
insert into public.prices (organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
select ins.organisation_id, ins.id, case ins.code when 'membership_annual' then 10000000 else 1200000 end, now(), 'Seeded by S25'
  from ins;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['catalog_items', 'prices', 'orders', 'payments', 'entitlements'] loop
    if t in ('catalog_items', 'prices') and has_table_privilege('authenticated', 'public.' || t, 'SELECT') then raise exception 'S25: authenticated can read % directly', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'S25: % has no RLS', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'S25: anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE') then raise exception 'S25: authenticated can write %', t; end if;
  end loop;
  if has_function_privilege('anon', 'public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb)', 'EXECUTE') then
    raise exception 'S25: record_order_payment is callable by a user';
  end if;
  if has_function_privilege('anon', 'public.create_order(text,uuid,uuid)', 'EXECUTE') then raise exception 'S25: anon can create an order'; end if;
end $$;
