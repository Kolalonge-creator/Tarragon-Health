-- ---------------------------------------------------------------------------
-- complete_usd is price-locked (one real active subscriber, "Test Diaspora
-- Patient", found live while applying 20260802213144), so the fee recompute
-- correctly left its price untouched -- but it was ALSO the only USD-derived
-- plan still is_active=true, meaning it was the one sellable dollar plan on
-- the whole platform right now, at its stale pre-fee price ($10.99, not the
-- fee-inclusive $12.09). Onboarding and /patient/subscription's "switch plan"
-- list both read is_active only (useActivePatientPlans), with no separate
-- check for price_locked, so a NEW diaspora patient -- or an existing
-- diaspora patient switching plans -- could still have bought this stale
-- price.
--
-- Deactivated here, not repriced: private.enforce_subscription_plan_price_lock
-- forbids moving this row's price while it has a subscriber, by design (their
-- price cannot change under them). Turning off new sign-ups to it is safe
-- and independent of that lock -- Stripe renews the existing subscriber's
-- subscription on schedule regardless of subscription_plans.is_active, and
-- the subscriber's own current-plan display reads their subscription's FK
-- join directly, not the is_active-filtered plans list.
--
-- Net effect: Complete Care (Diaspora) YEARLY is unaffected (already off sale
-- pending the founder's "Sync to Stripe" click, will return with the new fee
-- once synced) -- MONTHLY has no sellable row until someone clones this as a
-- new plan code at the fee-inclusive price and syncs it. Flagged, not
-- guessed at: which new code and whether monthly diaspora billing should
-- keep existing at all is the founder's call, not this migration's.
-- ---------------------------------------------------------------------------

update public.subscription_plans
   set is_active = false
 where code = 'complete_usd';

do $$
begin
  if exists (
    select 1 from public.subscription_plans
    where code = 'complete_usd' and (is_active or not price_locked or price_minor <> 1099)
  ) then
    raise exception 'complete_usd is not in the expected off-sale/still-locked/still-1099 state';
  end if;
end $$;
