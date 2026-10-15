-- amend_medication carries the structured schedule (schedule_spec) onto the new version.
--
-- Found 2026-10-13: public.amend_medication superseded the old medications row and inserted a new one
-- WITHOUT schedule_spec, so amending a clinician-issued as-needed, every-N-days, weekday or taper
-- medicine silently turned it into a plain daily list built from schedule_times. Reminders, the
-- missed-dose job and weekly adherence all changed meaning with no signature on that change.
-- Verified against the LIVE definition (pg_get_functiondef), not the migration file: no 'schedule_spec'.
--
-- Rule now: the new row keeps the old row's schedule_spec (kind, food note, window, dates, steps).
-- If the amendment supplies new p_schedule_times and the spec has a single times list
-- (daily / every_n_days / weekdays) those times replace spec.times, so the spec and the plain list
-- agree; if the result is not a valid schedule (say a window longer than the new gap) it is refused up front with a clear message. A taper carries dose, times and length per step, so a new plain
-- dose, times or duration cannot be mapped onto it: refused with a clear message instead of guessed.
-- As-needed has no times, so plain times are refused (they would silently create no reminders).
-- A changed duration_days moves a dated spec.endDate to current_date (or startDate if later) + duration - 1.
-- schedule_effective_from is stamped by the existing insert trigger (created_at of the new version).
--
-- Signature, grants and every other behaviour are unchanged (create or replace keeps the ACL).
-- Row counts: the change only affects amendments of rows that have a schedule_spec; no data is converted.

