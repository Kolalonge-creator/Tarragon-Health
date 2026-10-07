-- S76 B5: clinician.task_completed is emitted when a clinician finishes a task through the generic completion door
-- (public.queue_complete). The event type and its version 1 (required key task_id) were registered by S10 and nothing
-- emitted it; clinical_task.completed is kept exactly as it was and both are written in the same transaction.
-- Payload: ids and the task type only (task_id, type, clinician_id, priority_class). No outcome, no reading, no words.
-- Idempotent per claim, so a retry never writes a second row.
--
-- safety_concern.raised is deliberately NOT emitted and not registered. S20 promises that no domain event or audit row
-- ever names a concern, and the event tables are readable by every admin account ("ops"): domain_events,
-- domain_event_deliveries and event_effects all have admin read policies, and a dead urgent delivery opens an ops incident
-- naming the event type. An event for a concern would tell operations that, when and by whom one was raised, which is the
-- thing the protected route exists to prevent. Reported to the CMO; the guard assertion below fails if anyone registers it.

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.queue_complete(uuid, jsonb)'::regprocedure) into v_def;
  v_new := replace(v_def,
    '''clinical_task.completed:'' || c.id, t.patient_id, ''clinical_task'', t.id);',
    '''clinical_task.completed:'' || c.id, t.patient_id, ''clinical_task'', t.id);' || chr(10) ||
    '  perform private.emit_domain_event(''clinician.task_completed'', t.organisation_id,' || chr(10) ||
    '    jsonb_build_object(''task_id'', t.id, ''type'', t.type, ''clinician_id'', v_uid, ''priority_class'', t.priority_class),' || chr(10) ||
    '    ''clinician.task_completed:'' || c.id, t.patient_id, ''clinical_task'', t.id);');
  if v_new = v_def or position('clinician.task_completed' in v_new) = 0 then
    raise exception 'queue_complete did not have the expected text to replace';
  end if;
  execute v_new;
end $$;

do $$
begin
  if not exists (select 1 from public.event_types where event_type = 'clinician.task_completed' and is_active) then raise exception 'S76 B5: event type missing'; end if;
  if position('clinical_task.completed' in pg_get_functiondef('public.queue_complete(uuid, jsonb)'::regprocedure)) = 0 then raise exception 'S76 B5: the old event was lost'; end if;
  if has_function_privilege('anon', 'public.queue_complete(uuid, jsonb)', 'EXECUTE') then raise exception 'S76 B5: anon can complete tasks'; end if;
  if exists (select 1 from public.event_types where event_type like 'safety_concern.%') then raise exception 'S76 B5: a safety concern event type must not be registered (S20 protection)'; end if;
end $$;
