-- Tarragon Health
-- Patient Safety & Clinical Risk Management gap-closure, item 1 of 5 (§89.2 of
-- the 2026-08-29 governance/safety spec audit). Confirmed live before writing
-- this (clinical_incident_reports_category_check, queried directly against
-- the running database rather than trusted from a local migration file --
-- this project currently has ~13 concurrent worktree sessions writing to the
-- same Supabase project, so a local-file read is not a safe source of truth
-- for "what's live" right now): the category CHECK is still exactly the 8
-- values from the 2026-08-26 near-miss log migration. Four of the spec's
-- named safety-event types (wrong patient, missed referral, device
-- malfunction, duplicate prescription) have no home and would currently be
-- filed as 'other', which loses the signal a governance reviewer or
-- underwriter most wants to query on.
--
-- Purely additive to the CHECK constraint -- no existing row's category
-- value is touched, and nothing about severity/status/the attribution
-- trigger changes.

alter table public.clinical_incident_reports
  drop constraint clinical_incident_reports_category_check;

alter table public.clinical_incident_reports
  add constraint clinical_incident_reports_category_check check (category in (
    'medication_error', 'misdiagnosis_risk', 'escalation_delay',
    'communication_breakdown', 'ai_recommendation_error',
    'protocol_deviation', 'documentation_error',
    'wrong_patient', 'missed_referral', 'device_malfunction', 'duplicate_prescription',
    'other'
  ));

comment on column public.clinical_incident_reports.category is
  'Safety-event taxonomy per docs spec §89.2. wrong_patient/missed_referral/device_malfunction/duplicate_prescription added 2026-08-29 -- previously only reachable as ''other'', which loses the signal a governance reviewer most wants to query on.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_incident_reports'::regclass
      and conname = 'clinical_incident_reports_category_check'
      and pg_get_constraintdef(oid) like '%wrong_patient%'
      and pg_get_constraintdef(oid) like '%missed_referral%'
      and pg_get_constraintdef(oid) like '%device_malfunction%'
      and pg_get_constraintdef(oid) like '%duplicate_prescription%'
  ) then
    raise exception 'clinical_incident_reports_category_check missing one of the new safety-event values';
  end if;

  -- Zero-behaviour-change proof: every existing row's category is still
  -- accepted by the new, wider constraint.
  if exists (
    select 1 from public.clinical_incident_reports
    where category not in (
      'medication_error', 'misdiagnosis_risk', 'escalation_delay',
      'communication_breakdown', 'ai_recommendation_error',
      'protocol_deviation', 'documentation_error',
      'wrong_patient', 'missed_referral', 'device_malfunction', 'duplicate_prescription',
      'other'
    )
  ) then
    raise exception 'an existing clinical_incident_reports row has a category outside the new constraint -- migration is not safe to run';
  end if;

  raise notice 'PASS: clinical_incident_reports.category now covers wrong_patient/missed_referral/device_malfunction/duplicate_prescription, zero existing rows affected';
end $$;
