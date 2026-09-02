-- Tarragon Health — Care Management Engine, step 10a
--
-- Spec §3.13 lists "missed appointments" and "failed referrals" as two of
-- the six exception types the engine should detect. The prior pass covered
-- missed monitoring, abnormal results, non-adherence, and overdue tests
-- (via patient_care_gaps + the new missed_care_task branch); these two were
-- still outstanding.
--
-- Reused, not duplicated: appointments.status = 'no_show' and
-- specialist_referrals.status = 'declined' are both real, existing terminal
-- states already written by app code today — no schema change to either
-- table, and specifically no change to specialist_referrals' status enum or
-- its own query/UI code (which 'declined' already serves double duty for —
-- rejected pre-booking AND the clinician "close" action — so adding a new,
-- more specific enum value would mean touching every status branch across
-- specialist-referrals.ts and the referrals UI for a distinction this
-- worklist doesn't need).
--
-- STANDALONE migration: ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction it runs in, same discipline as every other enum-add migration
-- in this codebase. The function reading these two new values lives in the
-- next migration.

alter type public.outreach_trigger_type add value if not exists 'missed_appointment';
alter type public.outreach_trigger_type add value if not exists 'failed_referral';
