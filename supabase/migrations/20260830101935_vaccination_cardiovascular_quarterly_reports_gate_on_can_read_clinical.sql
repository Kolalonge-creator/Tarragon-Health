-- Same bug class as reproductive_health_profiles (fixed in
-- 20260830012429_reproductive_health_profiles_gate_on_can_read_clinical): each of these
-- 4 tables predates the 2026-07-31 clinical_access consent sweep and was never folded into
-- it. Each SELECT policy grants a grantee read access on the mere existence of ANY
-- profile_access row -- including a bare 'view'-level grant meant only for the non-clinical
-- "appointments" tier -- with no check of the patient's clinical_access consent switch.
-- Fix: route each SELECT policy through can_read_clinical(), same as every other post-sweep
-- clinical table.

drop policy if exists vaccination_records_select on public.vaccination_records;
create policy vaccination_records_select on public.vaccination_records
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(profile_id)
  );

drop policy if exists vaccination_schedules_select on public.vaccination_schedules;
create policy vaccination_schedules_select on public.vaccination_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists patient_cardiovascular_profile_select on public.patient_cardiovascular_profile;
create policy patient_cardiovascular_profile_select on public.patient_cardiovascular_profile
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists patient_quarterly_reports_select on public.patient_quarterly_reports;
create policy patient_quarterly_reports_select on public.patient_quarterly_reports
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

do $$
declare
  v_bad text;
begin
  select string_agg(tablename || '.' || policyname, ', ')
  into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('vaccination_records','vaccination_schedules','patient_cardiovascular_profile','patient_quarterly_reports')
    and policyname like '%_select'
    and (qual is null or qual not like '%can_read_clinical%');

  if v_bad is not null then
    raise exception 'these SELECT policies must be gated on can_read_clinical: %', v_bad;
  end if;
end $$;
