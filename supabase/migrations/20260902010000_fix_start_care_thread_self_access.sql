-- Tarragon Health — fix start_care_thread(): a patient could never message
-- their own care team.
--
-- apps/web/src/app/(dashboard)/patient/messages/page.tsx passes
-- getPatientDashboardContext()'s `subjectId` as p_patient_id on every call —
-- for a patient's own normal login (not a supporter acting for someone
-- else), that's the patient's own auth.uid(). start_care_thread's
-- `p_patient_id is not null` branch (added 20260830103251, category-scoped
-- clinical access) requires the caller to be private.is_org_staff(v_org) or
-- private.can_read_clinical(p_patient_id, 'messaging') — i.e. staff/
-- caregiver authority over p_patient_id. A patient granting themselves
-- access to themselves is not a real profile_access row, so
-- can_read_clinical(own_id, 'messaging') is always false for a plain
-- patient, and is_org_staff is false too — every patient-initiated thread
-- raised 'not authorised' (SQLSTATE 42501), live-broken since that
-- migration landed. Confirmed via a real click-through in the running app
-- and by checking profile_access directly: no self-grant row exists (never
-- would).
--
-- Fix: when p_patient_id = the caller's own auth.uid(), it's the patient
-- messaging about themselves — treat it exactly like the p_patient_id is
-- null (self-service) path, no staff/caregiver check needed. Only the
-- genuine acting-for-someone-else case (p_patient_id <> v_uid) still
-- requires is_org_staff/can_read_clinical.

create or replace function public.start_care_thread(
  p_subject text,
  p_body text,
  p_patient_id uuid default null,
  p_escalation_id uuid default null,
  p_care_plan_id uuid default null,
  p_category public.care_message_category default 'general'::public.care_message_category
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_subject), '')) = 0 then raise exception 'subject required'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  if p_patient_id is not null and p_patient_id <> v_uid then
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    if v_org is null
       or not (private.is_org_staff(v_org) or private.can_read_clinical(p_patient_id, 'messaging')) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id, category)
  values (v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id, p_category)
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));
  return v_thread_id;
end;
$function$;

revoke all on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category)', 'EXECUTE') then
    raise exception 'start_care_thread: anon must not be able to execute this';
  end if;
  if not has_function_privilege('authenticated', 'public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category)', 'EXECUTE') then
    raise exception 'start_care_thread: authenticated grant did not take';
  end if;
end $$;
