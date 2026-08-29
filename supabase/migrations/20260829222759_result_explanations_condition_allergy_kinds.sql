-- Spec §76.10 ("health literacy") — every major clinical item should have a
-- "what does this mean?" explanation, not just the 3 kinds
-- (risk_score/lab_analyte/vitals) patient_result_explanations
-- (20260802205209) currently allows. Extends the CHECK to also cover a
-- specific condition/allergy row and a care-schedule task, so the existing
-- ResultExplainer component can be wired onto the new conditions/allergies
-- summary and the Action Centre without a parallel explanation table.
--
-- Unlike the 3 existing kinds (which key on "the patient's LATEST value for
-- this type"), 'condition'/'allergy'/'care_task' key on a specific row id as
-- subject_key — a patient can have several conditions/allergies/tasks at
-- once, so there is no single "latest" to collapse to. RLS on this table is
-- unaffected (still patient_id = auth.uid() OR is_org_staff), and the
-- (patient_id, kind, subject_key, language) unique constraint already
-- supports one cached explanation per row without any change.
alter table public.patient_result_explanations
  drop constraint if exists patient_result_explanations_kind_check;

alter table public.patient_result_explanations
  add constraint patient_result_explanations_kind_check
  check (kind in ('risk_score', 'lab_analyte', 'vitals', 'condition', 'allergy', 'care_task'));
