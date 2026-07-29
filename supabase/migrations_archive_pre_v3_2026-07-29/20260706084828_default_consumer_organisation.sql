-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 01 · Default consumer organisation — enum value only
--
-- profiles.organisation_id is nullable so a self-serve patient (e.g. WhatsApp
-- signup) can exist before being attached to a clinic/HMO/corporate tenant.
-- But every domain table (screening_schedules, care_plans, vitals_readings,
-- etc.) requires organisation_id NOT NULL, so today an org-less consumer
-- cannot get a screening schedule, care plan, or vitals row at all.
--
-- Fix: seed one "direct consumer" organisation that self-serve signups fall
-- back to (next migration), so the NOT NULL invariant holds everywhere with
-- zero changes to existing domain tables or RLS helpers.
--
-- The enum value must be added in its own migration: Postgres cannot use a
-- newly-added enum value inside the same transaction that added it.

alter type public.organisation_type add value 'direct_consumer';
