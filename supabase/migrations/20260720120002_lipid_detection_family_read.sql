-- Tarragon Health — Cholesterol / lipid management as a CV-risk module
-- Phase 1 (Detection): lipids as longitudinal lab records, consent-gated
-- family visibility.
--
-- Deliberately NOT a standalone "cholesterol" table or service. Lipid values
-- already flow into public.lab_analyte_readings (total_cholesterol,
-- hdl_cholesterol, ldl_cholesterol, triglycerides — see
-- clinician/.../screening-result-actions.ts). This migration adds only:
--   1. computed Non-HDL as a first-class, longitudinal analyte code
--      (`non_hdl_cholesterol`); no schema change needed — `code` is free text
--      by design — the app persists it alongside each lipid submission. This
--      comment documents the reserved code so future readers know it exists.
--   2. consent-gated family visibility: a profile_access view/manage grantee
--      can read the granted member's lab history (the same explicit,
--      revocable consent primitive that already extends profiles_select in
--      20260706084848_profile_access.sql). This is what makes the shared
--      family dashboard show a member's lipid/lab history *only* with consent.
--
-- No new table, no new source of truth — the additive-faster-path rule holds.

-- Reserved analyte code (documentation only; `code` stays free text):
--   'non_hdl_cholesterol'  numeric, unit 'mg/dL'  = total_cholesterol - hdl_cholesterol
comment on column public.lab_analyte_readings.code is
  'Free-text analyte code (e.g. hba1c, psa, total_cholesterol, hdl_cholesterol, ldl_cholesterol, triglycerides, non_hdl_cholesterol). Matches the ML service AnalyteCode vocabulary plus app-computed derivations like non_hdl_cholesterol.';

-- Consent-gated family read: extend the SELECT policy to include an explicit
-- profile_access grantee. Mirrors the profiles_select extension pattern.
drop policy if exists lab_analyte_readings_select on public.lab_analyte_readings;
create policy lab_analyte_readings_select on public.lab_analyte_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = lab_analyte_readings.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );
