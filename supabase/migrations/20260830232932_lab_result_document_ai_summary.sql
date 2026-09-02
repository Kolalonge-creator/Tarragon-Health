-- Tarragon Health — patient-facing automated summary on lab_result_documents.
--
-- Product decision: a patient who uploads their own test result (free, no
-- doctor involved yet) should see SOMETHING immediately, not silence until a
-- doctor reviews it days later. This is deliberately NOT a second AI opinion
-- pipeline — it reuses the QC signal `runLabReportExtraction` already
-- computes for every upload (extraction-actions.ts / lib/lab-reports/qc.ts),
-- specifically the 'outside_printed_range' flag: the LAB'S OWN printed
-- reference range vs. the transcribed value. That is a fact about the
-- document, not a Tarragon clinical judgement, which is why it is safe to
-- show a patient directly and why it is deliberately NOT sourced from
-- reference-ranges.ts's interpretReading/worstStatusOf (that module's own
-- header states its classification "must never drive... anything a patient
-- sees or is told" — it feeds the doctor-queue escalation bridge only).
--
-- Column is a STATUS ENUM, not stored prose: no analyte name, value, or
-- freeform model text ever lands here. Copy is a fixed template in
-- application code. This keeps the feature honestly decoupled from the
-- abnormal-result pipeline (screening_results_abnormal_handler) by
-- construction — there is nothing here for a future change to accidentally
-- wire into a clinician_alerts insert or an SLA.
--
-- No RLS change: lab_result_documents_select already admits
-- patient_id = auth.uid(). private.enforce_lab_result_document_update()
-- (20260827204355_result_acknowledgement_status.sql, the latest version)
-- does not reference these columns, so the service-role UPDATE that sets
-- them passes through untouched, same as any other column it doesn't freeze.

create type public.lab_result_ai_summary_status as enum (
  'pending', 'ready', 'flagged', 'unavailable'
);

alter table public.lab_result_documents
  add column ai_summary_status public.lab_result_ai_summary_status not null default 'pending',
  add column ai_summary_generated_at timestamptz;

comment on column public.lab_result_documents.ai_summary_status is
  'Deterministic, patient-visible status derived from the QC outside_printed_range flag on the extraction draft. Never a doctor opinion, never freeform text, never feeds clinician_alerts.';
comment on column public.lab_result_documents.ai_summary_generated_at is
  'Stamped when ai_summary_status last moved off pending. Independent of interpretation_sent_at (the doctor-authored field).';
