-- Tarragon Health -- pharmacy order acceptance / out-of-stock decline / refund
-- tracking (Pharmacy Engine spec §12.5 and §12.9, docs/PHARMACY_ENGINE_SPEC.md,
-- built on explicit founder ask 2026-08-28 to fully build this infrastructure
-- ahead of a real partner).
--
-- Confirmed by direct code audit before writing this: NOTHING today lets a
-- pharmacist accept, confirm quantity/price/fulfilment-time, or decline an
-- order -- pharmacist_record_dispense only ever inserts into the separate
-- pharmacy_order_dispenses log, never touches pharmacy_orders.status. There
-- is also no refund path for pharmacy at all (the paystack-webhook only
-- handles charge.success for booking orders; charge.failed never touches the
-- order row). This closes both gaps the same way the video-visit refund
-- model already does for a different table (refund_status='due'/'refunded',
-- a Refunds-API cron sweep) -- see
-- apps/web/src/app/api/cron/video-visit-refunds/route.ts for the precedent
-- this mirrors.
--
-- Money-movement stays dormant: is_active is false for every real
-- pharmacy_partners row, so none of this can fire for a real order until a
-- partner is actually contracted and activated (see the onboarding pipeline,
-- 20260828232205_pharmacy_partner_onboarding_pipeline.sql).

alter table public.pharmacy_orders
  add column if not exists confirmed_quantity      text,
  add column if not exists confirmed_price_kobo     bigint,
  add column if not exists estimated_fulfilment_at  timestamptz,
  add column if not exists accepted_at              timestamptz,
  add column if not exists accepted_by              uuid references public.profiles (id) on delete set null,
  add column if not exists cancellation_reason       text,
  add column if not exists declined_at              timestamptz,
  add column if not exists declined_by              uuid references public.profiles (id) on delete set null,
  add column if not exists refund_status            text,
  add column if not exists refund_amount_kobo       bigint,
  add column if not exists refund_ref               text;

alter table public.pharmacy_orders
  add constraint pharmacy_orders_refund_status_check
  check (refund_status is null or refund_status in ('due', 'refunded', 'failed'));

comment on column public.pharmacy_orders.declined_by is
  'Set only when a pharmacist actively declined the order (out-of-stock/unable-to-fulfil workflow, §12.5). NULL for a system-cancelled order (e.g. the pending_payment expiry sweep) -- that distinction is what the response-notification trigger below uses to avoid telling a patient "declined" for an order nobody ever looked at.';
comment on column public.pharmacy_orders.refund_status is
  'Pharmacy Engine spec §12.9''s Refunded/Partially refunded states. NULL = no refund applicable. ''due'' is picked up by the pharmacy-order-refunds cron sweep (mirrors video-visit-refunds), which calls the Paystack Refunds API and flips this to ''refunded'' on success.';

-- ---------------------------------------------------------------------------
-- pharmacist_accept_order -- confirms availability/quantity/price/fulfilment
-- time (§12.5). A confirmed_price_kobo below what was actually paid means
-- partial fulfilment (e.g. only half the prescribed quantity in stock) and
-- automatically flags the difference for refund -- §12.9's "partially
-- refunded" state, not a separate manual step.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacist_accept_order(
  p_order_id uuid,
  p_confirmed_quantity text,
  p_confirmed_price_kobo bigint default null,
  p_estimated_fulfilment_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pharmacy_orders%rowtype;
  v_paid  bigint;
  v_price bigint;
begin
  select * into v_order
  from public.pharmacy_orders
  where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();

  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if v_order.status not in ('payment_confirmed', 'requested') then
    raise exception 'Only a paid, unaccepted order can be accepted (current status: %)', v_order.status using errcode = '22023';
  end if;
  if coalesce(btrim(p_confirmed_quantity), '') = '' then
    raise exception 'Confirmed quantity is required' using errcode = '22023';
  end if;

  v_paid := coalesce(v_order.payable_kobo, v_order.total_kobo);
  v_price := coalesce(p_confirmed_price_kobo, v_paid);

  if v_price > v_paid then
    raise exception 'Confirmed price (%) cannot exceed what the patient already paid (%)', v_price, v_paid using errcode = '22023';
  end if;

  update public.pharmacy_orders
  set status = 'confirmed',
      confirmed_quantity = btrim(p_confirmed_quantity),
      confirmed_price_kobo = v_price,
      estimated_fulfilment_at = p_estimated_fulfilment_at,
      accepted_at = now(),
      accepted_by = (select auth.uid()),
      refund_status = case when v_price < v_paid then 'due' else refund_status end,
      refund_amount_kobo = case when v_price < v_paid then v_paid - v_price else refund_amount_kobo end
  where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- pharmacist_decline_order -- the out-of-stock/cannot-fulfil workflow §12.5
