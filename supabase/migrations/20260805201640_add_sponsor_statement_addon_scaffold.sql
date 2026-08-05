-- Scaffold only, deliberately NOT marketed yet (see pricing.ts / this
-- session's summary): a genuinely new, sold-separately product for a
-- supporter/sponsor, independent of any patient plan (derived_from_code null
-- on the NGN row, so it is priced on its own merit rather than converted from
-- a patient tier).
--
-- Two real gaps stand between this row and being sellable, both left open on
-- purpose rather than papered over:
-- 1. subscription_add_ons.subscription_id is NOT NULL, i.e. every add-on today
--    attaches to a patient's own paid subscription. A pure supporter with no
--    subscription of their own has nothing to attach this to yet — needs a
--    schema decision (a nullable/sponsor-keyed attachment path), not a
--    workaround here.
-- 2. No UI reads this code at all: /patient/supporting has no gated feature
--    behind it. Selling it before either of those exists would be exactly the
--    "advertised a product with no checkout path" mistake this project has
--    fixed more than once (Dedicated Care Coordinator, Starter Kit).
--
-- is_active stays false (no Paystack/Stripe sync attempted) until both are
-- resolved.

insert into public.add_ons (code, name, description, price_minor, currency, interval, is_active, derived_from_code, restricted_to_plan_code)
values (
  'sponsor-statement',
  'Sponsor Statement',
  'A single, exportable statement of everything you have funded across everyone you support: total funded, a per-person breakdown, and every voucher used, in one place instead of opening each person''s card separately.',
  200000,
  'NGN',
  'monthly',
  false,
  null,
  null
);

insert into public.add_ons (code, name, description, price_minor, currency, interval, is_active, derived_from_code, restricted_to_plan_code)
values (
  'sponsor-statement_usd',
  'Sponsor Statement',
  'A single, exportable statement of everything you have funded across everyone you support: total funded, a per-person breakdown, and every voucher used, in one place instead of opening each person''s card separately.',
  private.expected_derived_price_minor(200000, 'USD'),
  'USD',
  'monthly',
  false,
  'sponsor-statement',
  null
);
