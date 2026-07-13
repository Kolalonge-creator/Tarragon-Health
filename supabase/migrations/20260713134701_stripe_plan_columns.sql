-- Stripe equivalent of paystack_plan_code: which Stripe Product/Price backs
-- a subscription_plans/add_ons row once it's been synced (GBP/USD rows only —
-- NGN rows keep using paystack_plan_code and never populate these).
alter table public.subscription_plans
  add column stripe_price_id text,
  add column stripe_product_id text;

alter table public.add_ons
  add column stripe_price_id text,
  add column stripe_product_id text;
