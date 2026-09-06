-- Tarragon Health — Consultation System (docs/source consultation spec §9),
-- enhancement pass over the existing consultation infrastructure
-- (video_consultations, video_visit_requests, consult_availability_slots,
-- async_consults, clinical_encounter_notes, care_outreach_tasks, booking_requests).
--
-- This first migration only adds enum surface — a brand-new type
-- (consultation_outcome, safe to create and use in the same transaction) plus
-- two new values on the EXISTING outreach_trigger_type enum. Postgres forbids
-- using a freshly-added enum value in the same transaction that adds it, so
-- everything that actually uses 'repeated_no_show'/'consultation_follow_up'
-- lives in a follow-up migration, same discipline as
-- 20260731013535_video_visit_alternate_proposed_status_enum.sql.

-- §9.15 "Consultation outcome" — every consultation should end with one of
-- these. Lives on clinical_encounter_notes (the real, signed documentation
-- record added 2026-08-27) rather than a new column bolted onto
-- video_consultations/async_consults, so a video, phone, or in-person
-- encounter all record their outcome the same structured way.
create type public.consultation_outcome as enum (
  'reassurance',
  'continue_monitoring',
  'treatment_started',
  'treatment_changed',
  'investigation_requested',
  'referral',
  'follow_up',
  'emergency_escalation'
);

-- §9.13 "repeated no-show" high-risk pathway and §9.16 "consultation ->
-- care-plan connector" logistics follow-ups (investigation/appointment
-- booking) both route through the existing care_outreach_tasks worklist
-- (20260723010019_care_outreach_engine.sql) rather than a parallel worklist —
-- a Care Coordinator already checks that screen daily.
alter type public.outreach_trigger_type add value if not exists 'repeated_no_show';
alter type public.outreach_trigger_type add value if not exists 'consultation_follow_up';
