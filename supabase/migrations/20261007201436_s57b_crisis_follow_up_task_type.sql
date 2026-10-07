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

-- 2. The idempotent core, now creating the dedicated task type
create or replace function private.raise_crisis_follow_up(p_screen uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  s public.mental_health_screens%rowtype;
  v_test boolean;
  v_event uuid;
  v_task uuid;
  v_to uuid;
  v_n integer := 0;
  v_failed boolean := false;
  v_notify_failed boolean := false;
  r record;
begin
  select * into s from public.mental_health_screens where id = p_screen;
  if not found or not s.crisis_flagged then return false; end if;
  -- replay of a screen already fully handled: nothing more to do
  if exists (select 1 from public.audit_log where action = 'crisis.handled' and entity_type = 'mental_health_screen' and entity_id = s.id) then
    return false;
  end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = s.patient_id;

  -- (a) the event: ids only (INV-07), urgent, idempotent per screen
  begin
    v_event := private.emit_domain_event('crisis.detected', s.organisation_id, jsonb_build_object('screen_id', s.id),
      'crisis.detected:' || s.id, s.patient_id, 'mental_health_screen', s.id, 'urgent');
  exception when others then
    v_failed := true;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (s.organisation_id, 'crisis_task.error', 'mental_health_screen', s.id, jsonb_build_object('step', 'event', 'error', sqlerrm));
    perform private.page_incident(s.organisation_id, 'crisis_follow_up_failed:' || s.id, 'A priority follow-up could not be completed',
      'A priority wellbeing follow-up step failed; see audit_log action crisis_task.error. The emergency event itself was still raised.');
  end;

  -- (b) the class 1 task (the dedicated crisis_follow_up type; no lead window, so it never waits for a pull)
  begin
    v_task := private.create_clinical_task(s.patient_id, 'crisis_follow_up', null, 'crisis:' || s.patient_id, null, null, v_event);
  exception when others then
    v_failed := true;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (s.organisation_id, 'crisis_task.error', 'mental_health_screen', s.id, jsonb_build_object('step', 'task', 'error', sqlerrm));
    perform private.page_incident(s.organisation_id, 'crisis_follow_up_failed:' || s.id, 'A priority follow-up could not be completed',
      'A priority wellbeing follow-up step failed; see audit_log action crisis_task.error. The emergency event itself was still raised.');
  end;

  -- (c) reach a person: the clinician on call, else the clinical lead and ops plus an incident.
  -- Once per screen: a replay after a partial failure must not page the same person twice.
  if not exists (select 1 from public.audit_log where action = 'crisis.notified' and entity_type = 'mental_health_screen' and entity_id = s.id) then
  begin
    v_to := private.page_recipient(s.organisation_id, v_test);
    if v_to is not null then
      perform private.crisis_notify(v_to, s.organisation_id, 'on_call_page', v_task);
    else
      for r in
        select p.id from public.profiles p where p.organisation_id = s.organisation_id and p.is_active and p.role = 'admin' and p.is_test = v_test
        union
        select cs.profile_id from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
         where cs.organisation_id = s.organisation_id and cs.profile_id is not null and cs.active and cs.status = 'active'
           and cs.doctor_tier = 'chief_medical_officer' and p.is_test = v_test
      loop
        perform private.crisis_notify(r.id, s.organisation_id, 'on_call_escalation', v_task);
        v_n := v_n + 1;
      end loop;
      perform private.page_incident(s.organisation_id, 'crisis_no_cover:' || s.id, 'A priority case with nobody on call',
        'A priority case arrived while no eligible clinician was on the rota. The clinical lead and ops were alerted' ||
        case when v_n = 0 then ' (nobody matched: add or activate a chief medical officer or admin account)' else '' end ||
        ' and a priority task is open.');
    end if;
  exception when others then
    v_failed := true;
    v_notify_failed := true;
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (s.organisation_id, 'crisis_task.error', 'mental_health_screen', s.id, jsonb_build_object('step', 'notify', 'error', sqlerrm));
    perform private.page_incident(s.organisation_id, 'crisis_follow_up_failed:' || s.id, 'A priority follow-up could not be completed',
      'A priority wellbeing follow-up step failed; see audit_log action crisis_task.error. The emergency event itself was still raised.');
  end;
  -- The marker depends on the NOTIFY step alone: a failure in the event or task step must not make a replay page
  -- the same person a second time. (Carried over from F1's review fix, which this function replaces.)
  if not v_notify_failed then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (s.organisation_id, 'crisis.notified', 'mental_health_screen', s.id, '{}'::jsonb);
  end if;
  end if;

  if not v_failed then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (s.organisation_id, 'crisis.handled', 'mental_health_screen', s.id, jsonb_build_object('task_id', v_task, 'event_id', v_event));
  end if;
  return not v_failed;
end;
$$;
revoke all on function private.raise_crisis_follow_up(uuid) from public, anon, authenticated;
grant execute on function private.raise_crisis_follow_up(uuid) to service_role;


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
