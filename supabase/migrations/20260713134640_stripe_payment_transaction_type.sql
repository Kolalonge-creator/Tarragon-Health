-- Standalone: adds the Stripe renewal-charge event type to payment_transaction_type.
-- Must be its own migration — Postgres forbids using a newly added enum value
-- inside the same transaction that added it (error 55P04), so nothing else
-- (webhook code, seed inserts) may reference 'invoice.payment_succeeded'
-- until this has landed on its own.
alter type public.payment_transaction_type add value if not exists 'invoice.payment_succeeded';
