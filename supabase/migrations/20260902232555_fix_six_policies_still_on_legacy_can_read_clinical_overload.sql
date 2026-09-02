-- 20260902190500_preserve_legacy_can_read_clinical_overload_for_pr377_compat.sql already
-- flagged, as a known follow-up, that 6 SELECT policies on core clinical tables were still
-- calling the legacy private.can_read_clinical(uuid) overload instead of the category-scoped
-- private.can_read_clinical(uuid, care_access_category) introduced by
-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql. Direct inspection
-- of the live project confirms it today: vitals_readings_select, care_plans_select,
-- medications_select, screening_schedules_select, lab_orders_select and
-- patient_risk_scores_select all still read `private.can_read_clinical(patient_id)` with no
-- has_emergency_access branch at all -- even though 103251's own committed migration text,
-- and a same-day follow-up (20260830104041_care_plan_status_history.sql, for care_plans_select
-- specifically), already rewrote these exact 6 policies to the correct 2-arg form. There is no
-- migration anywhere in this repo that reverts them back to the 1-arg form -- this is the same
-- "live schema object with no migration record at all" drift CLAUDE.md warns about, just
-- affecting policies instead of a trigger/function this time.
--
-- Practical effect while broken: the 1-arg overload treats ANY profile_access grant
-- (regardless of which of the 8 care_access_category values it names) as sufficient to read
-- these 6 tables, and grants no break-glass path at all -- so a caregiver scoped to, say, only
-- "appointments & care plan" could read a patient's vitals, medications, labs, care plans,
-- screening schedules and risk scores, bypassing the founder's 2026-08-30 per-category consent
-- design; and a clinician with a valid emergency_record_access_grants break-glass grant could
-- NOT see any of these 6 tables through it, since has_emergency_access was never called.
--
-- Fixed forward here (never editing 103251 or 104041 themselves, which are already applied)
-- by re-running DROP POLICY / CREATE POLICY for exactly these 6 policies, matching the same
-- can_read_clinical(patient_id, category) OR has_emergency_access(patient_id, category) shape
-- every other correctly-migrated policy on the live project already uses (verified directly,
-- e.g. clinical_summaries_select / screening_results_select / vaccination_records_select).
--
-- Category mapping, taken from 103251's own source text and confirmed against precedent
-- already live for sibling tables:
--   vitals_readings       -> vitals_readings      (same category name)
--   medications           -> medications           (same category name)
--   lab_orders             -> labs_results          (matches screening_results_select, lab_analyte_readings_select)
--   care_plans             -> appointments_care_plan (matches care_plan_goals_select, care_plan_interventions_select,
--                                                      and 104041's own care_plans_select rewrite)
--   screening_schedules    -> labs_results          (matches screening_results_select -- same screening domain)
--   patient_risk_scores    -> medical_history        (matches clinical_summaries_select, clinician_alerts_select,
--                                                      escalations_select, patient_timeline_select, etc.)
--
-- This migration deliberately does NOT touch private.can_read_clinical(uuid) itself or drop
-- it -- PR #377's emergency_access_grants feature still depends on it, per the compat
-- migration's own note. That overload's retirement remains a separate, deliberate follow-up
-- once PR #377 is reconciled onto the 2-arg pattern.

drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'vitals_readings')
    or private.has_emergency_access(patient_id, 'vitals_readings')
  );

drop policy if exists care_plans_select on public.care_plans;
create policy care_plans_select on public.care_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan')
    or private.has_emergency_access(patient_id, 'appointments_care_plan')
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medications')
    or private.has_emergency_access(patient_id, 'medications')
  );

drop policy if exists screening_schedules_select on public.screening_schedules;
create policy screening_schedules_select on public.screening_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results')
    or private.has_emergency_access(patient_id, 'labs_results')
  );

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results')
    or private.has_emergency_access(patient_id, 'labs_results')
  );

drop policy if exists patient_risk_scores_select on public.patient_risk_scores;
create policy patient_risk_scores_select on public.patient_risk_scores
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history')
    or private.has_emergency_access(patient_id, 'medical_history')
  );

-- ---------------------------------------------------------------------------
-- Self-assertions: every one of the 6 policies now names both functions, using the
-- 2-arg can_read_clinical overload specifically (not just any can_read_clinical call).
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(schemaname || '.' || tablename || '.' || policyname, ', ')
  into v_bad
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'vitals_readings_select', 'care_plans_select', 'medications_select',
      'screening_schedules_select', 'lab_orders_select', 'patient_risk_scores_select'
    )
    and (
      coalesce(qual, '') !~ 'can_read_clinical\(patient_id, ''[a-z_]+''::care_access_category\)'
      or coalesce(qual, '') !~ 'has_emergency_access\(patient_id, ''[a-z_]+''::care_access_category\)'
    );

  if v_bad is not null then
    raise exception 'these policies are still missing the category-scoped can_read_clinical or has_emergency_access calls: %', v_bad;
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'vitals_readings_select', 'care_plans_select', 'medications_select',
        'screening_schedules_select', 'lab_orders_select', 'patient_risk_scores_select'
      )
      and coalesce(qual, '') ~ 'can_read_clinical\(patient_id\)'
  ) then
    raise exception 'a policy among the 6 still calls the legacy 1-arg can_read_clinical(patient_id)';
  end if;
end $$;
