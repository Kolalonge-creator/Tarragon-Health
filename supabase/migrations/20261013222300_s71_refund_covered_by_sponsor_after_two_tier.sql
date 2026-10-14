-- S71: put the 'covered by sponsor' answer back into request_order_refund.
--
-- S71 (checkout core) taught request_order_refund that an order a sponsor paid in full has nothing to refund to the buyer (amount_kobo = 0 -> 'covered_by_sponsor').
-- main-dev's two-tier refund migration (20261013012113_two_tier_refund_window_and_immediate_end.sql) re-created the function for the Membership refund window without that
-- rule, because S71 was not merged yet. Without it a covered order falls through to a refund insert of 0 kobo, which the refunds table refuses with a constraint error.
-- This is main-dev's current definition plus that one line. Idempotent.
CREATE OR REPLACE FUNCTION public.request_order_refund(p_order uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_refund uuid;
  v_days integer := private.membership_refund_window_days();
begin
  if v_uid is null then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order and buyer_profile_id = v_uid;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state <> 'paid' then return jsonb_build_object('result', 'order_not_paid', 'state', o.state); end if;
  -- S71: a sponsor paid this order in full (the buyer paid nothing), so there is nothing to refund to the buyer
  if o.amount_kobo = 0 then return jsonb_build_object('result', 'covered_by_sponsor'); end if;
  if exists (select 1 from public.catalog_items ci where ci.id = o.catalog_item_id and ci.kind = 'membership')
     and (o.paid_at is null or now() > o.paid_at + make_interval(days => v_days)) then
    return jsonb_build_object('result', 'outside_refund_window', 'window_days', v_days);
  end if;
  if length(coalesce(p_reason, '')) < 5 then return jsonb_build_object('result', 'reason_too_short'); end if;
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (o.organisation_id, o.id, o.amount_kobo, p_reason, v_uid, o.is_test)
  on conflict (order_id) where state in ('pending', 'approved', 'processing', 'completed') do nothing
  returning id into v_refund;
  if v_refund is null then return jsonb_build_object('result', 'already_requested'); end if;
  return jsonb_build_object('result', 'requested', 'refund_id', v_refund);
end $function$;
