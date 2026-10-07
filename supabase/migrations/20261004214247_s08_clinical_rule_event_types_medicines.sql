-- S08 (medicines): three new clinical rule event types.
--
-- The v5 spec names the events dose.recorded, dose.missed and refill.due, and the
-- triage engine (S11/S12) reads signals from clinical_rule_events. The enum
-- already has `medication_dose_missed`; this adds the other three the medicines
-- module emits:
--   medication_dose_recorded  a person logged a dose (taken, late, skipped, not available)
--   medication_refill_due     the supply is running low, or the refill date is close
--   medication_adherence_low  the weekly adherence percentage is below the threshold
-- They are signals only. Nothing that reads them changes a medicine or a dose (8.6).
--
-- Kept in its own file because ALTER TYPE ... ADD VALUE cannot be used by anything
-- else in the same transaction; the next S08 migration emits these values.
--
-- Row counts: clinical_rule_events holds 21 rows (vital_recorded 12,
-- medication_prescribed 4, risk_score_updated 5), none of a new type, so no data is touched.

alter type public.clinical_rule_event_type add value if not exists 'medication_dose_recorded';
alter type public.clinical_rule_event_type add value if not exists 'medication_refill_due';
alter type public.clinical_rule_event_type add value if not exists 'medication_adherence_low';
