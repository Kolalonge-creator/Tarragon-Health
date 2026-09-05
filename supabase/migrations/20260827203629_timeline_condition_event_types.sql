-- Patient Health Record architecture review — three new timeline_event_type
-- values: two for the problem list (patient_conditions), one for the
-- medication Patient-Received event — both built in later migrations.
--
-- Postgres forbids using a freshly-added enum value in the same
-- transaction/migration that adds it — same gotcha this codebase has hit
-- before (20260730114022_patient_timeline_dispense_event_type.sql), so the
-- enum values are added alone here, referenced only in later migrations.

alter type public.timeline_event_type add value if not exists 'condition_recorded';
alter type public.timeline_event_type add value if not exists 'condition_status_changed';
alter type public.timeline_event_type add value if not exists 'medication_received';
