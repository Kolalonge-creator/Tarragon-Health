-- Re-closes the anon-inherits-EXECUTE-via-PUBLIC gap (see
-- 20260827204051_admin_link_pharmacist_rpc.sql for the assertion pattern and
-- 20260829111514_resweep_private_schema_execute_from_public.sql for the prior sweep) for 5 more
-- private.* SECURITY DEFINER functions found by
-- scripts/release-integrity/check-anon-security-definer-execute.mjs on 2026-08-30: their
-- migrations landed today from concurrent sessions without the revoke-before-grant step, so each
-- inherited EXECUTE via the PUBLIC pseudo-role. private is not in PostgREST's exposed schema
-- list, so this is defense-in-depth rather than a directly internet-reachable breach.
--
-- Two of the five -- private.enrol_patient_in_purchased_programme(uuid) and
-- private.patient_has_active_programme_purchase(uuid, care_plan_condition) -- have no migration
-- file anywhere in this repo's history (grep across supabase/migrations/, and across the whole
-- repo, finds nothing); they exist live with no local record at all, the same failure mode
-- CLAUDE.md documents for private.guard_profiles_self_update(). Signatures below were read
-- directly off the live project (koiplnmbgnqnbywhpjlf) via pg_proc, not inferred from source.
--
-- Grants-only: no function body is touched, and no other statement is added.

revoke all on function private.enrol_patient_in_purchased_programme(uuid) from public, anon;
grant execute on function private.enrol_patient_in_purchased_programme(uuid) to authenticated;

revoke all on function private.generate_clinical_summary_draft(uuid) from public, anon;
grant execute on function private.generate_clinical_summary_draft(uuid) to authenticated;

revoke all on function private.health_education_flag_overdue_reviews() from public, anon;
grant execute on function private.health_education_flag_overdue_reviews() to authenticated;

revoke all on function private.health_education_latest_literacy(uuid, public.care_plan_condition) from public, anon;
grant execute on function private.health_education_latest_literacy(uuid, public.care_plan_condition) to authenticated;

revoke all on function private.patient_has_active_programme_purchase(uuid, public.care_plan_condition) from public, anon;
grant execute on function private.patient_has_active_programme_purchase(uuid, public.care_plan_condition) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.enrol_patient_in_purchased_programme(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute enrol_patient_in_purchased_programme';
  end if;
  raise notice 'PASS: enrol_patient_in_purchased_programme present, anon denied';
end $$;

do $$
begin
  if has_function_privilege('anon', 'private.generate_clinical_summary_draft(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute generate_clinical_summary_draft';
  end if;
  raise notice 'PASS: generate_clinical_summary_draft present, anon denied';
end $$;

do $$
begin
  if has_function_privilege('anon', 'private.health_education_flag_overdue_reviews()', 'EXECUTE') then
    raise exception 'anon can still execute health_education_flag_overdue_reviews';
  end if;
  raise notice 'PASS: health_education_flag_overdue_reviews present, anon denied';
end $$;

do $$
begin
  if has_function_privilege('anon', 'private.health_education_latest_literacy(uuid, public.care_plan_condition)', 'EXECUTE') then
    raise exception 'anon can still execute health_education_latest_literacy';
  end if;
  raise notice 'PASS: health_education_latest_literacy present, anon denied';
end $$;

do $$
begin
  if has_function_privilege('anon', 'private.patient_has_active_programme_purchase(uuid, public.care_plan_condition)', 'EXECUTE') then
    raise exception 'anon can still execute patient_has_active_programme_purchase';
  end if;
  raise notice 'PASS: patient_has_active_programme_purchase present, anon denied';
end $$;
