-- Patient Health Record architecture review, round 3 — closing the remaining
-- MISSING items from docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md: external
-- documents (§1.21), imaging (§1.14), record reconciliation (§1.22), record
-- search (§1.19), clinical summary (§1.6). This migration only adds the new
-- timeline_event_type values each of those needs (clinical summary only
-- needs one, for the moment a doctor validates one — routine regeneration of
-- the draft is deliberately NOT a timeline event, see the clinical_summaries
-- migration header).
--
-- Postgres forbids using a freshly-added enum value in the same
-- transaction/migration that adds it — same gotcha this codebase has hit
-- before (20260730114022_patient_timeline_dispense_event_type.sql,
-- 20260827195559_timeline_condition_event_types.sql), so the values are
-- added alone here, referenced only in later migrations.
alter type public.timeline_event_type add value if not exists 'document_uploaded';
alter type public.timeline_event_type add value if not exists 'imaging_report_uploaded';
alter type public.timeline_event_type add value if not exists 'record_conflict_flagged';
alter type public.timeline_event_type add value if not exists 'record_conflict_resolved';
alter type public.timeline_event_type add value if not exists 'clinical_summary_validated';
