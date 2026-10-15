-- S57b (founder/CMO decision 2026-10-07, OQ-F1-03 and the S56 follow-up list): a crisis-flagged wellbeing screen gets its OWN task type.
--
-- WHY. F1 reused the spec type red_event_unacknowledged for the crisis route because no dedicated type existed (F1 recorded this as OQ-F1-03). That
-- type means "a red page was not acknowledged"; queue reports, the quality-and-safety reasons (S20) and the console label a crisis as the wrong thing.
-- The decision: a NEW type crisis_follow_up, created as needing the CMO's confirmation (the same mechanism as adherence_follow_up, S16b).
--
-- WHAT CHANGES.
--   1. task_types gets crisis_follow_up v1: priority class 1, due at once, no lead window (INV-05; the table CHECK also forces this for class 1),
--      senior medical officer and the on_call competency (the same as red_event_unacknowledged, so the crisis reaches exactly the same people),
--      not pushable, creatable, needs_confirmation true. The values are PROPOSED; the CMO confirms them with public.confirm_task_type('crisis_follow_up').
--      SIDE EFFECT, deliberate: public.approve_triage_rule_set refuses while ANY active task type awaits confirmation, so until the CMO confirms
--      crisis_follow_up no triage rule set can be approved. A confirmed-already rule set is unaffected, and this task is created whether or not it
--      has been confirmed (create_clinical_task only needs the type to be active and creatable): the crisis is never held back by sign-off.
--   2. private.raise_crisis_follow_up is replaced (create or replace) so step (b) creates a crisis_follow_up task. Nothing else in it changes: the
--      urgent crisis.detected event, the on-call page (else the clinical lead, ops and a "nobody on call" incident), the audit markers crisis.notified
--      and crisis.handled that make a replay idempotent, and the loud failure path (crisis_task.error audit row plus an incident, never a rollback of the
--      patient's screen) are copied unchanged from F1. The trigger and the event are untouched.
--   3. Existing rows: tasks created before this migration keep their red_event_unacknowledged type (history is not rewritten). Open crisis tasks
--      of that older type, if any exist live, finish their life as before; the dedup key crisis:<patient> merges a new crisis into any live one
--      regardless of type. The dry run records: select count(*) from public.clinical_tasks where dedup_key like 'crisis:%'.
--
-- The old behaviour is NOT lost: the new type has the same priority class, tier, competency and due time, the same page recipient, and the proof
-- packages/db/tests/s57b_crisis_follow_up_task_type.sql re-checks class 1, the on-call notice, idempotency and the failure path against the new type.

-- 1. The task type
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, needs_confirmation, note)
values
  ('crisis_follow_up', 1, 1, 0, 'senior_medical_officer', '{on_call}', 0, 30, false, true, '{}', true,
   'S57b: a wellbeing check-in raised a crisis flag (F1 crisis route). Same class, tier and competency as red_event_unacknowledged, which F1 reused until this type existed (OQ-F1-03). PROPOSED, awaiting the CMO''s confirmation. Never has a lead window (INV-05).')
on conflict do nothing;

-- 2. The idempotent core, now creating the dedicated task type. Patched IN PLACE: only the task type the crisis route asks for changes, so every
--    later change to the function (F1's review rounds, the two-tier work) is kept instead of being overwritten by a copy of an older body.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('private.raise_crisis_follow_up(uuid)'::regprocedure);
  if v_def like '%create_clinical_task(s.patient_id, ''crisis_follow_up''%' then
    return; -- already patched (a replay)
  end if;
  v_new := replace(v_def, 'create_clinical_task(s.patient_id, ''red_event_unacknowledged''', 'create_clinical_task(s.patient_id, ''crisis_follow_up''');
  if v_new = v_def then raise exception 'S57b: raise_crisis_follow_up marker not found (definition drifted)'; end if;
  execute v_new;
end $$;


-- 3. Self-check
do $$
begin
  if not exists (select 1 from public.task_types where code = 'crisis_follow_up' and is_active and priority_class = 1 and lead_window_minutes = 0
                  and default_due_minutes = 0 and min_doctor_tier = 'senior_medical_officer' and required_competencies = '{on_call}' and needs_confirmation and confirmed_at is null and creatable) then
    raise exception 'FAIL: crisis_follow_up is missing, wrongly shaped, or already confirmed by the build';
  end if;
  if pg_get_functiondef('private.raise_crisis_follow_up(uuid)'::regprocedure) like '%red_event_unacknowledged%' then
    raise exception 'FAIL: the crisis route still creates the older task type';
  end if;
  if has_function_privilege('anon', 'private.raise_crisis_follow_up(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.raise_crisis_follow_up(uuid)', 'EXECUTE') then
    raise exception 'FAIL: raise_crisis_follow_up is callable by anon or authenticated';
  end if;
end $$;
