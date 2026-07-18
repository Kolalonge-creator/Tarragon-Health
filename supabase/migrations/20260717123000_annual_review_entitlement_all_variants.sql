-- Tarragon Health — grant the `annual_review` feature to ALL currency/interval
-- variants of the comprehensive paid tiers, not just the canonical NGN codes.
--
-- 20260717120000 granted it to the base codes (complete/family/parentcare +
-- _yearly). But each tier also has _gbp/_usd (and _yearly_gbp/_usd) rows, which
-- are separate subscription_plans rows with their own features[]. A diaspora
-- patient on parentcare_usd must get the same programme as one on parentcare.
-- Prefix-match every variant of the three comprehensive tiers. Features-only
-- update (no price/currency/interval change) so the price-lock trigger allows
-- it even for plans with active subscribers.
update public.subscription_plans
  set features = (select array(select distinct unnest(coalesce(features, '{}') || array['annual_review'])))
  where (code like 'complete%' or code like 'family%' or code like 'parentcare%')
    and not ('annual_review' = any(coalesce(features, '{}')));
