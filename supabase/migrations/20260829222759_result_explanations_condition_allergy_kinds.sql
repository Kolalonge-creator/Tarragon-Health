-- Spec §76.10 ("health literacy") — every major clinical item should have a
-- "what does this mean?" explanation, not just the kinds
-- (risk_score/lab_analyte/vitals) patient_result_explanations
-- (20260802205209) originally allowed. Extends the CHECK to also cover a
-- specific condition/allergy row and a care-schedule task, so the existing
-- ResultExplainer component can be wired onto the new conditions/allergies
-- summary and the Action Centre without a parallel explanation table.
--
-- Unlike the 3 original kinds (which key on "the patient's LATEST value for
-- this type"), 'condition'/'allergy'/'care_task' key on a specific row id as
-- subject_key — a patient can have several conditions/allergies/tasks at
-- once, so there is no single "latest" to collapse to. RLS on this table is
-- unaffected (still patient_id = auth.uid() OR is_org_staff), and the
-- (patient_id, kind, subject_key, language) unique constraint already
-- supports one cached explanation per row without any change.
--
-- Reconciled during the §76 merge into main-dev: two other same-day
-- migrations (20260828230916_patient_result_explanations_allow_medication.sql,
-- 20260829213726_ai_assistant_expansion_care_plan_appointment_prep.sql) had
-- already extended this same CHECK, independently of this branch, to add
-- 'medication' and 'care_plan_item' for the live AI Health Assistant §78
-- work. This migration must therefore ADD to that superset, not replace it —
-- dropping and re-adding with only this branch's own 3 new values would
-- silently break the already-wired medication/care-plan-item explainer kinds.
alter table public.patient_result_explanations
  drop constraint if exists patient_result_explanations_kind_check;

alter table public.patient_result_explanations
  add constraint patient_result_explanations_kind_check
  check (kind in ('risk_score', 'lab_analyte', 'vitals', 'medication', 'care_plan_item', 'condition', 'allergy', 'care_task'));
