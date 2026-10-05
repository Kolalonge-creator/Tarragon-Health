-- S05f piece C, part 2a (writes): tie-gated medication write functions and the patient column allow-list (INV-10, INV-12, OQ-11).
-- Additive. The closing migration (part 2b) drops the staff policies once the code that uses these functions has deployed.
--
-- Counted first (live, 2026-10-01): medications 0 rows. Inventory of writers (code plus live scan):
--   * Staff INSERT: the clinician "add medication" form (source 'clinician'), through useAddMedication  -> prescribe_medication.
--   * Staff UPDATE: confirm and continue a refill (useConfirmMedicationRefill on the clinician chart; the case cockpit's refill
--     proposal) -> confirm_medication_refill. No staff screen stops a medicine (the stop form is only offered on the patient's own page)
--     and no staff screen deletes one, so there is no staff stop or delete function and those capabilities simply end with the policies.
--   * public.amend_medication (the superseding amendment) was SECURITY INVOKER and relied on the staff UPDATE/INSERT policies, so it
--     breaks the moment they go; it becomes SECURITY DEFINER here with the authority and tie checked explicitly.
--   * Patient writes (self-add as 'patient', stop on the patient's own page) and the mobile insert stay direct under the patient's policies.
--   * Every other database writer is SECURITY DEFINER (enforce_fhir_import_resource_attribution).
-- The existing triggers (BP prescribing safety, confirm-only, version snapshot, schedule, check-in and lab-monitoring creation, timeline,
-- audit, correction trail) all still run, because each function performs an ordinary INSERT or UPDATE as the caller (auth.uid() is
-- unchanged inside a SECURITY DEFINER function).
--
-- A prescriber must be TIED to the patient (INV-12: care team, an open escalation or alert routed to them, a live appointment, a hosted
-- video consultation, an assigned open referral). Break-glass and support-view never authorise a write.

create or replace function public.prescribe_medication(
  p_patient uuid, p_drug_name text,
  p_dose text default null, p_frequency text default null, p_refill_date date default null,
  p_schedule_times jsonb default null, p_care_plan_id uuid default null, p_route text default null,
  p_duration_days integer default null, p_quantity text default null, p_repeats_allowed integer default null,
  p_indication text default null, p_instructions text default null)
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

  insert into public.medications (
    organisation_id, patient_id, source, drug_name, dose, frequency, refill_date, schedule_times, care_plan_id,
    route, duration_days, quantity, repeats_allowed, indication, instructions)
  values (
    v_org, p_patient, 'clinician', btrim(p_drug_name), p_dose, p_frequency, p_refill_date, coalesce(p_schedule_times, '[]'::jsonb), p_care_plan_id,
    p_route, p_duration_days, p_quantity, p_repeats_allowed, p_indication, p_instructions)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.confirm_medication_refill(p_medication uuid, p_refill_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_med public.medications%rowtype;
begin
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into v_med from public.medications where id = p_medication;
  -- One answer for "no such prescription" and "not yours to confirm", so existence is not disclosed to an untied caller.
  if v_med.id is null
     or not private.is_org_staff(v_med.organisation_id)
     or not (private.has_prescribing_authority(v_med.organisation_id) or private.can_confirm_medication_refill(v_med.organisation_id))
     or not private.clinician_has_patient_access(v_med.patient_id) then
    raise exception 'Not authorised to confirm this prescription' using errcode = '42501';
  end if;
  -- enforce_medication_confirm_only (BEFORE UPDATE) still restricts a non-prescriber to this column and stamps last_confirmed_by/at.
  update public.medications
     set refill_date = p_refill_date,
         last_confirmed_at = now(),
         last_confirmed_by = (select cs.id from public.clinical_staff cs
                               where cs.profile_id = (select auth.uid()) and cs.organisation_id = v_med.organisation_id and cs.active)
   where id = p_medication;
end;
$$;

-- Same signature and behaviour as 20260829010500_amend_medication.sql, now SECURITY DEFINER with the authority and tie checked up
-- front instead of inferred from RLS filtering the UPDATE to zero rows.
create or replace function public.amend_medication(
  p_medication_id uuid, p_amendment_reason text,
  p_drug_name text default null, p_dose text default null, p_frequency text default null, p_route text default null,
  p_duration_days integer default null, p_quantity text default null, p_repeats_allowed integer default null,
  p_indication text default null, p_instructions text default null, p_schedule_times jsonb default null, p_refill_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.medications%rowtype;
  v_new_id uuid;
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
    coalesce(p_duration_days, v_old.duration_days),
    coalesce(p_quantity, v_old.quantity),
    coalesce(p_repeats_allowed, v_old.repeats_allowed),
    coalesce(p_indication, v_old.indication),
    coalesce(p_instructions, v_old.instructions),
    v_old.version + 1, v_old.id, btrim(p_amendment_reason)
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- OQ-11 remainder: a patient must not be able to rewrite a clinician-prescribed row. On a row whose source is 'clinician' the patient's
-- own session may change only the stop columns (the stop path on her own page) and her reminder times; everything else (drug, dose,
-- frequency, route, quantity, repeats, indication, instructions, the prescription link, prescriber and verification fields, version
-- chain, attribution) is immutable to her. Rows she added herself are unaffected. Named to sort before the other BEFORE UPDATE triggers
-- so it compares what the client actually sent.
create or replace function private.enforce_patient_clinician_medication_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source is distinct from 'clinician' or old.patient_id is distinct from (select auth.uid()) then
    return new;
  end if;
  if (to_jsonb(new) - 'is_active' - 'stopped_at' - 'stopped_reason' - 'schedule_times' - 'updated_at' - 'search_vector')
     is distinct from
     (to_jsonb(old) - 'is_active' - 'stopped_at' - 'stopped_reason' - 'schedule_times' - 'updated_at' - 'search_vector') then
    raise exception 'A prescription written by your care team can be stopped or have its reminder times changed, but not otherwise edited'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_patient_clinician_medication_allowlist() from public, anon, authenticated;

drop trigger if exists medications_a_patient_allowlist on public.medications;
create trigger medications_a_patient_allowlist
  before update on public.medications
  for each row execute function private.enforce_patient_clinician_medication_allowlist();

revoke all on function public.prescribe_medication(uuid, text, text, text, date, jsonb, uuid, text, integer, text, integer, text, text) from public;
revoke all on function public.confirm_medication_refill(uuid, date) from public;
revoke all on function public.amend_medication(uuid, text, text, text, text, text, integer, text, integer, text, text, jsonb, date) from public;
grant execute on function public.prescribe_medication(uuid, text, text, text, date, jsonb, uuid, text, integer, text, integer, text, text) to authenticated;
grant execute on function public.confirm_medication_refill(uuid, date) to authenticated;
grant execute on function public.amend_medication(uuid, text, text, text, text, text, integer, text, integer, text, text, jsonb, date) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.prescribe_medication(uuid,text,text,text,date,jsonb,uuid,text,integer,text,integer,text,text)',
    'public.confirm_medication_refill(uuid,date)',
    'public.amend_medication(uuid,text,text,text,text,text,integer,text,integer,text,text,jsonb,date)'] loop
    if not (select prosecdef from pg_proc where oid = v_fn::regprocedure) then
      raise exception 'S05f assertion: % is not SECURITY DEFINER', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'S05f assertion: anon can execute %', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'S05f assertion: authenticated cannot execute %', v_fn;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'medications_a_patient_allowlist' and tgrelid = 'public.medications'::regclass and tgenabled = 'O') then
    raise exception 'S05f assertion: the patient allow-list trigger is missing';
  end if;
end $$;
