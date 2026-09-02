-- Tarragon Health — Specialist Referral Engine, part 2/7: a distinct
-- timeline event for "the specialist's outcome came back."
--
-- patient_timeline (20260717221852) already logs 'referral_created' and
-- 'referral_status_changed' from specialist_referrals — the latter will
-- automatically log the new completed -> closed transition once this
-- series' closure trigger fires, no new wiring needed for that part. But
-- recording treatment_plan_note/outcome_document_path never changes
-- `status`, so today it leaves no timeline trace at all. Own migration file
-- because Postgres will not let a later statement in the same transaction
-- use an enum value ADDed earlier in that same transaction.

alter type public.timeline_event_type add value if not exists 'referral_outcome_recorded' after 'referral_status_changed';
