-- Caregiver Proxy Access, part 5: closing the gap between what the
-- permission picker offers and what it actually restricts.
--
-- 20260829001500 added view_medication/view_results/view_care_plan/
-- view_appointments to the caregiver_permission vocabulary and the wizard
-- offered them as checkboxes, but nothing before this migration ever
-- checked them: every clinical read on this platform goes through
-- private.can_read_clinical(patient_id), the one-argument form, which only
-- asks "does clinical_access = true" — the coarse, all-or-nothing switch.
-- Unchecking "See test results" changed nothing, because the tables that
-- serve results never asked about results specifically. That is a real gap,
-- not a cosmetic one: a permission a patient believes they withheld that
-- keeps working is worse than not offering the checkbox at all.
--
-- This wires three of the four into the tables that actually carry them,
-- narrowing only the supporter branch of each policy (the patient's own
-- access and org staff access are untouched, same discipline as every
-- earlier migration in this series):
--
--   view_care_plan     care_plans
--   view_medication     medications
--   view_results        screening_results, lab_analyte_readings, lab_orders
--
-- view_appointments is deliberately NOT included here — appointments live
-- in a different table (public.appointments, the Appointment Engine built
-- 2026-08-28) with its own read policy that has never had any profile_access
-- awareness at all, not even the coarse clinical_access switch. Extending
-- that is 20260829031500_caregiver_view_appointments.sql, immediately after
-- this one; kept separate because it is a narrower, newer surface with no
-- prior sponsor-read behaviour to preserve, rather than an existing policy
-- to add a clause to.
--
-- Six other clinical-read tables already gated by the one-argument
-- can_read_clinical (vitals_readings, screening_schedules,
-- patient_risk_scores, escalations, clinician_alerts, patient_timeline)
-- deliberately stay on the coarse switch: none of them is what a patient
-- would understand "medication", "results" or "care plan" to mean
-- specifically, and forcing each into one of those three buckets would
-- misdescribe what unchecking the box actually protects. clinical_access
-- alone continues to gate all six, exactly as before this migration.

drop policy if exists care_plans_select on public.care_plans;
create policy care_plans_select on public.care_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'view_care_plan'::public.caregiver_permission)
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission)
  );

drop policy if exists screening_results_select on public.screening_results;
create policy screening_results_select on public.screening_results
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission)
  );

drop policy if exists lab_analyte_readings_select on public.lab_analyte_readings;
create policy lab_analyte_readings_select on public.lab_analyte_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission)
  );

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission)
  );

-- The migration is the test.
do $$
declare
  v_org uuid;
  v_a uuid;
  v_b uuid;
  v_allowed boolean;
  v_refused boolean;
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'care_plans' and cmd = 'SELECT'
       and qual not like '%view_care_plan%'
  ) then
    raise exception 'care_plans_select was not narrowed to view_care_plan';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'medications' and cmd = 'SELECT'
       and qual not like '%view_medication%'
  ) then
    raise exception 'medications_select was not narrowed to view_medication';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('screening_results', 'lab_analyte_readings', 'lab_orders')
       and cmd = 'SELECT' and qual not like '%view_results%'
  ) then
    raise exception 'a results table was not narrowed to view_results';
  end if;

  select id into v_org from public.organisations limit 1;
  select id into v_a from public.profiles where organisation_id = v_org limit 1;
  select id into v_b from public.profiles where organisation_id = v_org and id <> v_a limit 1;
  if v_org is null or v_a is null or v_b is null then
    raise warning 'skipping behavioural assertions: need an org and two profiles';
    return;
  end if;

  delete from public.profile_access where profile_id = v_a and grantee_user_id = v_b;
  insert into public.profile_access
    (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values
    (v_a, v_b, 'view', v_a, true, array['view_medication']::public.caregiver_permission[]);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_allowed := private.can_read_clinical(v_a, 'view_medication'::public.caregiver_permission);
  v_refused := private.can_read_clinical(v_a, 'view_results'::public.caregiver_permission);
  reset role;

  if not v_allowed then
    raise exception 'a grant scoped to view_medication must authorise view_medication';
  end if;
  if v_refused then
    raise exception 'a grant scoped to view_medication must not also authorise view_results';
  end if;

  -- Legacy behaviour must be unchanged: clinical_access alone, with no
  -- permissions narrowing, still opens every one of the three buckets.
  update public.profile_access set permissions = null
   where profile_id = v_a and grantee_user_id = v_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_allowed := private.can_read_clinical(v_a, 'view_results'::public.caregiver_permission)
    and private.can_read_clinical(v_a, 'view_care_plan'::public.caregiver_permission)
    and private.can_read_clinical(v_a, 'view_medication'::public.caregiver_permission);
  reset role;
  if not v_allowed then
    raise exception 'an unrestricted (permissions IS NULL) clinical_access grant must still open all three buckets';
  end if;

  delete from public.profile_access where profile_id = v_a and grantee_user_id = v_b;
end $$;
