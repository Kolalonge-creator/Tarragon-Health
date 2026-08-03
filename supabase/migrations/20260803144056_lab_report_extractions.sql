-- AI-drafted transcription of an uploaded lab report.
--
-- WHY: a patient who uses any lab and uploads the result was creating a
-- transcription job for a doctor — twenty fields typed by hand per report. That
-- is the wrong cost shape for a near-solo operation, and it is the bottleneck
-- that keeps every downstream engine (eGFR, CV risk, HbA1c trajectory, results
-- trends, the patient explainer) starved of the data it was built to read.
--
-- AI DRAFTS, NEVER DECIDES. Identical discipline to case_briefs (20260730121004)
-- and patient_result_explanations: a row here is a DRAFT shown to a clinician
-- side by side with the original document. Confirming it is a deliberate human
-- act that writes lab_analyte_readings; nothing in this table is a clinical
-- record on its own.
--
-- DELIBERATELY NOT PATIENT-READABLE. Unlike patient_result_explanations, the
-- select policy here is org-staff only. An unconfirmed machine transcription of
-- someone's results must not reach them before a clinician has looked at it —
-- that would be delivering a result without a doctor, which this platform's
-- whole abnormal-result pathway exists to prevent.
--
-- No insert/update/delete policy at all, same as case_briefs — every write goes
-- through the service-role generator in lib/lab-reports/actions.ts.

create table if not exists public.lab_report_extractions (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id),
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  -- One live extraction per document. Re-running replaces it rather than
  -- accumulating drafts a reviewer would have to choose between.
  document_id             uuid not null unique
                            references public.lab_result_documents (id) on delete cascade,
  status                  text not null
                            check (status in ('extracted', 'failed', 'confirmed', 'discarded')),
  model_id                text,
  -- Collection date as printed on the report, normalised. This — not the upload
  -- time — is what lab_analyte_readings.taken_at gets on confirm, so a report
  -- uploaded months late still lands in the right place on the trend line.
  report_date             date,
  lab_name                text,
  -- Name printed on the report, kept ONLY to warn a reviewer when it does not
  -- look like the patient whose record this is being filed into. Never shown to
  -- the patient, never used as identity.
  patient_name_on_report  text,
  -- The full ExtractedRow[] from lib/lab-reports/extract.ts, including rows we
  -- could not map or convert. Kept verbatim so the review screen can show
  -- everything the model saw, not just what we understood.
  rows                    jsonb not null default '[]'::jsonb,
  unreadable_reason       text,
  error_message           text,
  -- Which analyte codes the reviewer actually accepted. Kept for audit: it is
  -- the difference between what the machine proposed and what a human filed.
  confirmed_codes         jsonb not null default '[]'::jsonb,
  confirmed_by            uuid references public.profiles (id),
  confirmed_at            timestamptz,
  created_at              timestamptz not null default now()
);

create index if not exists lab_report_extractions_patient_idx
  on public.lab_report_extractions (patient_id, created_at desc);
create index if not exists lab_report_extractions_org_idx
  on public.lab_report_extractions (organisation_id);
create index if not exists lab_report_extractions_pending_idx
  on public.lab_report_extractions (organisation_id, status)
  where status = 'extracted';

alter table public.lab_report_extractions enable row level security;

create policy lab_report_extractions_select on public.lab_report_extractions
  for select using (private.is_org_staff(organisation_id));

-- Deliberately no insert/update/delete policy — service-role only.

-- RLS restricts rows; it does not grant table access at all. A table added by a
-- plain migration (rather than at project creation) needs this explicitly —
-- the recurring M1-sprint-class gap this codebase has hit repeatedly.
grant select on public.lab_report_extractions to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.lab_report_extractions', 'SELECT') then
    raise exception 'lab_report_extractions: authenticated grant did not take';
  end if;

  -- A patient must NOT be able to read an unconfirmed transcription of their
  -- own results. Assert the policy really is org-staff-only rather than
  -- trusting the DDL above to have been written as intended.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'lab_report_extractions'
      and qual like '%auth.uid()%'
  ) then
    raise exception 'lab_report_extractions: select policy must not admit the patient directly';
  end if;
end $$;