create or replace function public.amend_medication(
  p_medication_id uuid, p_amendment_reason text,
  p_drug_name text default null, p_dose text default null, p_frequency text default null,
  p_route text default null, p_duration_days integer default null, p_quantity text default null,
  p_repeats_allowed integer default null, p_indication text default null, p_instructions text default null,
  p_schedule_times jsonb default null, p_refill_date date default null,
  p_allergies_confirmed boolean default false, p_safety_override_reason text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_old public.medications%rowtype;
  v_new_id uuid;
  v_rx uuid;
  v_checks jsonb;
  v_drug text;
  v_dose text; v_freq text; v_route text; v_dur integer; v_qty text; v_rep integer; v_ind text; v_ins text;
  v_spec jsonb;
  v_kind text;
begin
  if coalesce(btrim(p_amendment_reason), '') = '' then
    raise exception 'A reason for the amendment is required' using errcode = '22023';
  end if;

  select * into v_old from public.medications where id = p_medication_id;
  if v_old.id is not null and (select auth.uid()) = v_old.patient_id then
    raise exception 'A prescription can only be amended by clinical staff, not the patient' using errcode = '42501';
  end if;
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
    raise exception 'This prescription has already been amended: amend its current version instead' using errcode = '22023';
  end if;

  v_drug := coalesce(p_drug_name, v_old.drug_name);
  v_dose := coalesce(p_dose, v_old.dose);
  v_freq := coalesce(p_frequency, v_old.frequency);
  v_route := coalesce(p_route, v_old.route);
  v_dur := coalesce(p_duration_days, v_old.duration_days);
  v_qty := coalesce(nullif(btrim(p_quantity), ''), nullif(btrim(v_old.quantity), ''));
  v_rep := coalesce(p_repeats_allowed, v_old.repeats_allowed);
  v_ind := coalesce(p_indication, v_old.indication);
  v_ins := coalesce(p_instructions, v_old.instructions);
  if v_qty is null then
    raise exception 'A quantity is required (for example 30 tablets): the pharmacy needs to know how much to dispense' using errcode = '22023';
  end if;
  if v_dur is null or v_dur <= 0 then
    raise exception 'A duration in days is required: how many days this supply covers' using errcode = '22023';
  end if;

  -- Carry the structured schedule, and refuse any amendment that would leave it contradicting the new prescription.
  v_spec := v_old.schedule_spec;
  if v_spec is not null then
    v_kind := v_spec ->> 'kind';
    if v_kind = 'taper' then
      -- A taper sets dose and times per step and its length from the steps: a plain dose, times or
      -- duration cannot be mapped onto it without guessing.
      if p_schedule_times is not null then
        raise exception 'A tapering schedule keeps its times per step: amend the schedule itself, not the plain times list' using errcode = '22023';
      end if;
      if p_dose is not null and p_dose is distinct from v_old.dose then
        raise exception 'A tapering schedule sets the dose per step: amend the schedule itself, not the plain dose' using errcode = '22023';
      end if;
      if p_duration_days is not null and p_duration_days is distinct from v_old.duration_days then
        raise exception 'A tapering schedule sets its length from its steps: amend the schedule itself, not the duration' using errcode = '22023';
      end if;
    elsif v_kind = 'as_needed' then
      if p_schedule_times is not null then
        raise exception 'An as-needed medicine has no fixed times: fixed times would not create reminders' using errcode = '22023';
      end if;
    elsif v_kind in ('daily', 'every_n_days', 'weekdays') then
      if p_schedule_times is not null then
        v_spec := jsonb_set(v_spec, '{times}', p_schedule_times, true);
      end if;
    end if;
    -- A changed supply length moves a dated end with it: the new version covers duration_days from now
    -- (or from its start date, if that is later). Without this, reminders stop or carry on at the old end.
    if v_kind <> 'taper' and p_duration_days is not null and p_duration_days is distinct from v_old.duration_days
       and coalesce(v_spec ->> 'endDate', '') <> '' then
      v_spec := jsonb_set(v_spec, '{endDate}', to_jsonb(to_char(
        greatest(current_date, coalesce(nullif(v_spec ->> 'startDate', '')::date, current_date)) + p_duration_days - 1,
        'YYYY-MM-DD')), true);
    end if;
    if v_spec is distinct from v_old.schedule_spec and not private.is_valid_schedule_spec(v_spec) then
      raise exception 'These changes do not fit the existing schedule (for example a dose window that reaches the next dose): adjust the schedule itself' using errcode = '22023';
    end if;
  end if;

  v_checks := private.check_prescription_safety(v_old.patient_id, v_drug, v_old.id, p_allergies_confirmed, p_safety_override_reason);
  v_rx := private.issue_signed_prescription(
    v_old.organisation_id, v_old.patient_id,
    jsonb_strip_nulls(jsonb_build_object('drug_name', v_drug, 'dose', v_dose, 'frequency', v_freq, 'route', v_route, 'duration_days', v_dur,
                                         'quantity', v_qty, 'repeats_allowed', v_rep, 'indication', v_ind, 'instructions', v_ins)),
    v_checks, v_old.prescription_id, btrim(p_amendment_reason), null,
    coalesce((select is_test from public.profiles where id = v_old.patient_id), false));

  update public.medications set is_active = false, superseded_at = now() where id = p_medication_id;

  insert into public.medications (
    organisation_id, patient_id, care_plan_id, drug_name, dose, frequency,
    refill_date, schedule_times, schedule_spec, source, route, duration_days, quantity,
    repeats_allowed, indication, instructions,
    version, previous_version_id, amendment_reason, prescription_id
  ) values (
    v_old.organisation_id, v_old.patient_id, v_old.care_plan_id,
    v_drug, v_dose, v_freq,
    coalesce(p_refill_date, v_old.refill_date),
    coalesce(p_schedule_times, v_old.schedule_times),
    v_spec,
    'clinician', v_route, v_dur, v_qty, v_rep, v_ind, v_ins,
    v_old.version + 1, v_old.id, btrim(p_amendment_reason), v_rx
  )
  returning id into v_new_id;
  return v_new_id;
end;
$function$;

do $$
begin
  if pg_get_functiondef('public.amend_medication(uuid,text,text,text,text,text,integer,text,integer,text,text,jsonb,date,boolean,text)'::regprocedure) not like '%schedule_spec%' then
    raise exception 'amend_medication still does not carry schedule_spec';
  end if;
  if has_function_privilege('anon', 'public.amend_medication(uuid,text,text,text,text,text,integer,text,integer,text,text,jsonb,date,boolean,text)', 'EXECUTE') then
    raise exception 'anon can execute amend_medication';
  end if;
end $$;
