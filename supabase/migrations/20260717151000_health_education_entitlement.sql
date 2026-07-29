-- Tarragon Health — Health Education entitlement wiring
--
-- Gates the personalised health-education pathway (20260717150000) to the same
-- tiers as the lifestyle layer: complete / family / parentcare get the
-- `health_education` feature on their plan; essential patients can buy it as a
-- `health-education` add-on. No new billing code — only data on the existing
-- subscription_plans.features[] / add_ons plumbing.
--
-- NB: the Free plan's existing generic `education` feature (Health Passport,
-- reminders) is deliberately UNTOUCHED and distinct — `health_education` is the
-- personalised, condition-driven, clinician-reviewed engine. See the pathway spec.
--
-- Idempotent: only appends the flag where absent; add-on inserts are
-- on-conflict-do-nothing. Also lands in supabase/seed/seed.sql for fresh envs.

-- ---------------------------------------------------------------------------
-- 1. Append `health_education` to the entitled plans (complete / family /
--    parentcare, all currency + interval variants), only where not already set.
-- ---------------------------------------------------------------------------
update public.subscription_plans
   set features = array_append(features, 'health_education')
 where code in (
         'complete', 'complete_yearly',
         'complete_usd', 'complete_gbp', 'complete_yearly_usd', 'complete_yearly_gbp',
         'family', 'family_usd', 'family_gbp',
         'parentcare', 'parentcare_yearly',
         'parentcare_gbp', 'parentcare_yearly_gbp',
         'parentcare_usd', 'parentcare_yearly_usd'
       )
   and not ('health_education' = any(features));

-- ---------------------------------------------------------------------------
-- 2. `health-education` add-on for essential patients (NGN + diaspora variants).
--    is_active=false until an admin syncs each to a real Paystack/Stripe price
--    via /admin/settings/subscriptions — same activation gate as every add-on.
-- ---------------------------------------------------------------------------
insert into public.add_ons
  (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code, is_active)
values
  ('health-education', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     500000, 'NGN', 'monthly', array['health_education'], 'essential', true),
  ('health-education_usd', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     300, 'USD', 'monthly', array['health_education'], 'essential_usd', false),
  ('health-education_gbp', 'Health Education',
     'Personalised, clinician-reviewed learning built around your conditions, with short knowledge checks. Included free on Complete Care and above.',
     250, 'GBP', 'monthly', array['health_education'], 'essential_gbp', false)
on conflict (code) do nothing;
