-- Tarragon Health — Chronic Disease Programme catalogue, step 1/4
-- Extend the care_plan_condition storage enum with the three chronic
-- conditions that had no representation yet (asthma, COPD, heart failure), so
-- care_plans / medications / reviews can be authored for them.
--
-- This is deliberately a STANDALONE migration: PostgreSQL will not let a value
-- added by ALTER TYPE ... ADD VALUE be *used* in the same transaction it was
-- added in, so the catalogue seed + review-cadence backfill that reference
-- these values live in the next migration (20260717200100), which runs after
-- this one has committed.
--
-- The enum is the "what is storable ever" type; whether a condition is *live*
-- for enrolment is governed by chronic_condition_programmes.is_active (config,
-- not code), added next.

alter type public.care_plan_condition add value if not exists 'asthma';
alter type public.care_plan_condition add value if not exists 'copd';
alter type public.care_plan_condition add value if not exists 'heart_failure';
