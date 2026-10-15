-- S60 x S16-S20 task layer: a completed symptom review closes its own task.
--
-- The S16-S20 task layer (20261014235641) made private.task_outcome_error accept a symptom_review task only when the claimant has
-- finalized a clinical encounter note (code answer_signed). S60 completes a symptom review on its own record, public.symptom_reviews
-- (complete_symptom_review), which is the clinical record of that work; without this change the task stays claimed and an incident is
-- opened for every completed review (found by the S60 proof, 6c2).
--
-- This keeps the encounter-note proof and ADDS the S60 one: the outcome names a symptom_reviews row that belongs to this task and
-- patient, is completed, and was completed by the claimant. Nothing else in the function changes. Patched in place from its live text
-- so a later change to the rest of the function is not copied; it fails loudly if the anchor is not found.
-- Counts before: no symptom_reviews rows exist live (S60 is not applied), so there is nothing to convert.
do $$
declare
  v_def text;
  v_new text;
  v_anchor constant text := E'    if not exists (select 1 from public.clinical_encounter_notes n\n';
begin
  v_def := pg_get_functiondef('private.task_outcome_error(public.clinical_tasks, uuid, jsonb)'::regprocedure);
  if position('symptom_reviews sr' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'S60: task_outcome_error changed shape (the symptom_review encounter-note check was not found); patch by hand';
  end if;
  v_new := replace(v_def, v_anchor,
    E'    if not exists (select 1 from public.symptom_reviews sr\n' ||
    E'                    where sr.id = private.try_uuid(p_outcome ->> ''symptom_review'') and sr.task_id = t.id\n' ||
    E'                      and sr.patient_id = t.patient_id and sr.status = ''completed'' and sr.clinician_id = p_uid)\n' ||
    E'       and not exists (select 1 from public.clinical_encounter_notes n\n');
  execute v_new;
  if position('symptom_reviews sr' in pg_get_functiondef('private.task_outcome_error(public.clinical_tasks, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception 'S60: the task_outcome_error patch did not apply';
  end if;
end $$;
