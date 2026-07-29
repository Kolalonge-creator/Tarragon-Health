-- Tarragon Health — Waist circumference core vital
--
-- Annual Health Check pathway TH-CP-AHC-001 §7: waist circumference is one of
-- the four core measurements taken at every adult check (central adiposity /
-- cardiometabolic risk; raised at M ≥94 / F ≥80 cm). It was the only §7 core
-- vital with no home in vitals_readings.
--
-- Additive faster path into the same vitals_readings table (Device & Wearable
-- rule) — a new vital_type value + a dedicated column, no parallel table.
-- ALTER TYPE ... ADD VALUE and the (unrelated) column add coexist fine here
-- because the new enum value is not itself referenced in this transaction.

alter type public.vital_type add value if not exists 'waist_circumference';

alter table public.vitals_readings
  add column if not exists waist_cm numeric(5, 1);
