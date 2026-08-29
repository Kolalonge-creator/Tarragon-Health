-- Option A, part 2: the order actually reaching Synlab.
--
-- The failure this exists to prevent is the worst one in the whole flow, and
-- it is silent: the patient pays, and the request never reaches the
-- laboratory. Nothing errors. The order simply sits at payment_confirmed
-- looking healthy while the patient waits for a sample appointment nobody
-- knows they are owed, and the first anyone hears of it is a complaint.
--
-- So transmission is an explicit state on the order rather than an implied
-- one, with an unambiguous "money taken, laboratory not yet told" value that
-- can be counted, alerted on and worked through. An order in that state for
-- longer than the SLA is an operational failure that shows up in a query
-- rather than a story a patient has to tell.
--
-- Deliberately NOT an automated API push. Synlab has no order-intake API in
-- this contract; transmission today is a person sending the request and
-- recording the laboratory's own reference against it. Modelling that
-- honestly — a state machine a human or a future integration can both drive —
-- is more useful than pretending there is a wire to push down, and matches
-- the same "low-tech on purpose" shape as booking_requests and the partner
-- visit scheduling RPC.

do $$ begin
  create type public.lab_order_transmission as enum
    ('not_required', 'awaiting_payment', 'queued', 'sent', 'acknowledged', 'failed');
exception when duplicate_object then null; end $$;

alter table public.lab_orders
  add column if not exists transmission          public.lab_order_transmission not null default 'not_required',
  add column if not exists transmitted_at        timestamptz,
  add column if not exists transmission_ack_at   timestamptz,
  add column if not exists partner_reference     text,
  add column if not exists transmission_note     text;

comment on column public.lab_orders.transmission is
  'Where this order is in reaching the partner laboratory. not_required = self-arranged, the patient carries it themselves. awaiting_payment = a partner order with nothing to send yet, because sending unpaid work would hand the laboratory something Tarragon has not been funded for. queued = paid for, laboratory not yet told — the state that must never be left sitting. sent = passed to the laboratory. acknowledged = the laboratory confirmed receipt and gave its own reference. failed = it did not get there and somebody has to act.';
comment on column public.lab_orders.partner_reference is
  'The laboratory''s own identifier for this order. What a phone call about a missing sample is actually conducted in — ours means nothing to them.';

-- A self-arranged order has no partner to transmit to, and a partner order is
-- never "not_required". Enforced rather than assumed, because the whole value
-- of the queued state is that it cannot be skipped.
alter table public.lab_orders drop constraint if exists lab_orders_transmission_matches_fulfilment;
alter table public.lab_orders add constraint lab_orders_transmission_matches_fulfilment check (
  (fulfilment = 'self_arranged' and transmission = 'not_required')
  or (fulfilment = 'partner' and transmission <> 'not_required')
);

create index if not exists lab_orders_awaiting_transmission_idx
  on public.lab_orders (transmission, payment_confirmed_at)
  where transmission in ('queued', 'failed');

-- ---------------------------------------------------------------------------
-- A partner order enters the queue the moment it is paid for, and not before.
--
-- Before payment there is nothing to send: sending an unpaid order would hand
-- Synlab work Tarragon has not been funded for. After payment, queued is the
-- only honest state until somebody actually sends it.
-- ---------------------------------------------------------------------------
create or replace function private.queue_lab_order_transmission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfilment <> 'partner' then
    -- Self-arranged: there is no partner to transmit to, ever.
    new.transmission := 'not_required';
    return new;
  end if;

  -- A partner order is awaiting_payment until it is paid, then queued. Both
  -- transitions are computed here rather than trusted from the caller, so no
  -- code path can create a paid partner order that skips the queue.
  if tg_op = 'INSERT' then
    new.transmission := case
      when new.status = 'payment_confirmed' then 'queued'
      else 'awaiting_payment'
    end;
    return new;
  end if;

  -- Once it has actually been sent, payment status changes must not drag it
  -- backwards into the queue.
  if new.status = 'payment_confirmed'
     and old.status is distinct from new.status
     and new.transmission = 'awaiting_payment' then
    new.transmission := 'queued';
  end if;

  return new;
end;
$$;

revoke all on function private.queue_lab_order_transmission() from public;

drop trigger if exists lab_orders_queue_transmission on public.lab_orders;
create trigger lab_orders_queue_transmission
  before insert or update of status on public.lab_orders
  for each row execute function private.queue_lab_order_transmission();

