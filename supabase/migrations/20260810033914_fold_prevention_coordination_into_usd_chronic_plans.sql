-- Tarragon Health — parity fix: the USD Essential/Complete variants never
-- got prevention_coordination.
--
-- Found during a 2026-08-10 preventative-programme review.
-- 20260805201508_raise_ngn_tier_prices_and_fold_prevention_into_chronic_
-- plans.sql folded prevention_coordination into essential / essential_yearly
-- / complete / complete_yearly "so a chronic-care subscriber isn't missing
-- preventive screening entirely" — but only touched those 4 NGN-priced
-- codes; the derived essential_usd / essential_yearly_usd / complete_usd /
-- complete_yearly_usd rows were left out (private.recompute_derived_
-- prices(), called at the end of that migration, recomputes price fields
-- only, not features).
--
-- Currently harmless: every one of these 4 rows already carries
-- lab_coordination, and every call site that checks prevention_coordination
-- (prevention/page.tsx, labs/page.tsx, health-check/page.tsx) does so via
-- `labCoordinationEnabled || preventionCoordinationEnabled`, so a USD
-- subscriber's screening booking already works today through the
-- lab_coordination half of that OR. This migration closes the parity gap
-- anyway so the entitlement is correct on its own terms — not dependent on
-- every future call site remembering to OR the two flags together the same
-- way these three happened to.

update public.subscription_plans
set features = array(select distinct unnest(features || array['prevention_coordination']))
where code in ('essential_usd', 'essential_yearly_usd', 'complete_usd', 'complete_yearly_usd')
  and not ('prevention_coordination' = any(coalesce(features, '{}')));

do $$
declare
  v_missing text;
begin
  select string_agg(code, ', ') into v_missing
  from public.subscription_plans
  where code in ('essential_usd', 'essential_yearly_usd', 'complete_usd', 'complete_yearly_usd')
    and not ('prevention_coordination' = any(coalesce(features, '{}')));
  if v_missing is not null then
    raise exception 'FAIL: still missing prevention_coordination: %', v_missing;
  end if;
  raise notice 'PASS: all 4 USD chronic-plan variants now carry prevention_coordination, matching their NGN siblings';
end $$;
