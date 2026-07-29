-- Standalone — Postgres forbids using a newly added enum value inside the
-- same transaction that added it (error 55P04), so this migration only adds
-- values; nothing referencing 'pending_payment'/'payment_confirmed' or the
-- new Stripe event-type values may land in the same migration as this one.

alter type public.lab_order_status add value if not exists 'pending_payment' before 'ordered';
alter type public.lab_order_status add value if not exists 'payment_confirmed' after 'pending_payment';

alter type public.pharmacy_order_status add value if not exists 'pending_payment' before 'requested';
alter type public.pharmacy_order_status add value if not exists 'payment_confirmed' after 'pending_payment';

alter type public.referral_status add value if not exists 'pending_payment' before 'pending';
alter type public.referral_status add value if not exists 'payment_confirmed' after 'pending_payment';

-- Also fixes a pre-existing bug found while wiring the booking payment path:
-- the Stripe webhook's idempotency insert writes event.type verbatim into
-- payment_transactions.event_type, but four real Stripe event type strings
-- were never added to this enum, so every live checkout.session.completed /
-- customer.subscription.* event has been silently failing that insert (and
-- therefore never reaching the event-branching switch below it) since this
-- table was created — never caught because Stripe hasn't had real keys or a
-- live round-trip run yet (see CLAUDE.md Current Sprint, Stripe section).
alter type public.payment_transaction_type add value if not exists 'checkout.session.completed';
alter type public.payment_transaction_type add value if not exists 'customer.subscription.created';
alter type public.payment_transaction_type add value if not exists 'customer.subscription.updated';
alter type public.payment_transaction_type add value if not exists 'customer.subscription.deleted';
