-- Tarragon Health
-- Paystack's POST /subscription/disable requires both the subscription
-- `code` (already stored as provider_ref) AND an `email_token`, returned
-- only on the subscription.create webhook event — without storing it,
-- cancellation from /patient/subscription would be impossible to implement
-- later. Missed in the original migration; adding now before the checkout/
-- webhook code is built on top of it.
alter table public.subscriptions
  add column provider_email_token text;

alter table public.subscription_add_ons
  add column provider_email_token text;
