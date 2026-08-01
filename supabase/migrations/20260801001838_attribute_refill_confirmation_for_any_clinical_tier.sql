-- Tarragon Health
-- Attribute a refill confirmation to whoever actually made it, at any tier.
--
-- private.enforce_medication_confirm_only stamped last_confirmed_at /
-- last_confirmed_by only in the Tier 1 branch, AFTER an unconditional
--     if private.has_prescribing_authority(...) then return new; end if;
-- so a Tier 2+ doctor confirming a refill wrote refill_date but was never
-- attributed, and the patient-facing "Confirmed by your care team - date" line
-- stayed blank. Paired with the UI gate (which excluded prescribers outright,
-- fixed in the same change), a senior doctor covering a shift with no Tier 1
-- on duty could neither reach the control nor be credited for using it.
--
-- Companion to 20260801001234_refill_confirm_any_clinical_tier.sql, which made
-- can_confirm_medication_refill a floor rather than a fence. That migration
-- fixed WHO MAY confirm; this one fixes WHETHER IT IS RECORDED.
--
-- The correction is deliberately NOT "stamp for everyone". A prescriber makes
-- many kinds of write to this table, and a dose change or a stop must never
-- surface to the patient as a care-team confirmation. So:
--   * non-prescriber -- every update they are permitted to make IS a
--     confirmation (the restriction block guarantees it), so stamp
--     unconditionally. Byte-for-byte the prior behaviour, including the case
--     where a clinician re-confirms an unchanged refill_date, which a
--     value-change test would have silently regressed.
--   * prescriber -- stamp only when refill_date actually moved AND no clinical
--     field changed alongside it.
--
-- Restrictions are untouched: a non-prescriber still cannot change drug, dose,
-- frequency, schedule, active status or ownership, and still cannot touch a
-- non-clinician-sourced medication. Both raise 42501 exactly as before.
-- A patient editing their own row still returns early and is never stamped --
-- a patient is not their own care team.
--
-- Proven by packages/db/tests/refill_confirmation_attribution.sql (5 cases,
-- rolled back): Tier 1 confirm stamps; Tier 4 confirm stamps; Tier 4 dose
-- change does NOT stamp while the dose genuinely changes; a patient edit does
-- not stamp; a Tier 1 dose change is still blocked 42501.

create or replace function private.enforce_medication_confirm_only()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_caller_staff_id uuid;
  v_is_prescriber   boolean;
  v_is_confirmation boolean;
begin
  -- Patient editing their own row: unrestricted, and never stamped -- a
  -- patient is not their own care team, so last_confirmed_* must stay clear.
  if new.patient_id = (select auth.uid()) then
    return new;
  end if;

  v_is_prescriber := private.has_prescribing_authority(new.organisation_id);

  if not v_is_prescriber then
    -- Reached medications_update's USING clause only via
    -- can_confirm_medication_refill. Restrict to refill confirmation: no drug,
    -- dose, frequency, schedule, active-status or ownership changes.
    if old.source is distinct from 'clinician' then
      raise exception 'Only an existing clinician-prescribed medication can be confirmed and continued' using errcode = '42501';
    end if;

    if old.drug_name is distinct from new.drug_name
      or old.dose is distinct from new.dose
      or old.frequency is distinct from new.frequency
      or old.schedule_times is distinct from new.schedule_times
      or old.is_active is distinct from new.is_active
      or old.care_plan_id is distinct from new.care_plan_id
      or old.source is distinct from new.source
      or old.added_by is distinct from new.added_by
      or old.patient_id is distinct from new.patient_id
      or old.organisation_id is distinct from new.organisation_id
    then
      raise exception 'Confirming a prescription can only update the refill date — changing drug, dose, frequency, or status needs Tier 2 or above' using errcode = '42501';
    end if;
  end if;

  -- Attribute the confirmation. See the header for why this is conditional
  -- for a prescriber and unconditional for everyone else.
  if v_is_prescriber then
    v_is_confirmation :=
      new.refill_date is distinct from old.refill_date
      and old.drug_name is not distinct from new.drug_name
      and old.dose is not distinct from new.dose
      and old.frequency is not distinct from new.frequency
      and old.schedule_times is not distinct from new.schedule_times
      and old.is_active is not distinct from new.is_active;
  else
    v_is_confirmation := true;
  end if;

  if v_is_confirmation then
    select id into v_caller_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;

    if v_caller_staff_id is not null then
      new.last_confirmed_at := now();
      new.last_confirmed_by := v_caller_staff_id;
    end if;
  end if;

  return new;
end;
$function$;

-- The migration is the test: the whole point is that stamping no longer sits
-- behind an unconditional prescriber early-return.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'enforce_medication_confirm_only';

  if v_def like '%has_prescribing_authority(new.organisation_id) then%return new;%' then
    raise exception 'prescriber early-return still short-circuits stamping';
  end if;

  if v_def not like '%v_is_confirmation%' then
    raise exception 'confirmation detection missing';
  end if;
end $$;
