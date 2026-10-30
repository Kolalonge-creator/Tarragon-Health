-- OQ-555 follow-up: a three-state pregnancy answer for safety checks, so "I could not read it" is never taken for "not pregnant".
--
-- THE PROBLEM. The previous migration (20261030122733) narrowed the staff SELECT on patient_pregnancy and postnatal_profiles to the care tie. Safety
-- code that reads those tables directly with a client under the caller's own row security cannot tell "no row" from "row security hid the row":
-- both come back as null data and no error. Five readers (the prescribing form, the medication-safety panel, the titration suggestion, the low-carbohydrate
-- medicine review, the trend-band gate) then either defaulted to "not pregnant" (`?? false`) or could not say why they were unsure.
--
-- WHAT THIS ADDS. public.pregnancy_safety_status(p_patient) returns jsonb {pregnancy, has_record, last_delivery_date}:
--   pregnancy          'pregnant' | 'not_pregnant' | 'unknown'
--   has_record         whether a patient_pregnancy row exists (some callers are stricter than the platform default and treat "no record" as unknown)
--   last_delivery_date the latest postnatal_profiles.delivery_date (the trend-band gate and the low-carbohydrate review need a recent delivery)
-- It answers for exactly two callers: the patient herself, and a clinician with the care tie (private.reproductive_staff_tied, written fresh in S66: active
-- credentialed clinician, same organisation, care tie). EVERYONE ELSE, including a break-glass holder (reproductive_health is excluded from break-glass), an
-- emergency grant, a support view-as session, a care coordinator, an admin, a caregiver and another organisation's clinician, gets 'unknown'. 'unknown' is
-- an ANSWER, not an error, so a caller cannot confuse it with the error path and cannot get a different answer by probing. A caller with no session is refused.
-- 'not_pregnant' is only ever returned to a caller who was allowed to look.
--
-- WHY IT IS NOT AUDITED (explicit decision, INV-10 considered). The audited, silent read of the whole record is read_womens_health_record_audited (previous
-- migration). This function returns one safety word, a flag and a date, to a caller who can already read the same row directly under row security (the care
-- tie, or the patient). It runs inside the prescribing form, the medication-safety panel, every trend chart and every titration or medicine-review
-- proposal, so an audit row per call would bury the patient's "who opened my record" list in routine safety checks and make the real openings unfindable.
-- The chart opening is already logged (log_patient_record_view). Opening the record itself, to read dates and notes, stays audited.
--
-- New function name, no overload of an existing function. STABLE SECURITY DEFINER, search_path empty. No data is rewritten. Live count 2026-10-30:
-- patient_pregnancy 0 rows, so no existing answer changes.

create function public.pregnancy_safety_status(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_preg boolean;
  v_has boolean;
  v_delivery date;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  -- Not the patient and not tied: 'unknown'. Never an error and never 'not_pregnant' for a caller who was not allowed to look.
  if p_patient is null or (v_uid is distinct from p_patient and not private.reproductive_staff_tied(p_patient)) then
    return jsonb_build_object('pregnancy', 'unknown', 'has_record', false, 'last_delivery_date', null);
  end if;
  select pg.is_pregnant, true into v_preg, v_has from public.patient_pregnancy pg where pg.patient_id = p_patient;
  select max(pp.delivery_date) into v_delivery from public.postnatal_profiles pp where pp.patient_id = p_patient;
  return jsonb_build_object('pregnancy', case when coalesce(v_preg, false) then 'pregnant' else 'not_pregnant' end,
                            'has_record', coalesce(v_has, false), 'last_delivery_date', v_delivery);
end $$;
revoke all on function public.pregnancy_safety_status(uuid) from public, anon;
grant execute on function public.pregnancy_safety_status(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.pregnancy_safety_status(uuid)', 'EXECUTE') then
    raise exception 'pregnancy_safety_status: anon can execute';
  end if;
  if not has_function_privilege('authenticated', 'public.pregnancy_safety_status(uuid)', 'EXECUTE') then
    raise exception 'pregnancy_safety_status: authenticated cannot execute';
  end if;
  if pg_get_functiondef('public.pregnancy_safety_status(uuid)'::regprocedure) ~ 'has_emergency_access|can_support_view|can_staff_read_clinical|staff_may_read' then
    raise exception 'pregnancy_safety_status: names a break-glass, view-as or plain staff check';
  end if;
  raise notice 'PASS: pregnancy_safety_status installed';
end $$;
