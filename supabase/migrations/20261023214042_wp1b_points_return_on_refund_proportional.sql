-- WP1b: points spent on an order come back when the order is refunded, in proportion to the money refunded, exactly once.
--
-- WHAT EXISTED (read first). S58b (20261023164200) already returns the points of a FULL refund: private.orders_pricing_effects has a 'refunded'
-- branch that writes one 'release' ledger row (reason order_refunded, source orders/<order>) and adds it back to wellness_points_balances. That
-- is the S73 order-bound reduction path (price_quote_calc -> orders.points_applied -> spent on paid), not the dropped apply_points_discount path.
-- This migration adds only what was missing:
--   * PROPORTIONAL return. A refund of R kobo on an order that charged O kobo returns floor(spent * R / O) points, never more than are still
--     outstanding (spent minus everything already returned for this order). A full refund (R = O) returns exactly what was spent. Rounding is down:
--     a partial refund may keep a fraction of one point, never invent one.
--   * A hook on the refund row itself (public.refunds -> 'approved'), because a partial refund does not need to flip the order: the refund row
--     carries the refunded amount. The ledger key is (patient, 'refunds', refund id, 'order_refunded'), so replaying the approval is a no-op.
--   * The old order-keyed branch now runs only when NO refund row exists for the order (some routes flip an order to 'refunded' without one), so
--     a partial refund (which flips the order too) is not turned into a full return. It counts what a refund row already returned, and the refund
--     hook counts what the order branch already returned, so the two can never add up to more than was spent.
-- Ledger only: no kobo balance, no conversion (INV-09). Returned points are kind 'release' like S58b's, so tiers, caps and badges never count them
-- as earning. Points values, the switch pricing.rules.points.enabled (false) and the apply path are NOT touched.
-- Today refunds.amount_kobo always equals the order amount and refunds_one_live allows one live refund per order, so every refund in the system is
-- a full one; the proportional rule is in place for the day a partial refund is created, and is proved with one now.
-- A failure to return points never blocks approving a refund: it is recorded in audit_log (with the organisation) and the points can be returned by
-- hand from the ledger. The refund hook's error log is itself unable to fail.
-- LIVE CHECK BEFORE APPLY: re-read pg_get_functiondef for private.orders_pricing_effects; this replaces it and was written from the S58b definition.

-- ---------------------------------------------------------------------------
-- 1. The rule (pure)
-- ---------------------------------------------------------------------------
create function private.points_return_for_refund(p_spent integer, p_refund_kobo bigint, p_order_kobo bigint) returns integer
language sql immutable set search_path = ''
as $$
  select case
    when coalesce(p_spent, 0) <= 0 or coalesce(p_refund_kobo, 0) <= 0 or coalesce(p_order_kobo, 0) <= 0 then 0
    else ((p_spent::bigint * least(p_refund_kobo, p_order_kobo)) / p_order_kobo)::integer
  end
$$;
revoke all on function private.points_return_for_refund(integer, bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The shared core: return what is owed, once, capped by what is still outstanding
-- ---------------------------------------------------------------------------
create function private.return_points_for_order(p_order uuid, p_source_table text, p_source_id uuid, p_refund_kobo bigint) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_bal public.wellness_points_balances%rowtype;
  v_spent integer;
  v_back integer;
  v_give integer;
  v_ledger uuid;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.points_applied <= 0 then return 0; end if;
  -- the balance row is the lock: two refunds for one person cannot interleave
  select * into v_bal from public.wellness_points_balances where patient_id = o.buyer_profile_id for update;
  if not found then return 0; end if;
  select -l.points into v_spent from public.wellness_points_ledger l
   where l.patient_id = o.buyer_profile_id and l.source_table = 'orders' and l.source_id = o.id and l.reason = 'applied_to_order' and l.points < 0;
  if not found or v_spent <= 0 then return 0; end if;
  select coalesce(sum(l.points), 0) into v_back from public.wellness_points_ledger l
   where l.patient_id = o.buyer_profile_id and l.reason = 'order_refunded' and l.kind = 'release'
     and ((l.source_table = 'orders' and l.source_id = o.id)
          or (l.source_table = 'refunds' and l.source_id in (select r.id from public.refunds r where r.order_id = o.id)));
  v_give := least(private.points_return_for_refund(v_spent, p_refund_kobo, o.amount_kobo), v_spent - v_back);
  if v_give <= 0 then return 0; end if;
  insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, source_table, source_id, kind)
  values (v_bal.organisation_id, o.buyer_profile_id, v_give, v_bal.balance + v_give, 'order_refunded', p_source_table, p_source_id, 'release')
  on conflict (patient_id, source_table, source_id, reason) where source_table is not null and source_id is not null do nothing
  returning id into v_ledger;
  if v_ledger is null then return 0; end if;
  update public.wellness_points_balances set balance = balance + v_give, updated_at = now() where patient_id = o.buyer_profile_id;
  return v_give;
