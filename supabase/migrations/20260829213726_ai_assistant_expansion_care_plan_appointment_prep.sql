-- AI Health Assistant expansion (§78 gap-closure): care-plan explanation,
-- appointment preparation, and audit coverage for the already-live symptom
-- triage schema.
--
-- Medication education reuses patient_result_explanations.kind = 'medication',
-- which a prior, unfinished pass already added to the CHECK constraint
-- (20260828230916_patient_result_explanations_allow_medication.sql) with no
-- application code ever built against it -- picked up here, no new migration
-- needed for that part.

-- 1. Care-plan explanation reuses the same patient_result_explanations table
--    as result/medication explanations -- one more ExplainerKind, not a new
--    table, cache, or RLS surface.
alter table public.patient_result_explanations
  drop constraint patient_result_explanations_kind_check;
alter table public.patient_result_explanations
  add constraint patient_result_explanations_kind_check
  check (kind = any (array['risk_score'::text, 'lab_analyte'::text, 'vitals'::text, 'medication'::text, 'care_plan_item'::text]));

-- 2. Appointment preparation: AI-suggested questions for an upcoming video
--    consultation, separate from the patient's own free-text
--    video_consultations.patient_prep_notes (that field already exists and
--    is unrelated -- this is a suggestion cache, not a replacement).
create table public.appointment_prep_suggestions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  consultation_id uuid not null references public.video_consultations(id) on delete cascade,
  status text not null check (status = any (array['generated'::text, 'failed'::text])),
  model_id text,
  questions jsonb not null default '[]'::jsonb,
  input_snapshot jsonb not null default '{}'::jsonb,
  error_message text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (patient_id, consultation_id)
);

alter table public.appointment_prep_suggestions enable row level security;

create policy appointment_prep_suggestions_select on public.appointment_prep_suggestions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Writes only via the service-role generator (same "app computed this on the
-- patient's behalf" rationale as ai-coach/escalate.ts and case_briefs/
-- patient_result_explanations before it) -- no insert/update/delete policy,
-- and the default-privileges grant is explicitly narrowed below rather than
-- left at its broad default (the two-layer pattern from
-- 20260827195333_record_corrections_platform_wide.sql).
revoke all on public.appointment_prep_suggestions from authenticated, anon;
grant select on public.appointment_prep_suggestions to authenticated;

drop trigger if exists audit_row_change_trg on public.appointment_prep_suggestions;
create trigger audit_row_change_trg
  after insert or update or delete on public.appointment_prep_suggestions
  for each row execute function private.audit_row_change();

-- 3. symptom_triage_assessments (live since this morning's
--    20260829095025_symptom_triage_assessments.sql, no app code built
--    against it until this pass) was never added to the row-change audit
--    trigger allowlist -- closing that gap now that it's about to carry
--    real patient-reported data.
drop trigger if exists audit_row_change_trg on public.symptom_triage_assessments;
create trigger audit_row_change_trg
  after insert or update or delete on public.symptom_triage_assessments
  for each row execute function private.audit_row_change();
