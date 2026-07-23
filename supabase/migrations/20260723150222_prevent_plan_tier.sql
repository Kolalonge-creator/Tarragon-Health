-- Tarragon Prevent — the stay-healthy plan tier.
--
-- Fills the gap between Tarragon Free (passive self-tracking) and Essential
-- Care ("one condition"): a healthy person's paid plan built on prevention.
-- Features: prevention_coordination (screening-calendar booking rights — the
-- key the prevention-screening add-on has always granted, now actually read
-- by the app) + health_education, on top of the Free basics. Deliberately no
-- 'chronic'/'clinician_review' — doctor involvement on this tier is the
-- abnormal-result escalation pipeline, which is plan-independent.
--
-- PRICING IS A PLACEHOLDER (₦3,500/mo, ₦35,000/yr; £7/£70; $9/$90) for the
-- founder to confirm. All rows seeded is_active=false per the
-- inactive-until-synced convention — an admin activates each by syncing to a
-- real Paystack Plan / Stripe Price via /admin/settings/subscriptions.

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features, is_active)
values
  ('prevent', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     350000, 'NGN', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_yearly', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     3500000, 'NGN', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_gbp', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     700, 'GBP', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_yearly_gbp', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     7000, 'GBP', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_usd', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     900, 'USD', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false),
  ('prevent_yearly_usd', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     9000, 'USD', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'], false)
on conflict (code) do nothing;
