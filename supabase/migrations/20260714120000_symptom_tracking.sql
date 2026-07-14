-- Tarragon Health
-- Symptom tracking (docs/FULL_SPECIFICATION_V4.md §7 item "Symptom
-- Tracking — Missing — New — add in Sprint 2, cheap").
--
-- The `symptoms` table already existed from the Sprint 1 foundation
-- (20260705211129_chronic_disease.sql) with RLS already correct
-- (patient-authored: patient reads/writes own rows, staff full access) —
-- nothing has ever written to it. This migration finishes the schema
-- (structured symptom_type instead of free-text-only) and adds the
-- red-flag -> clinician_alerts escalation this table was always meant to
-- drive, mirroring handle_abnormal_screening_result()'s trigger pattern so
-- the escalation can never be silently dropped by a buggy/missing app-layer
-- check.
--
-- Deliberately app/web only — CLAUDE.md's non-negotiable WhatsApp rule
-- rules out FULL_SPECIFICATION_V4.md's "symptom check-in bot" as literally
-- described (WhatsApp is reminders + human support chat, never a data-entry
-- interface or bot-parsed platform action).
--
-- is_red_flag is computed here, not trusted from client input — a patient
-- (or a bug in the app layer) declaring their own symptom "not a red flag"
-- must not be able to suppress an escalation.

create type public.symptom_type as enum (
  'pain', 'fatigue', 'breathlessness', 'dizziness', 'palpitations', 'swelling', 'nausea', 'other'
);

-- Split into separate ALTER TABLE statements: combining ADD COLUMN and an
-- ALTER COLUMN of that same new column in one statement isn't visible to
-- Postgres within that same statement.
alter table public.symptoms add column symptom_type public.symptom_type not null default 'other';
alter table public.symptoms alter column symptom_type drop default;
alter table public.symptoms alter column description drop not null;

comment on column public.symptoms.description is 'Optional free-text detail alongside symptom_type; no longer the sole field.';

-- Symptom types that warrant escalation at a lower severity than the
-- general threshold — breathlessness/palpitations/swelling are the classic
-- chronic-disease (hypertension/CKD/heart-failure-adjacent) red flags per
-- CLAUDE.md's Chronic Disease Management scope.
create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low_threshold_types public.symptom_type[] := array['breathlessness', 'palpitations', 'swelling'];
  v_is_red_flag boolean;
begin
  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
  );
  new.is_red_flag := v_is_red_flag;

  if v_is_red_flag then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at)
    values (
      new.organisation_id,
      new.patient_id,
      'urgent_escalation',
      'open',
      format('Priority 1: red-flag symptom (%s)', new.symptom_type),
      format('Patient reported %s at severity %s/10.%s',
             new.symptom_type, new.severity,
             case when new.description is not null then ' Note: ' || new.description else '' end),
      now() + interval '4 hours'
    );
  elsif new.severity >= 5 then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      format('Symptom check: %s', new.symptom_type),
      format('Patient reported %s at severity %s/10.%s',
             new.symptom_type, new.severity,
             case when new.description is not null then ' Note: ' || new.description else '' end)
    );
  end if;

  return new;
end;
$$;

create trigger symptoms_red_flag_check
  before insert on public.symptoms
  for each row execute function private.handle_symptom_red_flag();
