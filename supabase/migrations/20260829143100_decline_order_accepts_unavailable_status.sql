-- Tarragon Health — close a refund dead-end introduced by pharmacist_flag_unavailable
--
-- pharmacist_flag_unavailable (20260829142946_medication_dispensing_
-- fulfilment_rpcs.sql) moves a paid order to the new 'unavailable' status as
-- a substitution checkpoint, not a cancellation — deliberately not the same
-- thing as pharmacist_decline_order. But pharmacist_decline_order's own
-- status check (20260828232556_pharmacy_order_acceptance_decline_refund.sql)
-- only allows declining from 'payment_confirmed', 'requested', or
-- 'confirmed' — 'unavailable' was never added to that list, because that
-- migration predates 'unavailable' existing at all. The result: a
-- pharmacist who flags an order unavailable and then finds no workable
-- substitution has no way to cancel it and refund the patient — the order
-- is stuck, paid for, at a status nothing can move on from.
--
-- Fix is a one-line widen of the status check, nothing else: the resulting
-- notification trigger already fires on the TO status ('cancelled' +
-- declined_by is not null), not the FROM status, so no other change is
-- needed for the refund/notification path to work correctly from
-- 'unavailable' too.

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
  if v_order.status not in ('payment_confirmed', 'requested', 'confirmed', 'unavailable') then
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

-- The migration is the test.
do $$
begin
  if not exists (
    select 1 from pg_proc
     where proname = 'pharmacist_decline_order' and pronamespace = 'public'::regnamespace
       and pg_get_functiondef(oid) like '%''unavailable''%'
  ) then
    raise exception 'pharmacist_decline_order does not reference the unavailable status';
  end if;
end $$;
