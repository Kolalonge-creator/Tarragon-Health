-- Module 20 (Health Education Platform) §20.7 "Explain my medication" — reuses the
-- existing "explain my result" cache/generation table (patient_result_explanations,
-- 20260802205209) and its kind/subject_key/language keying rather than a parallel table:
-- same fail-open, never-a-diagnosis, service-role-only-write discipline, just a new
-- `kind` value. See lib/patient-explainer/ for the medication-specific snapshot +
-- prompt template this unlocks.
alter table public.patient_result_explanations
  drop constraint patient_result_explanations_kind_check,
  add constraint patient_result_explanations_kind_check
    check (kind in ('risk_score', 'lab_analyte', 'vitals', 'medication'));
