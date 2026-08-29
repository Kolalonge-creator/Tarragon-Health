-- Tarragon Health — Electronic Prescription & Prescription Management Engine.
-- §62.14 "A changed prescription should create a new version" — v1 -> clinical
-- change -> v2, both rows kept (not overwritten), the old one flagged
-- superseded rather than deleted so the medication timeline stays complete
-- (same discipline as stopped_at/stopped_reason for a discontinued drug).
--
-- SECURITY INVOKER, deliberately not DEFINER: the two writes below (supersede
-- the old row, insert the new one) must be gated by exactly the RLS this
-- schema already enforces for ordinary prescribing — has_prescribing_
-- authority via medications_update/medications_insert — not by some new,
-- separate authority check duplicated inside this function. Running as
-- invoker means a Tier 1 or another org's staff calling this simply gets
-- zero rows matched by the UPDATE, which the explicit `not found` check
-- below turns into a clear error rather than the function silently
-- succeeding under an elevated identity.
--
-- ONE exception needs an explicit guard rather than relying on RLS alone:
-- medications_update/medications_insert both admit `patient_id = auth.uid()`
-- unconditionally, regardless of a row's `source` — intentional and
-- unchanged for the narrow, fixed-shape operations the UI actually offers a
-- patient (self-adding their own medication, stopping one, confirming a
-- refill date). amend_medication is a far more powerful, arbitrary-field
-- capability; letting a patient reach it on their own clinician-issued
-- prescription — patient_id is the patient regardless of who prescribed it —
-- would let them silently rewrite their own dose. The check below closes
-- that specifically for this function, without touching the shared RLS
-- policy every other medications write path also relies on.

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
security invoker
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
  if v_old.id is null then
    raise exception 'Prescription not found' using errcode = '42704';
  end if;
  if v_old.source <> 'clinician' then
    raise exception 'Only a clinician-issued prescription can be amended' using errcode = '42501';
  end if;
  if (select auth.uid()) = v_old.patient_id then
    raise exception 'A prescription can only be amended by clinical staff, not the patient' using errcode = '42501';
  end if;
  if v_old.superseded_at is not null then
    raise exception 'This prescription has already been amended — amend its current version instead' using errcode = '22023';
  end if;

  -- The row this function is allowed to touch is decided entirely by
  -- medications_update's own RLS (has_prescribing_authority) — a Tier 1 or
  -- other unauthorised caller matches zero rows here (RLS filters silently,
  -- it does not raise), which the explicit `not found` check below turns
  -- into a clear error instead of the function returning as if nothing was
  -- wrong.
  update public.medications
  set is_active = false, superseded_at = now()
  where id = p_medication_id;

  if not found then
    raise exception 'Not authorised to amend this prescription' using errcode = '42501';
  end if;

  -- The new row's own INSERT goes through medications_insert's ordinary RLS
  -- (has_prescribing_authority) too — the UPDATE above having succeeded
  -- already proves the caller holds it, so this is not a second, separate
  -- authority decision, just the same one applied to the second statement.
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

comment on function public.amend_medication is
  'Spec §62.14 prescription amendment: supersedes the current version of a clinician-issued prescription and inserts a new one carrying the edits, atomically. RLS (has_prescribing_authority) is the real authority gate for both writes — this function adds no privilege of its own (SECURITY INVOKER).';

grant execute on function public.amend_medication(
  uuid, text, text, text, text, text, integer, text, integer, text, text, jsonb, date
) to authenticated;
revoke all on function public.amend_medication(
  uuid, text, text, text, text, text, integer, text, integer, text, text, jsonb, date
) from anon;