-- explicitly asks for ("should trigger an appropriate workflow rather than
-- simply failing"): a full refund is flagged automatically, and the response
-- notification trigger below tells the patient. The patient's own
-- self-arranged path (buy elsewhere, log the collection) already exists as
-- the ever-available fallback regardless of this outcome.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacist_decline_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pharmacy_orders%rowtype;
  v_paid  bigint;
begin
  select * into v_order
  from public.pharmacy_orders
  where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();

  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if v_order.status not in ('payment_confirmed', 'requested', 'confirmed') then
    raise exception 'Cannot decline an order at status %', v_order.status using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to decline an order' using errcode = '22023';
  end if;

  v_paid := coalesce(v_order.payable_kobo, v_order.total_kobo);

  update public.pharmacy_orders
  set status = 'cancelled',
      cancellation_reason = btrim(p_reason),
      declined_at = now(),
      declined_by = (select auth.uid()),
      refund_status = case when v_paid > 0 and v_order.payment_provider_ref is not null then 'due' else refund_status end,
      refund_amount_kobo = case when v_paid > 0 and v_order.payment_provider_ref is not null then v_paid else refund_amount_kobo end
  where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Response notifications -- separate trigger from the existing
-- payment_confirmed one (20260716122000), which is left untouched. Only
-- fires for a pharmacist-actioned outcome (declined_by/accepted_by set),
-- never for the cron's own pending_payment expiry cancellation.
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_pharmacy_order_response_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pharmacy_name text;
begin
  select name into v_pharmacy_name from public.pharmacy_partners where id = new.pharmacy_partner_id;

  if new.status = 'confirmed' and new.accepted_at is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'whatsapp', 'pending',
      'pharmacy_order_accepted',
      jsonb_build_object(
        'order_number', new.order_number,
        'pharmacy_name', coalesce(v_pharmacy_name, 'the pharmacy'),
        'confirmed_quantity', new.confirmed_quantity,
        'estimated_fulfilment_at', new.estimated_fulfilment_at
      )
    );
  elsif new.status = 'cancelled' and new.declined_by is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'whatsapp', 'pending',
      'pharmacy_order_declined',
      jsonb_build_object(
        'order_number', new.order_number,
        'pharmacy_name', coalesce(v_pharmacy_name, 'the pharmacy'),
        'reason', new.cancellation_reason
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_orders_enqueue_response_notifications on public.pharmacy_orders;
create trigger pharmacy_orders_enqueue_response_notifications
  after update on public.pharmacy_orders
  for each row
  when (old.status is distinct from new.status and new.status in ('confirmed', 'cancelled'))
  execute function private.enqueue_pharmacy_order_response_notifications();

revoke execute on function public.pharmacist_accept_order(uuid, text, bigint, timestamptz) from public;
revoke execute on function public.pharmacist_accept_order(uuid, text, bigint, timestamptz) from anon;
grant execute on function public.pharmacist_accept_order(uuid, text, bigint, timestamptz) to authenticated;

revoke execute on function public.pharmacist_decline_order(uuid, text) from public;
revoke execute on function public.pharmacist_decline_order(uuid, text) from anon;
grant execute on function public.pharmacist_decline_order(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pharmacy_orders' and column_name='refund_status'
  ) then
    raise exception 'FAIL: refund_status was not added';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_accept_order(uuid, text, bigint, timestamptz)', 'execute') then
    raise exception 'FAIL: pharmacist_accept_order is anon-executable';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_decline_order(uuid, text)', 'execute') then
    raise exception 'FAIL: pharmacist_decline_order is anon-executable';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'pharmacy_orders_enqueue_response_notifications'
      and tgrelid = 'public.pharmacy_orders'::regclass
  ) then
    raise exception 'FAIL: response notification trigger missing';
  end if;
  raise notice 'PASS: pharmacist_accept_order / pharmacist_decline_order / refund tracking installed';
end $$;
