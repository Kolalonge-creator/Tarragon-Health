-- Tarragon Health — patient-facing automated summary on
-- imaging_report_documents, mirroring lab_result_documents.ai_summary_status
-- and ecg_report_documents.ai_summary_status (2026-09-22) exactly, adapted
-- to what a radiology/imaging report actually carries as its own verdict:
-- the radiologist's own Impression/Conclusion section, copied verbatim, plus
-- a narrow flag for whether that wording states something other than
-- normal (AI-016, apps/web/src/lib/imaging-reports/extract.ts).
--
-- Unlike the lab/ECG cases, AI-016 starts registered DISABLED (see
-- 20260922190712) pending a real evaluation + Clinical Director approval —
-- so ai_summary_status on every row will read 'unavailable' (the same value
-- a failed extraction produces) until a human closes that gate. These
-- columns exist now so the call site and the patient-facing card can ship
-- together with the rest of this feature and need no further schema change
-- the day AI-016 is switched on.
--
-- No RLS change: imaging_report_documents_select (20260902215900) already
-- admits patient_id = auth.uid(); enforce_imaging_report_document_update()
-- does not reference these columns, so the service-role UPDATE that sets
-- them passes through untouched, same reasoning as the lab/ECG migrations.
alter table public.imaging_report_documents
  add column ai_summary_status public.lab_result_ai_summary_status not null default 'pending',
  add column ai_impression_text text,
  add column ai_impression_flagged boolean,
  add column ai_summary_generated_at timestamptz;

comment on column public.imaging_report_documents.ai_summary_status is
  'Patient-visible status. ''unavailable'' both on a genuine extraction failure and, until AI-016 is enabled (20260922190712), on every row -- the two are indistinguishable by design, since neither means anything was withheld from the patient beyond "no automated read exists for this document yet."';
comment on column public.imaging_report_documents.ai_impression_text is
  'The radiologist''s own Impression/Conclusion section, copied verbatim by AI-016. Never Tarragon''s own reading of the scan. Shown to the patient regardless of ai_impression_flagged -- a "no acute abnormality" verdict is itself the answer the patient uploaded to get.';
comment on column public.imaging_report_documents.ai_impression_flagged is
  'Whether AI-016 judged the radiologist''s OWN wording to state something other than normal/unremarkable -- defaults toward true on ambiguity (see AI-016''s bias_toward_flagged_on_ambiguity guardrail). Null when no read has been produced.';
comment on column public.imaging_report_documents.ai_summary_generated_at is
  'Stamped when ai_summary_status last moved off pending.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'imaging_report_documents'
      and column_name = 'ai_summary_status'
  ) then
    raise exception 'imaging_report_documents.ai_summary_status did not get added';
  end if;
end $$;
