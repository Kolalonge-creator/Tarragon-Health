-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as every other stubbed function in this history (create_emergency_card,
-- my_care_plan_clinicians, etc.): 20260814193734_confirm_ecg_report_extraction.sql's
-- own self-test fails on a fresh replay because anon still holds direct
-- EXECUTE despite that migration's `revoke all ... from public`, the same
-- unexplained local/CI-only default-ACL gap documented throughout this
-- history. All-built-in-type signature, so (unlike the custom-type stubs)
-- this can be pre-created with the exact same argument types one second
-- earlier -- CREATE OR REPLACE FUNCTION preserves the grant set established
-- here since the real migration's signature matches exactly.
create function public.confirm_ecg_report_extraction(
  p_extraction_id uuid,
  p_readings jsonb,
  p_report_date date
)
returns integer
language sql
set search_path = public, pg_temp
as $$
  select null::integer;
$$;

revoke all on function public.confirm_ecg_report_extraction(uuid, jsonb, date) from public;
revoke all on function public.confirm_ecg_report_extraction(uuid, jsonb, date) from anon;
