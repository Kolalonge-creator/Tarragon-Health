-- Tarragon Health
-- Recurrence of the "anon inherits EXECUTE via the PUBLIC pseudo-role" bug
-- (see the supabase-anon-execute-gotcha memory and the header comment in
-- scripts/release-integrity/check-anon-security-definer-execute.mjs): a fresh
-- SECURITY DEFINER function carries an implicit PUBLIC grant, so a
-- `grant execute ... to authenticated` with no preceding
-- `revoke ... from public` leaves it callable by anon.
--
-- check-anon-security-definer-execute.mjs flagged 9 such functions on
-- 2026-08-30, none with any local migration file for their most recent
-- definition (the "live object, no migration record" failure mode CLAUDE.md
-- documents for private.guard_profiles_self_update() and the
-- care_access_category enum itself) -- signatures below were read directly
-- off pg_proc/pg_get_function_identity_arguments on the live project rather
-- than assumed from any committed source.
--
-- Grants-only: none of these functions' bodies are touched here. Four of the
-- nine (the public.* ones below) had no `authenticated` grant at all -- only
-- an inherited PUBLIC one -- so revoking PUBLIC without also granting
-- `authenticated` directly would silently break them for legitimate callers,
-- not just for anon.

revoke all on function private.can_read_clinical(p_patient uuid, p_category care_access_category) from public, anon;
revoke all on function private.has_emergency_access(p_patient uuid, p_category care_access_category) from public, anon;
revoke all on function private.is_active_clinical_staff(org uuid) from public, anon;
revoke all on function private.lab_result_consult_slot_conflict(p_clinician_profile_id uuid, p_staff_id uuid, p_scheduled_at timestamp with time zone, p_exclude_video_consultation_id uuid) from public, anon;
revoke all on function private.notify_org_clinical_staff(p_organisation_id uuid, p_template text, p_payload jsonb) from public, anon;

revoke all on function public.patient_exists_cross_org(p_patient_id uuid) from public, anon;
grant execute on function public.patient_exists_cross_org(p_patient_id uuid) to authenticated;

revoke all on function public.request_emergency_record_access(p_patient_id uuid, p_reason text) from public, anon;
grant execute on function public.request_emergency_record_access(p_patient_id uuid, p_reason text) to authenticated;

revoke all on function public.review_emergency_record_access(p_grant_id uuid, p_outcome text, p_note text) from public, anon;
grant execute on function public.review_emergency_record_access(p_grant_id uuid, p_outcome text, p_note text) to authenticated;

revoke all on function public.set_care_access_categories(p_grant_id uuid, p_categories care_access_category[]) from public, anon;
grant execute on function public.set_care_access_categories(p_grant_id uuid, p_categories care_access_category[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.can_read_clinical(uuid, care_access_category)', 'EXECUTE') then
    raise exception 'anon can still execute private.can_read_clinical';
  end if;
  if has_function_privilege('anon', 'private.has_emergency_access(uuid, care_access_category)', 'EXECUTE') then
    raise exception 'anon can still execute private.has_emergency_access';
  end if;
  if has_function_privilege('anon', 'private.is_active_clinical_staff(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute private.is_active_clinical_staff';
  end if;
  if has_function_privilege('anon', 'private.lab_result_consult_slot_conflict(uuid, uuid, timestamptz, uuid)', 'EXECUTE') then
    raise exception 'anon can still execute private.lab_result_consult_slot_conflict';
  end if;
  if has_function_privilege('anon', 'private.notify_org_clinical_staff(uuid, text, jsonb)', 'EXECUTE') then
    raise exception 'anon can still execute private.notify_org_clinical_staff';
  end if;
  if has_function_privilege('anon', 'public.patient_exists_cross_org(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute public.patient_exists_cross_org';
  end if;
  if not has_function_privilege('authenticated', 'public.patient_exists_cross_org(uuid)', 'EXECUTE') then
    raise exception 'authenticated lost execute on public.patient_exists_cross_org';
  end if;
  if has_function_privilege('anon', 'public.request_emergency_record_access(uuid, text)', 'EXECUTE') then
    raise exception 'anon can still execute public.request_emergency_record_access';
  end if;
  if not has_function_privilege('authenticated', 'public.request_emergency_record_access(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated lost execute on public.request_emergency_record_access';
  end if;
  if has_function_privilege('anon', 'public.review_emergency_record_access(uuid, text, text)', 'EXECUTE') then
    raise exception 'anon can still execute public.review_emergency_record_access';
  end if;
  if not has_function_privilege('authenticated', 'public.review_emergency_record_access(uuid, text, text)', 'EXECUTE') then
    raise exception 'authenticated lost execute on public.review_emergency_record_access';
  end if;
  if has_function_privilege('anon', 'public.set_care_access_categories(uuid, care_access_category[])', 'EXECUTE') then
    raise exception 'anon can still execute public.set_care_access_categories';
  end if;
  if not has_function_privilege('authenticated', 'public.set_care_access_categories(uuid, care_access_category[])', 'EXECUTE') then
    raise exception 'authenticated lost execute on public.set_care_access_categories';
  end if;

  raise notice 'PASS: all 9 care-access/emergency-access functions now deny anon execute';
end $$;
