-- S90: four new outreach_trigger_type values for the coordinator call step of the governed care-gap engine
-- (next migration). Deliberately its own migration: ALTER TYPE ... ADD VALUE cannot be used in the same transaction
-- that adds it, the same reason 20260829221506 is separate.
--
-- Only four, not five: a rising blood pressure trend is a judgement item and routes to a doctor, never to a coordinator
-- task, so it has no outreach task type. Both laboratory gaps (HbA1c and lipids) share gap_lab_overdue because
-- care_outreach_tasks keeps one live task per patient and trigger type.

alter type public.outreach_trigger_type add value if not exists 'gap_missed_reading';
alter type public.outreach_trigger_type add value if not exists 'gap_lab_overdue';
alter type public.outreach_trigger_type add value if not exists 'gap_refill_lapse';
alter type public.outreach_trigger_type add value if not exists 'gap_adherence_lapse';
