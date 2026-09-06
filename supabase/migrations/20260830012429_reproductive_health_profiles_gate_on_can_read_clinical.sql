-- The 2026-07-24 reproductive_health_profiles migration predates the
-- 2026-07-31 clinical_access consent sweep (sponsor_clinical_access_consent.sql /
-- sponsor_clinical_access_results_and_escalations.sql) and was never folded into
-- it. Its SELECT policy grants a grantee read access on the mere existence of
-- ANY profile_access row -- including a bare 'view'-level grant meant only for
-- the non-clinical "appointments" tier -- with no check of the patient's
-- clinical_access consent switch at all. Every other clinical table
-- (vitals_readings, medications, lab_analyte_readings, patient_timeline,
-- patient_blood_profile, care_plan_management, record_corrections, ...) gates
-- grantee reads through private.can_read_clinical(patient_id) instead. This is
-- the one sensitive-category table (reproductive health) that was left more
-- exposed than ordinary clinical data rather than less -- confirmed live via a
-- simulated-session BEGIN/ROLLBACK test before this migration: a view-only
-- grantee with clinical_access=false read the row anyway.
--
-- Fix: route the SELECT policy through can_read_clinical(), same as every
-- other post-sweep clinical table. Does not touch INSERT/UPDATE, which already
-- correctly require permission_level='manage' and were not implicated by the
-- audit finding.
--
-- vaccination_records has the identical pre-sweep bare-EXISTS pattern live
-- today (checked, not fixed here -- lower sensitivity, out of scope for this
-- migration, flagged separately).

drop policy if exists reproductive_health_profiles_select on public.reproductive_health_profiles;

create policy reproductive_health_profiles_select on public.reproductive_health_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

do $$
declare
  v_def text;
begin
  select qual into v_def
  from pg_policies
  where schemaname = 'public' and tablename = 'reproductive_health_profiles'
    and policyname = 'reproductive_health_profiles_select';

  if v_def is null or v_def not like '%can_read_clinical%' then
    raise exception 'reproductive_health_profiles_select must be gated on can_read_clinical, got: %', v_def;
  end if;
end $$;
