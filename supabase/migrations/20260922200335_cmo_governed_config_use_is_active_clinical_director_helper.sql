-- Code review follow-up (2026-09-22): the two prior migrations in this pass
-- (20260922193027, 20260922193255) inlined the same
-- "exists (select 1 from clinical_staff where profile_id = auth.uid() and
-- active and doctor_tier = 'chief_medical_officer')" predicate 6 times
-- across 6 policies, when private.is_active_clinical_director() — created
-- 6 days earlier in 20260916013857_ai_evaluation_write_allows_active_
-- clinical_director.sql specifically so RLS policies could OR it with
-- private.is_admin() instead of duplicating the raw predicate — already
-- exists and is functionally identical (confirmed via pg_get_functiondef).
-- No behaviour change: this migration only replaces the inlined EXISTS
-- with a call to the existing helper on all 6 policies, closing the
-- duplication this pass itself introduced rather than leaving it as a
-- second, unrelated copy of the same authority check to keep in sync.
alter policy alert_rules_insert on public.alert_rules
  with check (
    (private.is_admin() or private.is_active_clinical_director())
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy escalation_slas_insert on public.escalation_slas
  with check (
    (private.is_admin() or private.is_active_clinical_director())
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy mental_health_screening_cadences_insert on public.mental_health_screening_cadences
  with check (
    (private.is_admin() or private.is_active_clinical_director())
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy provider_quality_policy_insert on public.provider_quality_policy
  with check (
    (private.is_admin() or private.is_active_clinical_director())
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy vaccination_schedule_signoffs_insert on public.vaccination_schedule_signoffs
  with check (
    (private.is_admin() or private.is_active_clinical_director())
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

alter policy clinical_rules_insert on public.clinical_rules
  with check (
    (private.is_admin() or private.is_active_clinical_director())
    and status = 'draft'
    and approved_by is null
    and approved_at is null
    and activated_at is null
  );
