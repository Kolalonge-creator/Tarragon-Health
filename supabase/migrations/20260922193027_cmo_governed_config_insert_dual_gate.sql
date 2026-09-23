-- CMO governance self-sufficiency: extend the admin-only INSERT policy on 5
-- governed config tables to also admit an active Clinical Director, mirroring
-- triage_protocols_insert's existing shape exactly (broadened 2026-09-14 in
-- the same "CMO governance-surface audit" this migration continues).
--
-- Found 2026-09-22: sign_alert_rules / sign_escalation_slas /
-- sign_mental_health_screening_cadences / sign_provider_quality_policy /
-- sign_vaccination_schedule are ALL already Clinical-Director-only at the RPC
-- level (never admit `admin` at all) — but the matching *_insert RLS policy
-- on each of these 5 tables was still `private.is_admin()`-only, with no
-- Clinical Director fallback. Since `profiles.role = 'admin'` and
-- `doctor_tier = 'chief_medical_officer'` are never the same account (see
-- CLAUDE.md's "never re-split the account role" rule — a real CMO's account
-- role is always `clinician`), this meant nobody could draft a new version of
-- any of these 5 configs through the database at all: an admin login could
-- insert a draft but could never sign it, and the only account that could
-- sign it had no RLS path to insert one. cv_risk_config and
-- risk_questionnaire_configs were unaffected — both already gate INSERT on
-- private.is_org_staff(), which admits any non-patient, non-excluded-role
-- staff account including a plain `clinician`.
--
-- Proof: packages/db/tests/cmo_governed_config_insert_dual_gate.sql (gate
-- opens for an active Clinical Director, stays shut for a plain clinician).
--
-- This does not touch the SELECT policies (already broad enough for any
-- staff/clinician to read) or the sign_* RPCs themselves (already correctly
-- Clinical-Director-only, untouched here).
alter policy alert_rules_insert on public.alert_rules
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff
      where clinical_staff.profile_id = (select auth.uid())
        and clinical_staff.active
        and clinical_staff.doctor_tier = 'chief_medical_officer'
    ))
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy escalation_slas_insert on public.escalation_slas
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff
      where clinical_staff.profile_id = (select auth.uid())
        and clinical_staff.active
        and clinical_staff.doctor_tier = 'chief_medical_officer'
    ))
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy mental_health_screening_cadences_insert on public.mental_health_screening_cadences
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff
      where clinical_staff.profile_id = (select auth.uid())
        and clinical_staff.active
        and clinical_staff.doctor_tier = 'chief_medical_officer'
    ))
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy provider_quality_policy_insert on public.provider_quality_policy
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff
      where clinical_staff.profile_id = (select auth.uid())
        and clinical_staff.active
        and clinical_staff.doctor_tier = 'chief_medical_officer'
    ))
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy vaccination_schedule_signoffs_insert on public.vaccination_schedule_signoffs
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff
      where clinical_staff.profile_id = (select auth.uid())
        and clinical_staff.active
        and clinical_staff.doctor_tier = 'chief_medical_officer'
    ))
    and approved_by is null
    and approved_at is null
    and is_active = false
  );
