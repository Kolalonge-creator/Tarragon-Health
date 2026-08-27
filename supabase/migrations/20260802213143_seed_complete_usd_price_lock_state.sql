-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as the screening_ladder provider-lookup fix
-- (20260802212102_fix_screening_ladder_lab_tests_provider_lookup.sql) and
-- supabase/roles.sql's header: a later migration's assertion depends on
-- state that, on the live project, was established by real production data
-- (a real subscriber), not by any migration SQL.
--
-- 20260802214403_deactivate_stale_locked_complete_usd.sql asserts
-- complete_usd ends up price_locked with price_minor = 1099 ($10.99). On
-- the live project that's true because a real subscriber ("Test Diaspora
-- Patient") subscribed to it, and the trigger added in
-- 20260712201431_subscription_plans_paystack_sync.sql
-- (private.lock_subscription_plan_price(), fired from a real INSERT into
-- subscriptions with status active/trialing) flipped price_locked to true
-- at that point -- which then made 20260802213144_diaspora_usd_processing_fee.sql's fee
-- recompute skip this row entirely, per that migration's own comment ("complete_usd
-- carries one real active subscriber... and stays exactly as it is").
-- A fresh replay has no such subscriber, so the trigger never fires, the
-- row stays unlocked, and 213144's recompute updates its price to the new
-- fee-inclusive rate instead of leaving it at 1099 -- failing 214403's
-- assertion.
--
-- Placed one second before 20260802213144 (the point in history where this
-- state already existed live), so 213144's own recompute correctly treats
-- this row as locked-and-skip, exactly reproducing the live sequence.
-- Guarded to change nothing if the row already matches (harmless either
-- way on live, where it's already true).
update public.subscription_plans
   set price_locked = true,
       price_minor = 1099
 where code = 'complete_usd'
   and (not price_locked or price_minor is distinct from 1099);

-- Temporary diagnostic (2026-08-27): the CI run right after this fix landed
-- still failed 213144's "a price-locked USD plan was disturbed" check for
-- reasons not yet understood from static reading alone -- manual math
-- (complete = 1500000 kobo, ngn_per_usd = 1365) says round(1500000/1365) is
-- 1099, which should already satisfy that check. Dumping the actual runtime
-- values so the next CI log shows what's really happening instead of more
-- guessing. Remove this block once the real cause is found.
do $$
declare
  v_rate numeric;
  v_base bigint;
  v_row record;
begin
  select ngn_per_usd into v_rate from public.platform_currency_settings where id;
  select price_minor into v_base from public.subscription_plans where code = 'complete';
  raise notice 'DIAGNOSTIC: ngn_per_usd=%, complete.price_minor=%, round=%',
    v_rate, v_base, (case when v_rate is null or v_rate <= 0 then null else round(v_base / v_rate) end);
  for v_row in
    select code, currency, price_minor, price_locked, is_active, derived_from_code
    from public.subscription_plans
    where currency = 'USD' and price_locked
  loop
    raise notice 'DIAGNOSTIC locked USD row: code=%, price_minor=%, is_active=%, derived_from_code=%',
      v_row.code, v_row.price_minor, v_row.is_active, v_row.derived_from_code;
  end loop;
end $$;
