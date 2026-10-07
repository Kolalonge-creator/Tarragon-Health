-- The Medical Officer tier was retired (founder decision F-05, f05_retire_medical_officer_tier): the label no longer exists in
-- public.doctor_tier. private.ai_reviewer_ok() (20261007205203) still named it, so calling it failed with an invalid enum value, which
-- broke public.ai_review_queue and public.review_ai_sample for every caller. It now names only tiers that exist. The review sample is for
-- the Chief Medical Officer and senior doctors (OQ-312, recommended option a).

create or replace function private.ai_reviewer_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_clinical_director()
      or exists (select 1 from public.clinical_staff where profile_id = (select auth.uid()) and active
                 and doctor_tier = 'senior_medical_officer');
$$;
revoke all on function private.ai_reviewer_ok() from public, anon;
grant execute on function private.ai_reviewer_ok() to authenticated, service_role;
