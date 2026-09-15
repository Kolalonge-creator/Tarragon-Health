-- §91.17 fraud detection: add the two dispute/chargeback event types before
-- either webhook can record one. Without this, payment_transactions' own
-- insert (event_type cast to this enum, done unconditionally for every
-- webhook event before any switch/case logic runs) would fail outright the
-- moment Paystack or Stripe ever sent a real dispute — meaning disputes were
-- silently unrecordable, not just unhandled.
alter type public.payment_transaction_type add value if not exists 'charge.dispute.create';
alter type public.payment_transaction_type add value if not exists 'charge.dispute.created';
