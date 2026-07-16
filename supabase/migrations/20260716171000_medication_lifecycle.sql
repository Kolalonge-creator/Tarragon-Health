-- Tarragon Health — medication lifecycle + specialist attribution (medication pathway, Phase 2)
--
-- Two pathway gaps closed here:
--   • Medication history (Scenario 2): stopping/switching a drug (Ramipril →
--     Losartan) must leave a complete, dated record, not just flip is_active.
--     `stopped_at` + `stopped_reason` capture when and why a medication was
--     discontinued, so the timeline stays intact for future reference.
--   • Specialist attribution (Scenario 3): a specialist-started medication
--     shows the prescriber's name and, where available, the consultation
--     document — `prescriber_name` + `prescriber_document_url` carry that.
--     `prescriber_name` is the external/specialist prescriber (not an employed
--     clinical_staff row, which is what added_by/last_confirmed_by reference).
--
-- All additive + nullable, so existing rows are untouched. `is_active` stays the
-- source of truth for "currently taking"; stopped_at/reason only annotate a
-- deactivation. Who may set these is already governed by the medications RLS +
-- enforce_medication_confirm_only trigger: a prescriber (Tier 2+/Director) or
-- the patient on their own self-/specialist-sourced rows — Tier 1 cannot,
-- because stopping requires an is_active change the trigger already blocks.

alter table public.medications
  add column if not exists stopped_at              timestamptz,
  add column if not exists stopped_reason          text,
  add column if not exists prescriber_name         text,
  add column if not exists prescriber_document_url text;
