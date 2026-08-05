-- Raise NGN tier prices: Prevent ₦3,500→₦5,000/mo, Essential ₦8,000→₦10,000/mo,
-- Complete ₦15,000→₦20,000/mo (yearly kept at the existing 10x-monthly "2
-- months free" pattern). Also fold the Prevent-tier screening/vaccination
-- coordination entitlement into Essential and Complete, so a chronic-care
-- subscriber isn't missing preventive screening entirely (they previously
-- inherited from Free, not Prevent).
--
-- Four of the six rows (prevent, essential, complete, complete_yearly) carry
-- price_locked=true with one active subscriber each — founder-confirmed test
-- accounts, override explicitly authorized.
-- private.enforce_subscription_plan_price_lock() reads OLD.price_locked, so
-- it must be unset in its own statement before the price-changing statement
-- runs, not in the same SET clause.
--
-- Every changed row has its Paystack/Stripe references cleared and is
-- deactivated, matching the existing bulk price-adjustment convention in
-- price-adjustment.ts: Paystack Plans / Stripe Prices are immutable on
-- amount, so each needs a fresh "Sync now" in /admin/settings/subscriptions
-- before checkout works again at the new price.

update public.subscription_plans
set price_locked = false
where code in ('prevent', 'essential', 'complete', 'complete_yearly');

update public.subscription_plans
set price_minor = 500000,
    paystack_plan_code = null, stripe_price_id = null, stripe_product_id = null,
    is_active = false
where code = 'prevent';

update public.subscription_plans
set price_minor = 5000000,
    paystack_plan_code = null, stripe_price_id = null, stripe_product_id = null,
    is_active = false
where code = 'prevent_yearly';

update public.subscription_plans
set price_minor = 1000000,
    paystack_plan_code = null, stripe_price_id = null, stripe_product_id = null,
    is_active = false,
    features = array(select distinct unnest(features || array['prevention_coordination']))
where code = 'essential';

update public.subscription_plans
set price_minor = 10000000,
    paystack_plan_code = null, stripe_price_id = null, stripe_product_id = null,
    is_active = false,
    features = array(select distinct unnest(features || array['prevention_coordination']))
where code = 'essential_yearly';

update public.subscription_plans
set price_minor = 2000000,
    paystack_plan_code = null, stripe_price_id = null, stripe_product_id = null,
    is_active = false,
    features = array(select distinct unnest(features || array['prevention_coordination']))
where code = 'complete';

update public.subscription_plans
set price_minor = 20000000,
    paystack_plan_code = null, stripe_price_id = null, stripe_product_id = null,
    is_active = false,
    features = array(select distinct unnest(features || array['prevention_coordination']))
where code = 'complete_yearly';

-- Recompute every USD row derived from the six rows above (private.
-- recompute_derived_prices applies the same clear-refs+deactivate treatment,
-- and silently skips complete_usd, which is separately price_locked and
-- already parked inactive since 2026-08-02).
select private.recompute_derived_prices() as recompute_result;
