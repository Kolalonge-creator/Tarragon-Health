-- Metadata-only rename: this enum (created in
-- 20260830232932_lab_result_document_ai_summary.sql for lab_result_documents)
-- is also reused live by ecg_report_documents.ai_summary_status and
-- imaging_report_documents.ai_summary_status (added on the not-yet-merged
-- feat/free-ai-result-reading-lab-ecg-imaging branch), so the old
-- lab_result_-prefixed name is misleading. No data migration needed --
-- ALTER TYPE ... RENAME updates every column using it in place.
alter type public.lab_result_ai_summary_status rename to ai_document_summary_status;
