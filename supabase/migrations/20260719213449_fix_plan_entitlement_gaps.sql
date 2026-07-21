-- Entitlement integrity fix: four comprehensive plans marketed features that
-- their features[] array omitted, so public.has_feature_access() would hide
-- those cards from a paying subscriber (the "feature they paid for is missed"
-- failure mode). lifestyle_coaching had reached every comprehensive plan, but
-- health_education (and annual_review on diaspora Premium) were skipped here.
--
-- Ground truth: apps/web/src/app/(marketing)/_content/pricing.ts.
--   • health_education — "Included on Complete Care and above" (ADD_ONS
--     health-education). family_plus/family_premium say "Everything in Family
--     Lite" (which includes it); diaspora Premium says "Everything in Complete
--     Care" (which includes it).
--   • annual_review — "Included on the comprehensive plans (Complete, Family,
--     ParentCare)". diaspora Premium = "Everything in Complete Care" (which
--     includes it) but was missing the key.
--
-- Additive + idempotent: only appends a key when absent, never removes or
-- reorders. Features-only UPDATE (no price change), so the price-lock trigger
-- on subscription_plans does not apply.

update public.subscription_plans
set features = array_append(features, 'health_education')
where code in ('family_plus', 'family_premium', 'diaspora_premium_gbp', 'diaspora_premium_yearly_gbp')
  and not ('health_education' = any(features));

update public.subscription_plans
set features = array_append(features, 'annual_review')
where code in ('diaspora_premium_gbp', 'diaspora_premium_yearly_gbp')
  and not ('annual_review' = any(features));
