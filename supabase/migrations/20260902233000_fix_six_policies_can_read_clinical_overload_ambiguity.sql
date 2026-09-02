-- Tarragon Health
-- 20260902232555_fix_six_policies_still_on_legacy_can_read_clinical_overload.sql
-- (already applied/committed, not edited here) rewrote 6 RLS policies to call
-- private.can_read_clinical(patient_id, 'vitals_readings') etc. with an untyped
-- string literal for the category argument. That migration was authored
-- independently of this branch's own 20260902223515_caregiver_granular_permissions_
-- schema.sql, which adds a second 2-arg overload,
-- private.can_read_clinical(uuid, caregiver_permission) -- so an untyped literal
-- now matches two candidate functions and Postgres refuses to pick one
-- ("function private.can_read_clinical(uuid, unknown) is not unique", the same
-- ambiguity class already fixed once for four other live callers by this branch's
-- own 20260902224511_fix_can_read_clinical_overload_ambiguity_live_callers.sql).
--
-- Fix forward: redefine the same 6 policies with an explicit ::care_access_category
-- cast on every can_read_clinical/has_emergency_access literal, content otherwise
-- byte-identical to 20260902232555's own versions.

drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'vitals_readings'::care_access_category)
    or private.has_emergency_access(patient_id, 'vitals_readings'::care_access_category)
  );

drop policy if exists care_plans_select on public.care_plans;
create policy care_plans_select on public.care_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan'::care_access_category)
    or private.has_emergency_access(patient_id, 'appointments_care_plan'::care_access_category)
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medications'::care_access_category)
    or private.has_emergency_access(patient_id, 'medications'::care_access_category)
  );

drop policy if exists screening_schedules_select on public.screening_schedules;
create policy screening_schedules_select on public.screening_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results'::care_access_category)
    or private.has_emergency_access(patient_id, 'labs_results'::care_access_category)
  );

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results'::care_access_category)
    or private.has_emergency_access(patient_id, 'labs_results'::care_access_category)
  );

drop policy if exists patient_risk_scores_select on public.patient_risk_scores;
create policy patient_risk_scores_select on public.patient_risk_scores
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history'::care_access_category)
  );

-- Proof, not hope: every one of the 6 policies must reference the cast form, and a
-- direct ambiguity-reproducing call must now succeed rather than raise 42725.
do $$
declare
  v_bad text[];
begin
  select array_agg(tablename || '.' || policyname) into v_bad
  from pg_policies
  where schemaname = 'public'
    and (tablename, policyname) in (
      ('vitals_readings', 'vitals_readings_select'),
      ('care_plans', 'care_plans_select'),
      ('medications', 'medications_select'),
      ('screening_schedules', 'screening_schedules_select'),
      ('lab_orders', 'lab_orders_select'),
      ('patient_risk_scores', 'patient_risk_scores_select')
    )
    and coalesce(qual, '') !~ 'can_read_clinical\(patient_id, ''[a-z_]+''::care_access_category\)';

  if v_bad is not null then
    raise exception 'these policies are still missing the explicit ::care_access_category cast: %', v_bad;
  end if;

  raise notice 'PASS: all 6 policies use an explicitly-typed can_read_clinical/has_emergency_access call';
end $$;
