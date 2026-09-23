-- Tarragon Health — widen the patient-facing automated lab summary to name
-- the specific test(s) it flagged. Founder decision, 2026-09-22.
--
-- 20260830232932_lab_result_document_ai_summary.sql deliberately kept
-- ai_summary_status a bare status enum, "no analyte name, value, or freeform
-- model text ever lands here" — reasoned from the same DB-enforced principle
-- that keeps lab_report_extractions itself off-limits to a patient before a
-- clinician confirms it (that migration's own header: "delivering a result
-- without a doctor" is exactly what the abnormal-result pathway exists to
-- prevent). This migration deliberately widens that line, on an explicit,
-- reasoned founder ask, not by accident: a patient who has ALREADY read the
-- full document themselves (they uploaded it) is not having a result
-- "delivered" by being told which of ITS OWN rows sits outside the range
-- the LAB ITSELF printed beside it — the same fact `deriveAiSummaryStatus`
-- already computes from the QC 'outside_printed_range' flag, just no longer
-- anonymised down to a bare boolean.
--
-- The new column stays inside the SAME discipline the original migration
-- established, just widened one notch:
--   * Still nothing here is Tarragon's own clinical judgement — every string
--     stored is copied VERBATIM off the page (reportedLabel, reportedRange
--     from lib/lab-reports/extract.ts), never a computed/converted value and
--     never model prose.
--   * Still never wired into clinician_alerts or the escalation SLA — this
--     column is read by exactly one thing, the patient-facing summary card.
--   * Still populated in the SAME place (extraction-actions.ts, right next
--     to ai_summary_status), so the two can never drift out of sync.
alter table public.lab_result_documents
  add column ai_flagged_analytes jsonb not null default '[]'::jsonb;

comment on column public.lab_result_documents.ai_flagged_analytes is
  'Array of {label, reportedRange} for each row the QC outside_printed_range flag caught — both copied verbatim from the uploaded document by lib/lab-reports/extract.ts, never a Tarragon-computed value or freeform model prose. Populated alongside ai_summary_status; empty unless ai_summary_status = ''flagged''. Patient-facing only — never read by clinician_alerts or any escalation path.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_result_documents'
      and column_name = 'ai_flagged_analytes'
  ) then
    raise exception 'lab_result_documents.ai_flagged_analytes did not get added';
  end if;
end $$;
