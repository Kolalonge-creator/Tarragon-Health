-- Tarragon Health — code-review fix (2026-09-22, /code-review high on the
-- free-ai-result-reading branch): rename ai_flagged_statement to
-- ai_rhythm_statement and drop the "only when flagged" restriction.
--
-- Bug found: AiEcgSummary hardcoded "The ECG machine's own printout reads
-- normal sinus rhythm" for the entire 'ready' case, because the column
-- storing the actual verbatim text (ai_flagged_statement) was only ever
-- populated when ai_summary_status = 'flagged'. deriveEcgAiSummaryStatus's
-- own NORMAL_RHYTHM_PATTERN matches "Normal ECG", "Normal electrocardiogram"
-- and "Normal 12-lead ECG" as 'ready' too — none of which mention "sinus
-- rhythm" — so a patient whose cart printed exactly one of those saw a
-- confident claim about their own document that the document never actually
-- made. This is a real violation of the feature's own stated discipline:
-- "copy it VERBATIM... never your assessment" (extract.ts's system prompt).
--
-- Fix: store the machine's rhythm statement verbatim REGARDLESS of
-- ready/flagged (apps/web/src/lib/ecg-reports/ai-summary.ts's renamed
-- extractMachineRhythmStatement, no longer gated on status), and rename the
-- column so its name matches what it now actually holds.
alter table public.ecg_report_documents
  rename column ai_flagged_statement to ai_rhythm_statement;

comment on column public.ecg_report_documents.ai_rhythm_statement is
  'The ECG machine''s own printed rhythm statement, copied verbatim by lib/ecg-reports/extract.ts. Populated whenever the extraction resolved one, regardless of ai_summary_status -- the patient-facing card always shows this exact text, never a hardcoded guess. Never Tarragon''s own reading of the tracing.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ecg_report_documents'
      and column_name = 'ai_rhythm_statement'
  ) then
    raise exception 'ecg_report_documents.ai_rhythm_statement did not get created by the rename';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ecg_report_documents'
      and column_name = 'ai_flagged_statement'
  ) then
    raise exception 'ecg_report_documents.ai_flagged_statement should no longer exist after the rename';
  end if;
end $$;
