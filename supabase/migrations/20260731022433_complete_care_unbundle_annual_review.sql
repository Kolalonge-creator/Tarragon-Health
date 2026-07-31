-- Founder decision 2026-07-31: Complete Care stays at its current price
-- (₦15,000/mo — the plan is price_locked anyway, so its price could not have
-- moved without cloning a new plan). Instead, the Annual Doctor Review comes
-- out of Complete's bundled features and becomes something a Complete
-- subscriber buys separately via the existing `annual-review` add-on
-- (₦70,000/yr NGN, $51.28/yr USD — both already is_active=true with real
-- Paystack/Stripe objects and no plan restriction, so no other config change
-- is needed for the add-on itself to become purchasable by a Complete
-- subscriber). This matches the treatment Complete Care already gives the
-- Annual Health Check ("not bundled free... so the price you see is the
-- price you actually pay").
--
-- Zero live impact: confirmed via a live count before this migration that
-- there are currently 0 active subscriptions on any complete/complete_yearly/
-- complete_usd/complete_yearly_usd plan (only 2 active subscriptions exist
-- platform-wide, both on other plans) — so there is no existing subscriber
-- to grandfather. Feature-only update, deliberately not touching price_minor
-- anywhere, so the price_locked flag (stale from a since-removed test
-- subscriber) is correctly left untouched and unrelated to this change.

update public.subscription_plans
set features = array_remove(features, 'annual_review')
where code in ('complete', 'complete_yearly', 'complete_usd', 'complete_yearly_usd')
  and 'annual_review' = any(features);

do $$
declare
  v_remaining int;
begin
  select count(*) into v_remaining
  from public.subscription_plans
  where code in ('complete', 'complete_yearly', 'complete_usd', 'complete_yearly_usd')
    and 'annual_review' = any(features);
  if v_remaining <> 0 then
    raise exception 'complete_care_unbundle_annual_review: % Complete Care plan row(s) still carry annual_review', v_remaining;
  end if;
end $$;
;
