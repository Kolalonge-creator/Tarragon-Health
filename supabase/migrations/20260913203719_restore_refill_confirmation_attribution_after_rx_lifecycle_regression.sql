-- Recovered 2026-09-14 from supabase_migrations.schema_migrations.statements.
--
-- This migration was applied live to koiplnmbgnqnbywhpjlf on 2026-09-13 20:37:19
-- but never committed to any branch (checked via `git log --all --diff-filter=A`
-- across all local branches). The body below is the applied SQL verbatim; the
-- filename is pinned to the live `version` (20260913203719) so the recovery does
-- not create a second, divergent record of the same change. Do not renumber it.

-- Tarragon Health
-- Restore the conditional refill-confirmation attribution logic that
-- 20260829010000_prescription_lifecycle_rx_number_and_expiry.sql silently
-- reverted, while keeping that migration's expanded restriction columns.
--
-- History: 20260801001838_attribute_refill_confirmation_for_any_clinical_tier.sql
-- fixed a real bug where a prescriber (now Senior Medical Officer+) confirming
-- a refill wrote refill_date but was never attributed (last_confirmed_by /
-- last_confirmed_at stayed null), because the function had an unconditional
--     if private.has_prescribing_authority(...) then return new; end if;
-- BEFORE the stamping code, so only non-prescribers (now Medical Officer) ever
-- got the "Confirmed by your care team" attribution. That migration replaced
-- the unconditional early-return with conditional logic: stamp non-prescribers
-- unconditionally, and stamp prescribers too but ONLY when refill_date
-- actually moved and no other clinical field changed alongside it (so a
-- prescriber's dose change / stop is never mis-credited as a confirmation).
--
-- Regression: 20260829010000_prescription_lifecycle_rx_number_and_expiry.sql
-- re-created this same function to extend the restriction comparison list
-- with the new rx_number/verification_code/expires_at/version/
-- previous_version_id/superseded_at/amendment_reason columns, under the claim
-- "Function body is otherwise byte-for-byte the live definition; only the
-- new-column comparisons are added." That claim was false -- it silently
-- carried forward the OLD pre-2026-08-01 shape (the unconditional
-- has_prescribing_authority early-return), discarding the attribution fix
-- entirely. Confirmed live via pg_get_functiondef against project
-- koiplnmbgnqnbywhpjlf on 2026-09-13: the deployed function has the
-- unconditional early return, not the v_is_prescriber/v_is_confirmation
-- logic. No migration between 20260829010000 and today re-applies the fix.
--
-- Net effect while this stood: any Senior Medical Officer or Chief Medical
-- Officer confirming a routine refill got zero attribution credit -- the
-- exact "senior doctor covering a shift gets no credit for confirming a
-- refill" gap the 2026-08-01 migration existed to close, reopened silently
-- for six weeks.
--
-- This migration reapplies the 2026-08-01 conditional-stamping shape AND
-- keeps 20260829010000's full new-column restriction coverage, so neither
-- fix regresses the other. Column list intentionally matches the live
-- 20260829010000 definition plus the tier-collapse-era column names
-- (has_prescribing_authority/doctor_tier already reference the current
-- 4-value enum via clinical_staff -- no enum values are hardcoded here).
--
-- Proven by packages/db/tests/refill_confirmation_attribution.sql (5 cases,
-- rolled back) -- updated in this same change for the 2026-08-31 doctor-tier
-- collapse (medical_officer / senior_medical_officer replace the retired
-- tier_1 / tier_4_senior_registrar values, and the retired
-- is_clinical_director column is no longer inserted).

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
    -- dose, frequency, schedule, active-status, ownership, or prescription-
    -- lifecycle field changes.
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
      or old.route is distinct from new.route
      or old.duration_days is distinct from new.duration_days
      or old.quantity is distinct from new.quantity
      or old.repeats_allowed is distinct from new.repeats_allowed
      or old.indication is distinct from new.indication
      or old.instructions is distinct from new.instructions
      or old.rx_number is distinct from new.rx_number
      or old.verification_code is distinct from new.verification_code
      or old.expires_at is distinct from new.expires_at
      or old.version is distinct from new.version
      or old.previous_version_id is distinct from new.previous_version_id
      or old.superseded_at is distinct from new.superseded_at
      or old.amendment_reason is distinct from new.amendment_reason
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

-- The migration is the test: prove the prescriber early-return is gone AND
-- every new-column restriction from 20260829010000 survived the restore.
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

  if v_def not like '%old.rx_number is distinct from new.rx_number%'
     or v_def not like '%old.verification_code is distinct from new.verification_code%'
     or v_def not like '%old.expires_at is distinct from new.expires_at%'
     or v_def not like '%old.version is distinct from new.version%'
     or v_def not like '%old.previous_version_id is distinct from new.previous_version_id%'
     or v_def not like '%old.superseded_at is distinct from new.superseded_at%'
     or v_def not like '%old.amendment_reason is distinct from new.amendment_reason%'
  then
    raise exception 'enforce_medication_confirm_only lost a prescription-lifecycle column guard';
  end if;

  if v_def not like '%old.route is distinct from new.route%'
     or v_def not like '%old.duration_days is distinct from new.duration_days%'
     or v_def not like '%old.quantity is distinct from new.quantity%'
     or v_def not like '%old.repeats_allowed is distinct from new.repeats_allowed%'
     or v_def not like '%old.indication is distinct from new.indication%'
     or v_def not like '%old.instructions is distinct from new.instructions%'
  then
    raise exception 'enforce_medication_confirm_only lost an order-entry column guard';
  end if;
end $$;
