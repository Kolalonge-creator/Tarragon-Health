-- Tarragon Health — Specialist Referral Engine, part 3/7: a care-outreach
-- trigger type for a referral that has stalled.
--
-- care_outreach_tasks (20260723010019) already models exactly this shape —
-- a coordinator worklist row per (patient, trigger) — for four other stale
-- conditions (high_risk_score/overdue_screening/stale_monitoring/
-- unactioned_abnormal). Section 11.12 of the task spec ("if referral is
-- clinically important: escalation... if still not booked: care coordinator
-- task") describes the same shape for a referral nobody has followed up on.
-- Own migration file for the same enum-in-same-transaction reason as the
-- previous file in this series.

alter type public.outreach_trigger_type add value if not exists 'referral_follow_up';
