-- Standalone — Postgres forbids using a newly added enum value inside the
-- same transaction that added it (error 55P04), same idiom as
-- 20260715001653_booking_status_enum_values.sql. This migration only adds
-- values; the triggers that reference 'home_visit'/'delivery' live in the
-- next migration file.

alter type public.commission_type add value if not exists 'home_visit';
alter type public.commission_type add value if not exists 'delivery';
