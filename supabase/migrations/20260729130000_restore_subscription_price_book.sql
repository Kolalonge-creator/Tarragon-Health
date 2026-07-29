-- ---------------------------------------------------------------------------
-- Restore the subscription price book as migration-managed data.
--
-- Removal 3, pass 1 of 2. This pass does NOT change pricing policy — it puts
-- the price book back and makes it survivable. Pass 2 collapses GBP/USD onto
-- a single naira-derived price list.
--
-- Why this is needed at all: the 2026-07-29 database restore replayed 277
-- migrations, and every plan created only by seed.sql or by a direct edit
-- against the old project was simply gone. What survived was whatever some
-- migration happened to create. The live book was 16 rows, and did NOT
-- include `essential` or `complete` — the platform's two core paid tiers.
-- It could not sell them. The rows that did survive carried pre-2026-07-21
-- values (ParentCare NGN ₦20,000 rather than the corrected ₦25,000,
-- Diaspora Premium £99 rather than the rebased £49).
--
-- seed.sql only runs on a local `supabase db reset`; it is not applied to a
-- remote project. So pricing must live in migrations, which is what this is.
-- Values are taken verbatim from seed.sql, which was verified this pass
-- against apps/web/src/app/(marketing)/_content/pricing.ts — the declared
-- source of truth — for every tier in both currencies.
--
-- Safe to reprice: 0 subscriptions, 0 subscription_add_ons and 0 price-locked
-- rows exist, checked immediately before writing this.
--
-- Two deliberate omissions:
--   * `family_gbp` (£80/yr) and `family_usd` ($100/yr) are NOT recreated.
--     They are the stale rows that were found live and purchasable during the
--     2026-07-21 pricing audit — a real revenue leak — and were permanently
--     retired. Restoring them dormant would only invite reactivation.
--   * is_active is never copied from seed. Activation is earned by a
--     successful Paystack/Stripe sync, never asserted by a data load; see the
--     re-sync step below.
-- ---------------------------------------------------------------------------

-- Remember what each row cost before this migration touched it, so the
-- re-sync step can tell a genuine price change from a no-op.
create temp table _price_before on commit drop as
  select code, price_minor from public.subscription_plans;
