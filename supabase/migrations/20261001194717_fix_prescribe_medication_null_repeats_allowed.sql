-- Fix: public.prescribe_medication (20261001165006) inserted an explicit NULL into medications.repeats_allowed when the caller left "Repeats
-- allowed" blank. The column is NOT NULL with default 0, and an explicit NULL does not take the default, so every prescription without a
-- repeats value failed with 23502 (the clinician saw "We could not save this medication just then"). The earlier proof always passed a
-- repeats value, so it never exercised the omitted case. Found by the live click-through on production. schedule_times was already
-- coalesced; repeats_allowed is the only other NOT NULL column with a default that this function writes.

CREATE OR REPLACE FUNCTION public.prescribe_medication(p_patient uuid, p_drug_name text, p_dose text DEFAULT NULL::text, p_frequency text DEFAULT NULL::text, p_refill_date date DEFAULT NULL::date, p_schedule_times jsonb DEFAULT NULL::jsonb, p_care_plan_id uuid DEFAULT NULL::uuid, p_route text DEFAULT NULL::text, p_duration_days integer DEFAULT NULL::integer, p_quantity text DEFAULT NULL::text, p_repeats_allowed integer DEFAULT NULL::integer, p_indication text DEFAULT NULL::text, p_instructions text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drug_name), '') = '' then
    raise exception 'A drug name is required' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then
    raise exception 'This patient has no organisation on file' using errcode = '22023';
  end if;
  if not private.is_org_staff(v_org) or not private.has_prescribing_authority(v_org)
     or not private.clinician_has_patient_access(p_patient) then
    raise exception 'Not authorised to prescribe for this patient' using errcode = '42501';
  end if;
  if p_care_plan_id is not null and not exists (select 1 from public.care_plans where id = p_care_plan_id and patient_id = p_patient) then
    raise exception 'That care plan does not belong to this patient' using errcode = '22023';
  end if;

  insert into public.medications (
    organisation_id, patient_id, source, drug_name, dose, frequency, refill_date, schedule_times, care_plan_id,
    route, duration_days, quantity, repeats_allowed, indication, instructions)
  values (
    v_org, p_patient, 'clinician', btrim(p_drug_name), p_dose, p_frequency, p_refill_date, coalesce(p_schedule_times, '[]'::jsonb), p_care_plan_id,
    p_route, p_duration_days, p_quantity, coalesce(p_repeats_allowed, 0), p_indication, p_instructions)
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.prescribe_medication(uuid, text, text, text, date, jsonb, uuid, text, integer, text, integer, text, text) from public, anon;
grant execute on function public.prescribe_medication(uuid, text, text, text, date, jsonb, uuid, text, integer, text, integer, text, text) to authenticated;

do $$
begin
  if pg_get_functiondef('public.prescribe_medication(uuid,text,text,text,date,jsonb,uuid,text,integer,text,integer,text,text)'::regprocedure) not ilike '%coalesce(p_repeats_allowed, 0)%' then
    raise exception 'S05f assertion: prescribe_medication does not default repeats_allowed';
  end if;
  if has_function_privilege('anon', 'public.prescribe_medication(uuid,text,text,text,date,jsonb,uuid,text,integer,text,integer,text,text)', 'EXECUTE') then
    raise exception 'S05f assertion: anon can execute prescribe_medication';
  end if;
end $$;
