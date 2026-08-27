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
