-- A prescription must say how much to dispense and for how long (founder decision 2026-10-02).
--
-- Found when the prescription PDF showed no quantity or duration for a test prescription: both were optional everywhere, so a clinician could sign a
-- prescription a pharmacy cannot act on. The rule is enforced here, in the two functions every clinician prescription passes through, so it cannot be
-- bypassed from the app:
--   * prescribe_medication: p_quantity must be non-blank and p_duration_days must be a positive number of days.
--   * amend_medication: the EFFECTIVE values (what the caller sends, else the current version's) must satisfy the same rule, so amending an older
--     prescription that never had them forces the clinician to supply them.
-- The checks run AFTER the authority and tie checks, so an unauthorised or untied caller still gets the same "not authorised" answer as before (the
-- validation message does not disclose that a prescription exists). Existing rows are not touched; only a NEW prescription or amendment is checked.
-- Signatures and grants are unchanged (create or replace keeps both).

create or replace function public.prescribe_medication(
  p_patient uuid,
  p_drug_name text,
  p_dose text default null,
  p_frequency text default null,
  p_refill_date date default null,
  p_schedule_times jsonb default null,
  p_care_plan_id uuid default null,
  p_route text default null,
  p_duration_days integer default null,
  p_quantity text default null,
  p_repeats_allowed integer default null,
  p_indication text default null,
  p_instructions text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if coalesce(btrim(p_quantity), '') = '' then
    raise exception 'A quantity is required (for example 30 tablets): the pharmacy needs to know how much to dispense' using errcode = '22023';
  end if;
  if p_duration_days is null or p_duration_days <= 0 then
    raise exception 'A duration in days is required: how many days this supply covers' using errcode = '22023';
  end if;

  insert into public.medications (
    organisation_id, patient_id, source, drug_name, dose, frequency, refill_date, schedule_times, care_plan_id,
    route, duration_days, quantity, repeats_allowed, indication, instructions)
  values (
    v_org, p_patient, 'clinician', btrim(p_drug_name), p_dose, p_frequency, p_refill_date, coalesce(p_schedule_times, '[]'::jsonb), p_care_plan_id,
    p_route, p_duration_days, btrim(p_quantity), coalesce(p_repeats_allowed, 0), p_indication, p_instructions)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.amend_medication(
  p_medication_id uuid,
  p_amendment_reason text,
  p_drug_name text default null,
  p_dose text default null,
  p_frequency text default null,
  p_route text default null,
  p_duration_days integer default null,
  p_quantity text default null,
  p_repeats_allowed integer default null,
  p_indication text default null,
  p_instructions text default null,
  p_schedule_times jsonb default null,
  p_refill_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.medications%rowtype;
  v_new_id uuid;
  v_quantity text;
  v_duration integer;
begin
  if coalesce(btrim(p_amendment_reason), '') = '' then
    raise exception 'A reason for the amendment is required' using errcode = '22023';
  end if;

  select * into v_old from public.medications where id = p_medication_id;
  if v_old.id is not null and (select auth.uid()) = v_old.patient_id then
    raise exception 'A prescription can only be amended by clinical staff, not the patient' using errcode = '42501';
  end if;
  -- One answer for "no such prescription" and "not yours to amend", so existence is not disclosed to an untied caller.
  if v_old.id is null
     or (select auth.uid()) is null
     or not private.is_org_staff(v_old.organisation_id)
     or not private.has_prescribing_authority(v_old.organisation_id)
     or not private.clinician_has_patient_access(v_old.patient_id) then
    raise exception 'Not authorised to amend this prescription' using errcode = '42501';
  end if;
  if v_old.source <> 'clinician' then
    raise exception 'Only a clinician-issued prescription can be amended' using errcode = '42501';
  end if;
  if v_old.superseded_at is not null then
    raise exception 'This prescription has already been amended — amend its current version instead' using errcode = '22023';
  end if;

  -- The effective values (what was sent, else the current version's) must say how much and for how long.
  v_quantity := coalesce(nullif(btrim(p_quantity), ''), nullif(btrim(v_old.quantity), ''));
  v_duration := coalesce(p_duration_days, v_old.duration_days);
  if v_quantity is null then
    raise exception 'A quantity is required (for example 30 tablets): the pharmacy needs to know how much to dispense' using errcode = '22023';
  end if;
  if v_duration is null or v_duration <= 0 then
    raise exception 'A duration in days is required: how many days this supply covers' using errcode = '22023';
  end if;

  update public.medications
     set is_active = false, superseded_at = now()
   where id = p_medication_id;

  insert into public.medications (
    organisation_id, patient_id, care_plan_id, drug_name, dose, frequency,
    refill_date, schedule_times, source, route, duration_days, quantity,
    repeats_allowed, indication, instructions,
    version, previous_version_id, amendment_reason
  ) values (
    v_old.organisation_id, v_old.patient_id, v_old.care_plan_id,
    coalesce(p_drug_name, v_old.drug_name),
    coalesce(p_dose, v_old.dose),
    coalesce(p_frequency, v_old.frequency),
    coalesce(p_refill_date, v_old.refill_date),
    coalesce(p_schedule_times, v_old.schedule_times),
    'clinician',
    coalesce(p_route, v_old.route),
    v_duration,
    v_quantity,
    coalesce(p_repeats_allowed, v_old.repeats_allowed),
    coalesce(p_indication, v_old.indication),
    coalesce(p_instructions, v_old.instructions),
    v_old.version + 1, v_old.id, btrim(p_amendment_reason)
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.prescribe_medication(uuid,text,text,text,date,jsonb,uuid,text,integer,text,integer,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.amend_medication(uuid,text,text,text,text,text,integer,text,integer,text,text,jsonb,date)', 'EXECUTE') then
    raise exception 'prescribe_medication or amend_medication became anon-executable';
  end if;
end $$;