create temp table _addon_price_before on commit drop as
  select code, price_minor from public.add_ons;

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features)
values
  ('free', 'Tarragon Free',
     'Self-tracking, reminders, education, Health Passport. No doctor review on this plan.',
     0, 'NGN', 'monthly', array['tracking', 'reminders', 'education']),
  ('essential', 'Essential Care',
     'One condition: monthly doctor review, monthly doctor check-in, WhatsApp care team access.',
     800000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('essential_yearly', 'Essential Care (yearly)',
     'Essential Care billed annually — 2 months free.',
     8000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('complete', 'Complete Care',
     'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     1500000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('complete_yearly', 'Complete Care (yearly)',
     'Complete Care billed annually — 2 months free.',
     15000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family', 'Family Lite',
     'Up to 4 people at Complete Care–level monitoring, shared family dashboard, one combined bill, monthly family report.',
     15000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit'])
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features;

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features)
values
  ('family_plus', 'Family Plus',
     'Everything in Family Lite, plus a named family doctor coordinator, priority escalation across all members, and one free Annual Health Check a year.',
     22000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family_premium', 'Family Premium',
     'Everything in Family Plus, plus a named doctor coordinator with a scheduled monthly appointment for every member, quarterly reports, expedited response, and two free Annual Health Checks a year.',
     32000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'expedited_response', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('parentcare', 'ParentCare',
     'Dedicated monitoring for up to 2 parents: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination.',
     2500000, 'NGN', 'monthly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('parentcare_yearly', 'ParentCare (yearly)',
     'ParentCare billed annually — 2 months free.',
     25000000, 'NGN', 'yearly',
     array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit'])
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features;

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features)
values
  ('prevent', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     350000, 'NGN', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education']),
  ('prevent_yearly', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     3500000, 'NGN', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education']),
  ('prevent_gbp', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     700, 'GBP', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education']),
  ('prevent_yearly_gbp', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     7000, 'GBP', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education']),
  ('prevent_usd', 'Tarragon Prevent',
     'The stay-healthy plan: personal screening calendar with booking, vaccination tracking, and personalised health education. A doctor steps in the moment a result needs one.',
     900, 'USD', 'monthly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education']),
  ('prevent_yearly_usd', 'Tarragon Prevent (yearly)',
     'Tarragon Prevent billed annually — 2 months free.',
     9000, 'USD', 'yearly',
     array['tracking', 'reminders', 'education', 'prevention_coordination', 'health_education'])
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features;

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features)
values
  ('essential_usd', 'Essential Care', 'One condition: monthly doctor review, monthly doctor check-in, WhatsApp care team access.',
     1900, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('essential_gbp', 'Essential Care', 'One condition: monthly doctor review, monthly doctor check-in, WhatsApp care team access.',
     1500, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('essential_yearly_usd', 'Essential Care (yearly)', 'Essential Care billed annually — 2 months free.',
     19000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('essential_yearly_gbp', 'Essential Care (yearly)', 'Essential Care billed annually — 2 months free.',
     15000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills']),
  ('complete_usd', 'Complete Care', 'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     3900, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('complete_gbp', 'Complete Care', 'Multiple conditions or higher risk: weekly doctor review, priority doctor escalation.',
     2900, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('complete_yearly_usd', 'Complete Care (yearly)', 'Complete Care billed annually — 2 months free.',
     39000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('complete_yearly_gbp', 'Complete Care (yearly)', 'Complete Care billed annually — 2 months free.',
     29000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family_lite_gbp', 'Family Lite', 'Up to 4 people back home on one plan: monitoring matched to each member, shared family dashboard, one combined bill, monthly family report. Billed yearly in GBP.',
     29000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family_plus_gbp', 'Family Plus', 'Everything in Family Lite, plus a named family doctor coordinator, priority escalation across all members, and one free Annual Health Check a year. Billed yearly in GBP.',
     43000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family_premium_gbp', 'Family Premium', 'Everything in Family Plus, plus a named doctor coordinator with a scheduled monthly appointment for every member, quarterly reports, expedited response, and two free Annual Health Checks a year. Billed yearly in GBP.',
     62000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'expedited_response', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family_lite_usd', 'Family Lite', 'Up to 4 people back home on one plan: monitoring matched to each member, shared family dashboard, one combined bill, monthly family report. Billed yearly in USD.',
     39000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family_plus_usd', 'Family Plus', 'Everything in Family Lite, plus a named family doctor coordinator, priority escalation across all members, and one free Annual Health Check a year. Billed yearly in USD.',
     57000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('family_premium_usd', 'Family Premium', 'Everything in Family Plus, plus a named doctor coordinator with a scheduled monthly appointment for every member, quarterly reports, expedited response, and two free Annual Health Checks a year. Billed yearly in USD.',
     82000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'expedited_response', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('diaspora_premium_gbp', 'Premium Care (Diaspora)', 'Complete Care, plus a named doctor coordinator, a scheduled monthly doctor appointment, and a quarterly PDF report.',
     4900, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'async_doctor_visit', 'lifestyle_coaching', 'health_education']),
  ('diaspora_premium_yearly_gbp', 'Premium Care (Diaspora, yearly)', 'Premium Care (Diaspora) billed annually.',
     49000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'async_doctor_visit', 'lifestyle_coaching', 'health_education']),
  ('parentcare_gbp', 'ParentCare', 'Dedicated monitoring for up to 2 parents from abroad: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination in Nigeria.',
     5900, 'GBP', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('parentcare_yearly_gbp', 'ParentCare (yearly)', 'ParentCare billed annually — 2 months free.',
     59000, 'GBP', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('parentcare_usd', 'ParentCare', 'Dedicated monitoring for up to 2 parents from abroad: named doctor coordinator, scheduled doctor review, quarterly family report, priority escalation, and lab/pharmacy coordination in Nigeria.',
     7900, 'USD', 'monthly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit']),
  ('parentcare_yearly_usd', 'ParentCare (yearly)', 'ParentCare billed annually — 2 months free.',
     79000, 'USD', 'yearly', array['chronic', 'clinician_review', 'doctor_checkin', 'lab_coordination', 'medication_refills', 'priority_escalation', 'family_dashboard', 'dedicated_coordinator', 'quarterly_report', 'annual_review', 'lifestyle_coaching', 'health_education', 'async_doctor_visit'])
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features;
insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code)
values
  ('prevention-screening', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     2500000, 'NGN', 'yearly', array['prevention_coordination'], null),
  ('care-coordinator', 'Dedicated Care Coordinator',
     'One named doctor coordinator, a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.',
     3000000, 'NGN', 'monthly', array['dedicated_coordinator'], 'complete'),
  ('extra-family-member', 'Extra Family Member',
     'Adds one more person to the Family Plan (up to 6 total) at Complete Care–level monitoring.',
     3000000, 'NGN', 'yearly', array['extra_family_slot'], 'family'),
  ('expedited-response', 'Expedited Doctor Response',
     'Doctor response time for non-emergency questions moves to under 2 hours.',
     500000, 'NGN', 'monthly', array['expedited_response'], null)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features,
  restricted_to_plan_code = excluded.restricted_to_plan_code;

insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code)
values
  ('extra-family-member-plus', 'Extra Family Member (Family Plus)',
     'Adds one more person to Family Plus (up to 6 total) at the same level of monitoring.',
     4000000, 'NGN', 'yearly', array['extra_family_slot'], 'family_plus'),
  ('extra-family-member-premium', 'Extra Family Member (Family Premium)',
     'Adds one more person to Family Premium (up to 6 total) at the same level of monitoring.',
     5500000, 'NGN', 'yearly', array['extra_family_slot'], 'family_premium'),
  ('extra-parentcare-member', 'Extra Parent (ParentCare)',
     'Adds a third parent to a ParentCare subscription at the same level of monitoring.',
     800000, 'NGN', 'monthly', array['extra_family_slot'], 'parentcare'),
  ('extra-parentcare-member-yearly', 'Extra Parent (ParentCare, yearly)',
     'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.',
     8000000, 'NGN', 'yearly', array['extra_family_slot'], 'parentcare_yearly'),
  ('extra-parentcare-member-gbp', 'Extra Parent (ParentCare)',
     'Adds a third parent to a ParentCare subscription at the same level of monitoring.',
     1900, 'GBP', 'monthly', array['extra_family_slot'], 'parentcare_gbp'),
  ('extra-parentcare-member-yearly-gbp', 'Extra Parent (ParentCare, yearly)',
     'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.',
     19000, 'GBP', 'yearly', array['extra_family_slot'], 'parentcare_yearly_gbp'),
  ('extra-parentcare-member-usd', 'Extra Parent (ParentCare)',
     'Adds a third parent to a ParentCare subscription at the same level of monitoring.',
     2500, 'USD', 'monthly', array['extra_family_slot'], 'parentcare_usd'),
  ('extra-parentcare-member-yearly-usd', 'Extra Parent (ParentCare, yearly)',
     'Adds a third parent to a yearly ParentCare subscription at the same level of monitoring.',
     25000, 'USD', 'yearly', array['extra_family_slot'], 'parentcare_yearly_usd')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features,
  restricted_to_plan_code = excluded.restricted_to_plan_code;

insert into public.add_ons (code, name, description, price_minor, currency, interval, features, restricted_to_plan_code)
values
  ('prevention-screening_usd', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     1500, 'USD', 'yearly', array['prevention_coordination'], null),
  ('prevention-screening_gbp', 'Prevention Screening Add-on',
     'Personalised screening calendar, WhatsApp reminders, booking coordination, results tracking. Does not prepay for the tests themselves.',
     1200, 'GBP', 'yearly', array['prevention_coordination'], null),
  ('care-coordinator_usd', 'Dedicated Care Coordinator',
     'One named clinician coordinator, a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.',
     2000, 'USD', 'monthly', array['dedicated_coordinator'], 'complete_usd'),
  ('care-coordinator_gbp', 'Dedicated Care Coordinator',
     'One named clinician coordinator, a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.',
     1600, 'GBP', 'monthly', array['dedicated_coordinator'], 'complete_gbp'),
  ('extra-family-member_usd', 'Extra Family Member',
     'Adds one more person to Family Lite (up to 6 total) at the same level of monitoring.',
     8000, 'USD', 'yearly', array['extra_family_slot'], 'family_lite_usd'),
  ('extra-family-member_gbp', 'Extra Family Member',
     'Adds one more person to Family Lite (up to 6 total) at the same level of monitoring.',
     6000, 'GBP', 'yearly', array['extra_family_slot'], 'family_lite_gbp'),
  ('extra-family-member-plus_gbp', 'Extra Family Member (Family Plus)',
     'Adds one more person to Family Plus (up to 6 total) at the same level of monitoring.',
     8000, 'GBP', 'yearly', array['extra_family_slot'], 'family_plus_gbp'),
  ('extra-family-member-premium_gbp', 'Extra Family Member (Family Premium)',
     'Adds one more person to Family Premium (up to 6 total) at the same level of monitoring.',
     12000, 'GBP', 'yearly', array['extra_family_slot'], 'family_premium_gbp'),
  ('extra-family-member-plus_usd', 'Extra Family Member (Family Plus)',
     'Adds one more person to Family Plus (up to 6 total) at the same level of monitoring.',
     11000, 'USD', 'yearly', array['extra_family_slot'], 'family_plus_usd'),
  ('extra-family-member-premium_usd', 'Extra Family Member (Family Premium)',
     'Adds one more person to Family Premium (up to 6 total) at the same level of monitoring.',
     16000, 'USD', 'yearly', array['extra_family_slot'], 'family_premium_usd'),
  ('expedited-response_usd', 'Expedited Clinician Response',
     'Clinician response time for non-emergency questions moves to under 2 hours.',
     300, 'USD', 'monthly', array['expedited_response'], null),
  ('expedited-response_gbp', 'Expedited Clinician Response',
     'Clinician response time for non-emergency questions moves to under 2 hours.',
     250, 'GBP', 'monthly', array['expedited_response'], null)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features,
  restricted_to_plan_code = excluded.restricted_to_plan_code;

-- ---------------------------------------------------------------------------
-- Re-sync gate.
--
-- Paystack Plan and Stripe Price objects are amount-immutable: you cannot
-- edit what an existing one charges. So any row whose price moved here now
-- points at a provider object for the OLD amount, and any row created here
-- has no provider object at all. Both must be taken out of circulation until
-- an admin re-syncs them via /admin/settings/subscriptions, or a buyer could
-- be charged a price this migration just retired.
--
-- Rows whose price is unchanged keep their provider object and their
-- activation state untouched.
-- ---------------------------------------------------------------------------

update public.subscription_plans p
set is_active = false,
    paystack_plan_code = null,
    stripe_price_id = null,
    stripe_product_id = null
where coalesce((select b.price_minor from _price_before b where b.code = p.code), -1)
      is distinct from p.price_minor;

update public.add_ons a
set is_active = false,
    paystack_plan_code = null,
    stripe_price_id = null,
    stripe_product_id = null
where coalesce((select b.price_minor from _addon_price_before b where b.code = a.code), -1)
      is distinct from a.price_minor;

-- Separately: the restore left three add-ons (health-education,
-- lifestyle-coaching, annual-review) flagged active with NO provider object in
-- either column. Their Paystack/Stripe references were data-only and died with
-- everything else the rebuild dropped, but their is_active=true came back
-- through a migration. That combination is a broken checkout waiting to
-- happen — a patient can select the add-on and there is nothing to charge
-- against. Not caused by this migration, but it is the same invariant, so it
-- is corrected here rather than left for someone to hit in production.
update public.subscription_plans
set is_active = false
where is_active and paystack_plan_code is null and stripe_price_id is null;

update public.add_ons
set is_active = false
where is_active and paystack_plan_code is null and stripe_price_id is null;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
  v_bad text;
begin
  -- The whole point of the pass: the core ladder exists and is sellable once synced.
  select string_agg(c, ', ') into v_missing
  from unnest(array[
    'free','prevent','prevent_yearly','essential','essential_yearly',
    'complete','complete_yearly','family','family_plus','family_premium',
    'parentcare','parentcare_yearly'
  ]) as c
  where not exists (select 1 from public.subscription_plans p where p.code = c);
  if v_missing is not null then
    raise exception 'NGN ladder still incomplete: %', v_missing;
  end if;

  -- Prices must match the marketing page (pricing.ts), in kobo.
  select string_agg(format('%s=%s want %s', e.code, p.price_minor, e.want), ', ')
    into v_bad
  from (values
    ('free', 0), ('prevent', 350000), ('prevent_yearly', 3500000),
    ('essential', 800000), ('essential_yearly', 8000000),
    ('complete', 1500000), ('complete_yearly', 15000000),
    ('family', 15000000), ('family_plus', 22000000), ('family_premium', 32000000),
    ('parentcare', 2500000), ('parentcare_yearly', 25000000)
  ) as e(code, want)
  join public.subscription_plans p on p.code = e.code
  where p.price_minor <> e.want;
  if v_bad is not null then
    raise exception 'NGN prices disagree with the marketing page: %', v_bad;
  end if;

  -- The legacy leak rows must stay gone.
  if exists (select 1 from public.subscription_plans where code in ('family_gbp','family_usd')) then
    raise exception 'the retired family_gbp/family_usd rows were recreated';
  end if;

  -- Nothing may be sellable without a provider object behind it, in either table.
  select string_agg(code, ', ') into v_bad from (
    select code from public.subscription_plans
     where is_active and paystack_plan_code is null and stripe_price_id is null
    union all
    select code from public.add_ons
     where is_active and paystack_plan_code is null and stripe_price_id is null
  ) x;
  if v_bad is not null then
    raise exception 'active but not synced to any provider: %', v_bad;
  end if;

  -- A repriced row must not still point at a provider object for the old amount.
  select string_agg(p.code, ', ') into v_bad
  from public.subscription_plans p join _price_before b on b.code = p.code
  where b.price_minor <> p.price_minor
    and (p.paystack_plan_code is not null or p.stripe_price_id is not null);
  if v_bad is not null then
    raise exception 'repriced rows still carry a stale provider object: %', v_bad;
  end if;
end $$;
