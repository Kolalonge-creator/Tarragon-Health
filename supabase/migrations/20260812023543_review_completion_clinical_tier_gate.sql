-- Same false-attribution bug class as the escalation/async-consult fix
-- (20260812003707_escalation_and_consult_clinical_tier_gate.sql), found by
-- extending that audit to every table with a reviewed_by/completed-by style
-- column. Four "stamp completion" triggers looked up the caller's
-- clinical_staff row with NO tier filter -- `where profile_id = auth.uid()
-- and organisation_id = ... and active` -- while the tables' own UPDATE RLS
-- is bare private.is_org_staff(organisation_id), which admits
-- care_coordinator. The matching app code
-- (apps/web/src/lib/queries/medication-reviews.ts,
-- .../lib/queries/preventive-reviews.ts,
-- .../clinician/annual-reviews/actions.ts,
-- .../clinician/lifestyle-reviews/actions.ts) either has no tier check at all
-- or (lifestyle-reviews/actions.ts) checks only "has an active clinical_staff
-- row" -- true for a Care Coordinator too, despite that action's own comment
-- claiming it is doctor-gated. Net effect: a Care Coordinator could mark a
-- medication/annual/lifestyle/preventive review "completed" and be recorded
-- as the reviewing clinician, which any "Reviewed by Dr. X"-style display
-- reading that table's reviewed_by would render as false clinical
-- attribution -- exactly what CLINICAL_TRUST_MODEL_SPEC.md's null-gated
-- ReviewedByDoctor pattern exists to prevent.
--
-- Fix: block the completion transition outright for a non-clinical-tier
-- caller (private.is_clinical_tier, same helper the escalation fix added),
-- rather than merely leaving reviewed_by null -- a review silently marked
-- "completed" with no doctor behind it would be worse than a loud refusal,
-- since nothing else would ever re-surface it for actual clinical review.
--
-- Verified live in a rolled-back transaction: the real care_coordinator
-- profile was blocked (42501) from completing a real pending medication
-- review; the real tier_3 clinician succeeded on the same row.

create or replace function private.stamp_annual_review_completion()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can complete an annual review. A Care Coordinator can prepare it, but a doctor must complete it.'
        using errcode = '42501';
    end if;
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff_id;
    new.current_stage := 'completed';
  end if;
  return new;
end;
$function$;

create or replace function private.stamp_lpe_review_completion()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_staff uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can complete a lifestyle review. A Care Coordinator can prepare it, but a doctor must complete it.'
        using errcode = '42501';
    end if;
    select id into v_staff from public.clinical_staff
      where profile_id = (select auth.uid())
        and organisation_id = new.organisation_id and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff;
  end if;
  return new;
end;
$function$;

create or replace function private.stamp_medication_review_completion()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can complete a medication review. A Care Coordinator can prepare it, but a doctor must complete it.'
        using errcode = '42501';
    end if;
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff_id;
  end if;
  return new;
end;
$function$;

create or replace function private.stamp_preventive_review_completion()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can complete a preventive review. A Care Coordinator can prepare it, but a doctor must complete it.'
        using errcode = '42501';
    end if;
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff_id;
  end if;
  return new;
end;
$function$;
