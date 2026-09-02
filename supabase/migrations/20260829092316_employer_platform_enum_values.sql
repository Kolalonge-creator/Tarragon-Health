-- Employer Health Platform, part 2a/6 — enum values only.
--
-- Its own migration on purpose: `alter type ... add value` may run inside a
-- transaction on PG12+, but the new value cannot be USED in that same
-- transaction, so anything referencing these has to land in a later one.
-- Same shape as 20260706084828_default_consumer_organisation.sql.
--
-- employer_roster_status gains two states the §26.4/§26.17 lifecycle needs and
-- the original three could not express:
--   'invited'  — an invitation has actually been sent. Today a roster row sits
--                at 'pending' whether the employer added it a minute ago or
--                emailed the person three weeks back, so "who have we
--                chased?" is unanswerable.
--   'departed' — employment ended (§26.17). Distinct from 'removed', which
--                means the employer took the row off the roster (added in
--                error, duplicate). The difference matters: a departure ends
--                an entitlement and hands the person their own account back,
--                a removal never granted one.
--
-- payment_provider gains 'employer' for part 3/6: an employer-sponsored
-- benefit is a real subscriptions row whose money came from a corporate
-- invoice rather than Paystack/Stripe/wallet/voucher. Modelling it as a
-- subscription is what lets public.has_feature_access() and
-- private.patient_has_feature_access() resolve an employer benefit with no
-- change to either function — the alternative, a fourth `exists` branch
-- inside the entitlement resolver, would put employer logic into the one
-- function every paid feature on the platform already depends on.

alter type public.employer_roster_status add value if not exists 'invited';
alter type public.employer_roster_status add value if not exists 'departed';
alter type public.payment_provider       add value if not exists 'employer';