end $$;
revoke all on function private.return_points_for_order(uuid, text, uuid, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The order branch (S58b), now only when no refund row exists for the order
-- ---------------------------------------------------------------------------
create or replace function private.orders_pricing_effects() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_bal public.wellness_points_balances%rowtype;
  v_spend integer;
begin
  if new.state is not distinct from old.state then return new; end if;
  if new.state in ('cancelled', 'failed') then
    update public.discount_redemptions set state = 'released', settled_at = now() where order_id = new.id and state = 'reserved';
  elsif new.state = 'paid' then
    update public.discount_redemptions set state = 'redeemed', settled_at = now() where order_id = new.id and state <> 'redeemed';
    if new.points_applied > 0 then
      select * into v_bal from public.wellness_points_balances where patient_id = new.buyer_profile_id for update;
      if found and v_bal.balance > 0 then
        v_spend := least(new.points_applied, v_bal.balance);
        update public.wellness_points_balances set balance = balance - v_spend, updated_at = now() where patient_id = new.buyer_profile_id;
        insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, source_table, source_id)
        values (v_bal.organisation_id, new.buyer_profile_id, -v_spend, v_bal.balance - v_spend, 'applied_to_order', 'orders', new.id)
        on conflict (patient_id, source_table, source_id, reason) where source_table is not null and source_id is not null do nothing;
      end if;
    end if;
  elsif new.state = 'refunded' and new.points_applied > 0 then
    -- a refund row (private.return_points_on_refund_approved) returns its own share; this is the full return for a route that has none
    if not exists (select 1 from public.refunds r where r.order_id = new.id) then
      perform private.return_points_for_order(new.id, 'orders', new.id, new.amount_kobo);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.orders_pricing_effects() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The refund row hook
-- ---------------------------------------------------------------------------
create function private.return_points_on_refund_approved() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.return_points_for_order(new.order_id, 'refunds', new.id, new.amount_kobo);
  exception when others then
    -- never stand in the way of a refund; record it (and swallow a failure to record)
    begin
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'refund_points_return.error', 'refund', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
    exception when others then
      null;
    end;
  end;
  return new;
end $$;
revoke all on function private.return_points_on_refund_approved() from public, anon, authenticated;
create trigger refunds_return_points after update of state on public.refunds
  for each row when (old.state = 'pending' and new.state = 'approved') execute function private.return_points_on_refund_approved();

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if private.points_return_for_refund(500, 1000, 1000) <> 500 then raise exception 'WP1b: a full refund must return everything'; end if;
  if private.points_return_for_refund(500, 250, 1000) <> 125 then raise exception 'WP1b: a quarter refund must return a quarter'; end if;
  if private.points_return_for_refund(5, 1, 3) <> 1 or private.points_return_for_refund(1, 1, 2) <> 0 then raise exception 'WP1b: rounding must be down'; end if;
  if private.points_return_for_refund(500, 5000, 1000) <> 500 then raise exception 'WP1b: a refund above the order cannot return more than spent'; end if;
  if has_function_privilege('authenticated', 'private.return_points_for_order(uuid,text,uuid,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'private.return_points_on_refund_approved()', 'EXECUTE') then
    raise exception 'WP1b: a points function is callable by a signed-in user';
  end if;
end $$;
