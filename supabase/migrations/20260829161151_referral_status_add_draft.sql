-- Tarragon Health — referral_status gains 'draft': the first stage of 67.4's
-- pipeline (Draft -> Submitted -> ...), currently missing entirely — every
-- existing referral is created already-live (status defaults to 'pending').
--
-- Own migration for the same same-transaction-enum-use reason as the
-- emergency urgency value above.
--
-- A draft referral is a clinician's own in-progress work: not yet a live
-- episode, not visible to the patient — your-referrals.tsx's patient-facing
-- query explicitly excludes it. The live staleness sweeps
-- (private.remind_patients_stale_referrals / raise_stale_referral_outreach_tasks
-- / raise_stale_urgent_referral_alerts, 20260828232027) already filter on
-- status not in ('closed', 'declined'), which incidentally also excludes
-- 'draft' — nothing further needed there.

alter type public.referral_status add value if not exists 'draft';
