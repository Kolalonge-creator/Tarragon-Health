-- DW-03 (founder and CMO, 2026-11-06): three real working states for an escalation. Values only; this file must stand alone because a
-- new enum value cannot be used in the transaction that adds it. The rules that govern them are in the next migration
-- (*_dw03_escalation_working_states_rules.sql). Live public.escalations had 0 rows on 2026-11-06.
alter type public.escalation_status add value if not exists 'awaiting_information' after 'under_review';
alter type public.escalation_status add value if not exists 'patient_contact_required' after 'awaiting_information';
alter type public.escalation_status add value if not exists 'monitoring' after 'patient_contact_required';
