-- ---------------------------------------------------------------------------
-- Diaspora USD processing fee (20260802213144_diaspora_usd_processing_fee).
--
-- Two things to prove: (1) private.expected_derived_price_minor bakes the fee
-- into the recompute for every unlocked USD-derived row, and (2) a
-- price-locked row (an existing subscriber) is completely untouched by that
-- same recompute rather than aborting the whole pass, which is the real bug
-- this migration fixed (found live: complete_usd carried a real subscriber
-- and every prior rate-change path had never been exercised against one).
--
-- Uses a temporary naira "parent" row + two USD "child" rows (one locked, one
-- not) rather than touching real subscription_plans codes, so this never
-- collides with whatever real plans exist on the environment it runs against.
-- Rolled back at the end; nothing here should survive.
-- ---------------------------------------------------------------------------

begin;

-- A private, throwaway parent/child pair.
insert into public.subscription_plans
  (code, name, description, currency, price_minor, interval, features, is_active)
values
  ('__test_parent_ngn', 'Test parent', 'test fixture', 'NGN', 1000000, 'monthly', '{}', false);

-- private.enforce_derived_price fires on INSERT too, so the initial
-- price_minor must already match the formula (it will be wrong the moment
-- the parent's price changes below, which is the point).
insert into public.subscription_plans
  (code, name, description, currency, price_minor, interval, features, is_active, derived_from_code)
values
  ('__test_unlocked_usd', 'Test unlocked', 'test fixture', 'USD',
    private.expected_derived_price_minor(1000000, 'USD'), 'monthly', '{}', false, '__test_parent_ngn'),
  ('__test_locked_usd', 'Test locked', 'test fixture', 'USD',
    private.expected_derived_price_minor(1000000, 'USD'), 'monthly', '{}', false, '__test_parent_ngn');

-- The enforce-derived-price trigger fires on insert, so both children start
-- correctly derived. Lock one of them the same way a real subscription would
-- (private.enforce_subscription_plan_price_lock only refuses a WRITE against
-- a locked row; it never objects to setting price_locked itself).
update public.subscription_plans set price_locked = true where code = '__test_locked_usd';

do $$
declare
  v_rate numeric;
  v_fee numeric;
  v_expected bigint;
  v_before_locked bigint;
  v_after_locked bigint;
  v_after_unlocked bigint;
  v_locked_still_locked boolean;
begin
  select ngn_per_usd, usd_processing_fee_pct into v_rate, v_fee
    from public.platform_currency_settings where id;

  select price_minor into v_before_locked from public.subscription_plans where code = '__test_locked_usd';

  -- Nudge the naira parent's price so both children have something to
  -- recompute toward, then fire the currency-rate trigger the way an admin
  -- action would (re-saving the same rate still fires it because the parent
  -- price itself changed, which recompute_derived_prices reads live).
  update public.subscription_plans set price_minor = 2000000 where code = '__test_parent_ngn';
  perform private.recompute_derived_prices();

  select price_minor into v_after_unlocked from public.subscription_plans where code = '__test_unlocked_usd';
  select price_minor, price_locked into v_after_locked, v_locked_still_locked
    from public.subscription_plans where code = '__test_locked_usd';

  v_expected := round(2000000 / v_rate * (1 + v_fee));

  -- 1. The unlocked row picked up the fee-inclusive number.
  if v_after_unlocked is distinct from v_expected then
    raise exception 'unlocked derived row did not recompute correctly: got % expected %',
      v_after_unlocked, v_expected;
  end if;

  -- 2. The locked row is byte-for-byte untouched: same price as before the
  -- parent moved, still locked. This is the bug fix — recompute must not
  -- abort or silently drop this row, it must skip it cleanly.
  if v_after_locked is distinct from v_before_locked then
    raise exception 'locked row price moved from % to % -- recompute must never touch a locked row',
      v_before_locked, v_after_locked;
  end if;
  if not v_locked_still_locked then
    raise exception 'locked row lost its price_locked flag during recompute';
  end if;

  raise notice 'diaspora_processing_fee.sql: all checks passed (rate=%, fee=%, unlocked=%, locked unchanged=%)',
    v_rate, v_fee, v_after_unlocked, v_before_locked;
end $$;

rollback;
