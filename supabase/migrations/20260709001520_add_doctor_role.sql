-- Tarragon Health
-- 09a · Add 'doctor' role to user_role enum.
--
-- clinician = frontline (routine monitoring, patient contact, initial
-- review, escalates when needed). doctor = escalation review only — see
-- 20260709120100_escalations_doctor_assignment.sql for the escalations
-- schema that reflects this. Simple ADD VALUE is safe here since we're
-- only adding, not removing, a value (contrast migration 07's swap-drop
-- trick, needed only for removal). Must be its own migration/transaction —
-- Postgres forbids using a just-added enum value before the adding
-- transaction commits.

alter type public.user_role add value 'doctor';
