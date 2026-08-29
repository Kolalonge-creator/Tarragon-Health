-- Tarragon Health — Specialist Care Coordination & Continuity Engine, part 4/7
-- specialist_referrals.plan_acknowledged_at/by
--
-- Referral closure (part 7 of this series) requires proof that a clinician
-- actually looked at the specialist's plan, not just that treatment_plan_note
-- has SOME text in it (today useRecordTreatmentPlanReceived lets any org
-- staff type a note with no clinical read implied). This is that proof —
-- null-gated, server-derived, same posture as reviewed_by/reviewed_at
-- elsewhere in this codebase (docs/CLINICAL_TRUST_MODEL_SPEC.md §2).
--
-- Stamped from two places (both in later migrations of this series):
--   * confirm_specialist_consultation_extraction — filing an AI-assisted
--     extraction is itself the clinical read.
--   * useRecordTreatmentPlanReceived's existing manual-note path — kept
--     working unchanged (specialists have no platform login; a manually
--     transcribed note from a phone call or a report Tarragon never got a
--     copy of is still a legitimate way a plan reaches the record), now also
--     stamping acknowledgement.

alter table public.specialist_referrals
  add column if not exists plan_acknowledged_at timestamptz,
  add column if not exists plan_acknowledged_by uuid references public.profiles (id) on delete restrict;
