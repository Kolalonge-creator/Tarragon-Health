-- Tarragon Health — Care Coordination Build 1: payment rail generalization
-- Adds origin + payment-correlation columns to lab_orders/pharmacy_orders/
-- specialist_referrals so a one-off Paystack/Stripe charge (see
-- lib/paystack/transactions.ts:initializeOneOffTransaction,
-- lib/stripe/checkout.ts:createOneOffCheckoutSession) can activate a
-- booking the same way subscriptions/subscription_add_ons already do.
--
-- Named payment_provider/payment_provider_ref/pending_payment_provider_ref
-- (not the bare provider/provider_ref used on subscriptions) because
-- lab_orders.provider_id already means the lab partner — a bare "provider"
-- column here would collide in meaning with an existing column.

create type public.booking_origin as enum ('patient_initiated', 'clinically_triggered', 'capitated');

alter table public.lab_orders
  add column origin public.booking_origin not null default 'patient_initiated',
  add column payment_provider public.payment_provider,
  add column payment_provider_ref text,
  add column pending_payment_provider_ref text;

alter table public.pharmacy_orders
  add column origin public.booking_origin not null default 'patient_initiated',
  add column payment_provider public.payment_provider,
  add column payment_provider_ref text,
  add column pending_payment_provider_ref text;

alter table public.specialist_referrals
  add column origin public.booking_origin not null default 'patient_initiated',
  add column payment_provider public.payment_provider,
  add column payment_provider_ref text,
  add column pending_payment_provider_ref text;

create index lab_orders_pending_payment_ref_idx
  on public.lab_orders (pending_payment_provider_ref) where pending_payment_provider_ref is not null;
create index pharmacy_orders_pending_payment_ref_idx
  on public.pharmacy_orders (pending_payment_provider_ref) where pending_payment_provider_ref is not null;
create index specialist_referrals_pending_payment_ref_idx
  on public.specialist_referrals (pending_payment_provider_ref) where pending_payment_provider_ref is not null;

-- payment_transactions: polymorphic audit trail for which booking a payment
-- event belongs to. No FK (source table varies by booking_order_type), same
-- bare-uuid-with-comment pattern as commissions.source_id.
alter table public.payment_transactions
  add column booking_order_type public.commission_type,
  add column booking_order_id uuid;

comment on column public.payment_transactions.booking_order_id is
  'lab_order / pharmacy_order / specialist_referral id, disambiguated by booking_order_type. No FK: polymorphic across three tables.';
