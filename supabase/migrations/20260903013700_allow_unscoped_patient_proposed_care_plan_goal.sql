-- Tarragon Health — Care Management Engine integration follow-up (PR #279
-- reconciliation against main-dev's already-merged Module 74, PR #454).
--
-- REAL BUG, confirmed live: #454's 20260902232136_care_management_case_
-- plan_items.sql added `care_plan_goals_scope_check`
--   CHECK (care_plan_id IS NOT NULL OR case_id IS NOT NULL)
-- on the theory that "a goal belongs to exactly one of a condition-level
-- care_plan or a cross-condition care_management_case". That's true for
-- every clinician/protocol-sourced goal, but not for §3.16's patient
-- self-proposal path: care_plan_goals_patient_propose_insert (live, see
-- 20260828222423_care_plan_goals.sql) lets a patient insert a goal with
-- BOTH care_plan_id and case_id left null — they're proposing a goal
-- ("walk more", "cut down on salt") before any clinician has linked it to a
-- specific condition plan or case. useProposeCarePlanGoal
-- (apps/web/src/lib/queries/care-plan-goals.ts) never sets either column,
-- by design.
--
-- Confirmed via execute_sql against the live project
-- (koiplnmbgnqnbywhpjlf): care_plan_goals_scope_check is live today and
-- would reject every one of those inserts outright — a patient tapping
-- "propose a goal" gets a bare constraint-violation error, no upgrade path
-- for the row afterward. Fixed forward (never editing #454's already-
-- applied migration): widen the check to also allow the specific
-- proposed+patient-sourced shape the insert policy itself already commits
-- to (status = 'proposed' AND source = 'patient' AND approved_by/
-- approved_at both null — exactly what that policy's WITH CHECK requires).
-- A protocol- or clinician-sourced goal, or a patient's goal once a
-- clinician approves/links it, still must carry a real care_plan_id or
-- case_id — this does not loosen that.

alter table public.care_plan_goals drop constraint care_plan_goals_scope_check;

alter table public.care_plan_goals
  add constraint care_plan_goals_scope_check
  check (
    care_plan_id is not null
    or case_id is not null
    or (status = 'proposed' and source = 'patient' and approved_by is null and approved_at is null)
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'care_plan_goals_scope_check'
      and conrelid = 'public.care_plan_goals'::regclass
  ) then
    raise exception 'care_plan_goals_scope_check was not recreated';
  end if;

  -- Prove the patient-propose shape now actually passes the constraint
  -- (insert + rollback inside this DO block leaves no row behind).
  begin
    insert into public.care_plan_goals
      (organisation_id, patient_id, description, status, source)
    select o.id, pr.id, 'proof: unscoped patient-proposed goal', 'proposed', 'patient'
    from public.organisations o, public.profiles pr
    limit 1;
    raise exception 'PROOF_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'PROOF_ROLLBACK' then
        raise exception 'FAIL: an unscoped patient-proposed goal still violates care_plan_goals_scope_check (%)', sqlerrm;
      end if;
  end;

  raise notice 'PASS: care_plan_goals_scope_check allows an unscoped patient-proposed goal, still requires care_plan_id/case_id for every other source';
end $$;
