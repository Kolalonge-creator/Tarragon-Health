-- Tarragon Health
-- Waitlist handling — enum value (split from the columns migration:
-- Postgres forbids using a newly added enum value inside the same
-- transaction that added it, error 55P04 — confirmed precedent in
-- 20260715001653_booking_status_enum_values.sql's own comment).

alter type public.referral_status add value if not exists 'waitlisted' after 'pending';
