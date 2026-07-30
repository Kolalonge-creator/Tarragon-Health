-- ---------------------------------------------------------------------------
-- A zero-price plan needs no payment provider object.
--
-- Fixes an overreach in 20260729130000. That migration enforced a good rule —
-- nothing may be sellable without a Paystack Plan or Stripe Price behind it —
-- but applied it to every row, including `free` at ₦0. There is nothing to
-- charge for the Free tier, so it can never acquire a provider object, so the
-- rule left it permanently deactivated. useSubscriptionPlans() filters on
-- is_active, so the Free tier would simply not appear in the plan selector.
--
-- The rule is right; it just needs the zero-price carve-out. price_adjustment.ts
-- already treats price_minor = 0 as its own case for the same reason.
-- ---------------------------------------------------------------------------

update public.subscription_plans
set is_active = true
where price_minor = 0
  and not is_active;

do $$
declare v_bad text;
begin
  -- The Free tier must be selectable.
  if not exists (select 1 from public.subscription_plans where code = 'free' and is_active) then
    raise exception 'the free plan is still not selectable';
  end if;

  -- The original rule must still hold everywhere it actually applies: no
  -- PAID row may be active without something to charge against.
  select string_agg(code, ', ') into v_bad from (
    select code from public.subscription_plans
     where is_active and price_minor > 0
       and paystack_plan_code is null and stripe_price_id is null
    union all
    select code from public.add_ons
     where is_active and price_minor > 0
       and paystack_plan_code is null and stripe_price_id is null
  ) x;
  if v_bad is not null then
    raise exception 'paid rows active with no provider object: %', v_bad;
  end if;
end $$;
