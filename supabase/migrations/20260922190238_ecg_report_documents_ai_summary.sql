-- Tarragon Health — patient-facing automated summary on ecg_report_documents,
-- mirroring lab_result_documents' ai_summary_status
-- (20260830232932_lab_result_document_ai_summary.sql) and its 2026-09-22
-- widening (ai_flagged_analytes) exactly, adapted to what an ECG printout
-- actually carries as its own verdict.
--
-- An ECG cart prints no per-parameter reference range the way a lab report
-- does (lib/ecg-reports/qc.ts's own header explains this), so there is no
-- outside_printed_range-style numeric check to reuse. What DOES exist, and
-- is exactly as strong a "the document's own verdict" signal: the machine's
-- own printed rhythm statement (extract.ts's machine_rhythm_statement row —
-- "Normal sinus rhythm", "Sinus tachycardia", etc — copied VERBATIM, never
-- Tarragon's own reading of the tracing). lib/ecg-reports/ai-summary.ts
-- classifies that verbatim text as ready/flagged with a plain pattern match
-- against known-normal phrasing; this migration only adds where that
-- classification and the verbatim statement it read get stored.
--
-- Reuses public.lab_result_ai_summary_status rather than minting a fourth
-- near-identical enum — the type's name is a residue of it having been added
-- for lab_result_documents first, but the value set (pending/ready/flagged/
-- unavailable) is generic across every document type this feature now
-- covers.
--
-- No RLS change: ecg_report_documents_select (20260815092745) already admits
-- patient_id = auth.uid(); the update-guard trigger
-- (private.set_updated_at only touches updated_at) does not reference these
-- columns, so the service-role UPDATE that sets them passes through
-- untouched, same reasoning as the lab migration's own note.
alter table public.ecg_report_documents
  add column ai_summary_status public.lab_result_ai_summary_status not null default 'pending',
  add column ai_flagged_statement text,
  add column ai_summary_generated_at timestamptz;

comment on column public.ecg_report_documents.ai_summary_status is
  'Deterministic, patient-visible status derived from whether the machine''s own printed rhythm statement reads as normal (lib/ecg-reports/ai-summary.ts). Never a doctor opinion, never feeds clinician_alerts.';
comment on column public.ecg_report_documents.ai_flagged_statement is
  'The ECG machine''s own printed rhythm statement, copied verbatim, when ai_summary_status = ''flagged''. Never Tarragon''s own reading of the tracing. Null otherwise.';
comment on column public.ecg_report_documents.ai_summary_generated_at is
  'Stamped when ai_summary_status last moved off pending.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ecg_report_documents'
      and column_name = 'ai_summary_status'
  ) then
    raise exception 'ecg_report_documents.ai_summary_status did not get added';
  end if;
end $$;