-- ---------------------------------------------------------------------------
-- Recording that it went, and that they got it.
--
-- Two separate RPCs because they are two separate facts, and collapsing them
-- would lose the one that matters: "we sent it" is our claim, "they
-- acknowledged it with their own reference" is theirs. Only the second proves
-- the order is really in Synlab's system.
-- ---------------------------------------------------------------------------
create or replace function public.mark_lab_order_transmitted(
  p_order_id uuid,
  p_partner_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lab_orders%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_order.organisation_id) then
    raise exception 'only care-team staff can record transmission' using errcode = '42501';
  end if;
  if v_order.fulfilment <> 'partner' then
    raise exception 'a self-arranged order is carried by the patient, not transmitted' using errcode = '23514';
  end if;
  if v_order.status <> 'payment_confirmed' then
    raise exception 'this order is not paid for yet — sending it would hand the laboratory unfunded work'
      using errcode = '23514';
  end if;

  update public.lab_orders
     set transmission      = 'sent',
         transmitted_at    = coalesce(transmitted_at, now()),
         partner_reference = coalesce(p_partner_reference, partner_reference),
         transmission_note = coalesce(p_note, transmission_note)
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'transmission', 'sent');
end;
$$;

revoke all on function public.mark_lab_order_transmitted(uuid, text, text) from public;
revoke all on function public.mark_lab_order_transmitted(uuid, text, text) from anon;
grant execute on function public.mark_lab_order_transmitted(uuid, text, text) to authenticated;

create or replace function public.acknowledge_lab_order(
  p_order_id uuid,
  p_partner_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lab_orders%rowtype;
  v_is_partner boolean;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;

  -- The acknowledging party is either the laboratory itself (through the
  -- partner portal) or Tarragon staff recording what the laboratory told them.
  -- Reuses private.lab_partner_provider(), the existing "which laboratory is
  -- this login", rather than inventing a second answer to the same question.
  v_is_partner := (private.lab_partner_provider() is not null
                   and private.lab_partner_provider() = v_order.partner_cost_provider_id);

  if not (v_is_partner or private.is_org_staff(v_order.organisation_id)) then
    raise exception 'only the laboratory or care-team staff can acknowledge an order' using errcode = '42501';
  end if;

  if coalesce(btrim(p_partner_reference), '') = '' then
    raise exception 'an acknowledgement needs the laboratory''s own reference — that is the whole point of recording it'
      using errcode = '23514';
  end if;

  update public.lab_orders
     set transmission        = 'acknowledged',
         transmission_ack_at = coalesce(transmission_ack_at, now()),
         transmitted_at      = coalesce(transmitted_at, now()),
         partner_reference   = p_partner_reference
   where id = p_order_id;

  return jsonb_build_object('ok', true, 'transmission', 'acknowledged');
end;
$$;

revoke all on function public.acknowledge_lab_order(uuid, text) from public;
revoke all on function public.acknowledge_lab_order(uuid, text) from anon;
grant execute on function public.acknowledge_lab_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The query somebody has to look at every morning.
--
-- Paid for, and the laboratory still does not have it. Ordered oldest first,
-- because the oldest one is the patient who has been waiting longest without
-- knowing anything is wrong.
-- ---------------------------------------------------------------------------
create or replace view public.lab_orders_awaiting_transmission
with (security_invoker = true)
as
select lo.id,
       lo.organisation_id,
       lo.patient_id,
       lo.order_number,
       lo.total_kobo,
       lo.partner_cost_kobo,
       lo.transmission,
       lo.payment_confirmed_at,
       lp.name as laboratory,
       round(extract(epoch from (now() - lo.payment_confirmed_at)) / 3600.0, 1) as hours_since_payment
from public.lab_orders lo
left join public.lab_providers lp on lp.id = lo.partner_cost_provider_id
where lo.fulfilment = 'partner'
  and lo.status = 'payment_confirmed'
  and lo.transmission in ('queued', 'failed')
order by lo.payment_confirmed_at asc nulls first;

comment on view public.lab_orders_awaiting_transmission is
  'Orders the patient has paid for that the laboratory has not been told about. security_invoker, so it shows a caller only what their own RLS on lab_orders already lets them see.';

grant select on public.lab_orders_awaiting_transmission to authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.lab_orders'::regclass
                  and tgname = 'lab_orders_queue_transmission' and not tgisinternal) then
    raise exception 'the transmission queue trigger is missing';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lab_orders'::regclass
                  and conname = 'lab_orders_transmission_matches_fulfilment') then
    raise exception 'transmission state is not tied to fulfilment';
  end if;
end $$;
