-- 1. Doctor-led wording fix across all existing plan/add-on descriptions and names (name/description are not price-locked).
update subscription_plans
set description = replace(replace(description, 'clinician review', 'doctor review'), 'weekly clinician review', 'weekly doctor review')
where description ilike '%clinician%';

update subscription_plans
set description = replace(description, 'clinician', 'doctor')
where description ilike '%clinician%';

update subscription_plans
set description = 'Self-tracking, reminders, education, Health Passport. No doctor review on this plan.'
where code = 'free';

update add_ons
set name = replace(name, 'Clinician', 'Doctor'),
    description = replace(description, 'clinician', 'doctor')
where name ilike '%clinician%' or description ilike '%clinician%';

-- 2. Rename the existing 'family' plan to Family Lite (name/description only — price/currency/interval unchanged, so the price-lock trigger is untouched).
update subscription_plans
set name = 'Family Lite',
    description = 'Up to 4 people at Complete Care–level monitoring, shared family dashboard, one combined bill, monthly family report.'
where code = 'family';

-- 3. New NGN Family Plus / Family Premium tiers (inactive until synced to Paystack, matching the existing convention for unsynced rows).
insert into subscription_plans (code, name, description, price_minor, currency, interval, is_active, price_locked, features, ai_coach_daily_limit)
values
  ('family_plus', 'Family Plus', 'Everything in Family Lite, plus a named family doctor coordinator, priority escalation across all members, and one free Annual Health Check a year.', 22000000, 'NGN', 'yearly', false, false, '{}', null),
  ('family_premium', 'Family Premium', 'Everything in Family Plus, plus a named doctor coordinator with a scheduled monthly appointment for every member, quarterly reports, expedited response, and two free Annual Health Checks a year.', 32000000, 'NGN', 'yearly', false, false, '{}', null)
on conflict (code) do nothing;

-- 4. Matching extra-member add-ons for the two new family tiers (the existing 'extra-family-member' add-on stays restricted to 'family'/Family Lite).
insert into add_ons (code, name, description, price_minor, currency, interval, restricted_to_plan_code, is_active, price_locked)
values
  ('extra-family-member-plus', 'Extra Family Member (Family Plus)', 'Adds one more person to Family Plus (up to 6 total) at the same level of monitoring.', 4000000, 'NGN', 'yearly', 'family_plus', false, false),
  ('extra-family-member-premium', 'Extra Family Member (Family Premium)', 'Adds one more person to Family Premium (up to 6 total) at the same level of monitoring.', 5500000, 'NGN', 'yearly', 'family_premium', false, false)
on conflict (code) do nothing;

-- 5. Reprice the unsynced, un-subscribed GBP diaspora rows to match the new V2 marketing pricing (not price-locked, no real subscribers yet).
update subscription_plans set price_minor = 2500 where code = 'essential_gbp';
update subscription_plans set price_minor = 25000 where code = 'essential_yearly_gbp';
update subscription_plans set price_minor = 5900 where code = 'complete_gbp';
update subscription_plans set price_minor = 59000 where code = 'complete_yearly_gbp';

-- 6. New GBP diaspora Premium tier (monthly + yearly), matching the new marketing pricing table.
insert into subscription_plans (code, name, description, price_minor, currency, interval, is_active, price_locked, features, ai_coach_daily_limit)
values
  ('diaspora_premium_gbp', 'Premium Care (Diaspora)', 'Complete Care, plus a named doctor coordinator, a scheduled monthly doctor appointment, and a quarterly PDF report.', 9900, 'GBP', 'monthly', false, false, '{}', null),
  ('diaspora_premium_yearly_gbp', 'Premium Care (Diaspora, yearly)', 'Premium Care (Diaspora) billed annually.', 99000, 'GBP', 'yearly', false, false, '{}', null)
on conflict (code) do nothing;
