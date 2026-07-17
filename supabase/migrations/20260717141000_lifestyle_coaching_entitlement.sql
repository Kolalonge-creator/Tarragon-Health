-- Tarragon Health — Lifestyle Coaching entitlement
--
-- Gating decision (locked with founder): lifestyle coaching is INCLUDED in
-- complete / family* / parentcare* / diaspora_premium* plans, and available as
-- an à-la-carte add-on ('lifestyle-coaching') for essential (and any lower)
-- patients. Resolution goes through the existing public.has_feature_access()
-- RPC / RequiresEntitlement — no new entitlement machinery.
--
-- The add-on is left UNRESTRICTED (restricted_to_plan_code = null, like
-- 'prevention-screening'/'expedited-response'): a complete/family/parentcare
-- subscriber already has the feature so would never buy it, while an essential
-- patient can add it. GBP/USD variants ship is_active = false until synced to
-- a real Stripe Price (same convention as the other diaspora add-ons).
--
-- Pricing is a deliberate placeholder for the founder to confirm:
--   NGN ₦15,000/mo (1,500,000 kobo), GBP £9/mo, USD $11/mo.

-- --- include the feature in the higher tiers -------------------------------
update public.subscription_plans
set features = array_append(features, 'lifestyle_coaching')
where (
    code like 'complete%'
    or code like 'family%'
    or code like 'parentcare%'
    or code like 'diaspora_premium%'
  )
  and not ('lifestyle_coaching' = any(features));

-- --- à-la-carte add-on (idempotent on code) --------------------------------
insert into public.add_ons
  (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('lifestyle-coaching', 'Lifestyle Coaching',
   'Guided diet, exercise, weight, sleep and stress coaching with periodic progress reviews from your care team.',
   1500000, 'NGN', 'monthly', array['lifestyle_coaching'], null, true),
  ('lifestyle-coaching_gbp', 'Lifestyle Coaching',
   'Guided diet, exercise, weight, sleep and stress coaching with periodic progress reviews from your care team.',
   900, 'GBP', 'monthly', array['lifestyle_coaching'], null, false),
  ('lifestyle-coaching_usd', 'Lifestyle Coaching',
   'Guided diet, exercise, weight, sleep and stress coaching with periodic progress reviews from your care team.',
   1100, 'USD', 'monthly', array['lifestyle_coaching'], null, false)
on conflict (code) do nothing;
