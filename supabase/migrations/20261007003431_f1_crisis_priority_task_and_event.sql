-- F1 fix 4: a crisis-flagged wellbeing screen now raises a priority clinical task and a crisis.detected event.
--
-- THE GAP. mental_health_screens.crisis_flagged already raises an emergency_events row
-- (private.handle_mental_health_screen_concern, 20260910014008), which drives the older clinician_alerts ladder.
-- It created NO clinical_tasks task, so the crisis never reached the S16/S17 queue the doctors work from, and it
-- emitted NO event on the S10 outbox, so nothing downstream (paging, the console) could react to it.
--
-- WHAT THIS ADDS (no AI anywhere; INV-01):
--   * event type crisis.detected (urgent, version 1, required key screen_id): ids only, never an instrument, score or
--     condition (INV-07). Idempotency key crisis.detected:<screen id>, so a replay emits nothing new.
--   * a class 1 clinical task, using the existing spec type red_event_unacknowledged (priority class 1, senior medical
--     officer, on_call competency, no lead window: INV-05, a crisis never waits for a pull). It is due at once, so the
--     S16 sweep escalates it on its next minute and emits clinical_task.escalated at urgent priority. One live task per
--     patient (dedup key crisis:<patient id>): a second crisis disclosure while one is open merges into it and is counted.
--   * the S19 convention for reaching a person: the clinician on call (primary, else eligible backup) gets the existing
--     neutral on_call_page notice (push, in-app, email, critical; fixed text "A priority case is waiting for you", payload
--     carries no patient, no condition, no reading). When the rota gives nobody, the clinical lead and ops get the neutral
--     on_call_escalation notice and one sev1 incident opens ("nobody on call"), never a silent success.
--   * a failure of any step is audited (crisis_task.error) and opens an incident; it never rolls back the patient's own
--     screen and never undoes the emergency event. A failed run writes no "handled" marker, so a replay retries it.
--   * private.raise_crisis_follow_up(screen_id) is the idempotent core (a replay of a handled screen does nothing),
--     the trigger mental_health_screens_crisis_task calls it, and it can be called for a backfill.
--
-- WHAT IS NOT DONE, AND WHY. A page row in public.pages is not created: pages are keyed to a graded triage event
-- (triage_events needs a rule set, and the crisis route is deterministic with no rule set the CMO has approved), and
-- changing S19's page model is out of scope for a fix-first set. Recorded in OPEN-QUESTIONS (OQ-F1-03): the on-call notice
-- links to the On call page, and a dedicated crisis task type and notice (needs CMO confirmation) is a follow-up.
--
-- COUNTS (not verified live; the dry run records them): mental_health_screens rows with crisis_flagged, and existing
-- crisis tasks (none can exist). No backfill is run: only new crisis screens create tasks.

-- 1. The event type
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('crisis.detected', 'A wellbeing check-in raised a crisis flag; a priority task was created and the clinician on call was told', 'F1', true)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('crisis.detected', 1, array['screen_id'])
on conflict (event_type, version) do nothing;

-- 2. Neutral notice to one person, in the S19 shape (source is the task, not a page)
create or replace function private.crisis_notify(p_recipient uuid, p_org uuid, p_template text, p_task uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array array['push', 'in_app', 'email'] loop
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_recipient, p_org, c::public.notification_channel, p_template, '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'clinical_tasks', p_task);
  end loop;
end;
$$;
revoke all on function private.crisis_notify(uuid, uuid, text, uuid) from public, anon, authenticated;

-- 3. The idempotent core
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

  -- (b) the class 1 task (existing spec type; no lead window, so it never waits for a pull)
  begin
    v_task := private.create_clinical_task(s.patient_id, 'red_event_unacknowledged', null, 'crisis:' || s.patient_id, null, null, v_event);
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
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (s.organisation_id, 'crisis_task.error', 'mental_health_screen', s.id, jsonb_build_object('step', 'notify', 'error', sqlerrm));
    perform private.page_incident(s.organisation_id, 'crisis_follow_up_failed:' || s.id, 'A priority follow-up could not be completed',
      'A priority wellbeing follow-up step failed; see audit_log action crisis_task.error. The emergency event itself was still raised.');
  end;
  if not v_failed then
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

-- 4. The trigger (after the emergency-event trigger by name order)
create or replace function private.handle_mental_health_crisis()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.raise_crisis_follow_up(new.id);
  return new;
exception when others then
  -- never undo the patient's own screen or the emergency event; make the failure loud instead. The reporting itself is
  -- last-resort protected: if even the audit row or the incident cannot be written, the screen still saves (a warning is logged).
  begin
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'crisis_task.error', 'mental_health_screen', new.id, jsonb_build_object('step', 'trigger', 'error', sqlerrm));
    perform private.page_incident(new.organisation_id, 'crisis_follow_up_failed:' || new.id, 'A priority follow-up could not be completed',
      'A priority wellbeing follow-up step failed; see audit_log action crisis_task.error. The emergency event itself was still raised.');
  exception when others then
    raise warning 'crisis follow-up could not even be reported for screen %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function private.handle_mental_health_crisis() from public, anon, authenticated;

drop trigger if exists mental_health_screens_crisis_task on public.mental_health_screens;
create trigger mental_health_screens_crisis_task
  after insert on public.mental_health_screens
  for each row when (new.crisis_flagged)
  execute function private.handle_mental_health_crisis();

-- 5. Self-check
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.mental_health_screens'::regclass and tgname = 'mental_health_screens_crisis_task') then
    raise exception 'FAIL: the crisis task trigger is missing';
  end if;
  if not exists (select 1 from public.event_types where event_type = 'crisis.detected' and is_urgent) then
    raise exception 'FAIL: crisis.detected is not registered as urgent';
  end if;
  if not exists (select 1 from public.task_types where code = 'red_event_unacknowledged' and is_active and priority_class = 1 and lead_window_minutes = 0) then
    raise exception 'FAIL: the class 1 task type this relies on is missing or has a lead window';
  end if;
  if has_function_privilege('anon', 'private.raise_crisis_follow_up(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.raise_crisis_follow_up(uuid)', 'EXECUTE') then
    raise exception 'FAIL: raise_crisis_follow_up is callable by anon or authenticated';
  end if;
end $$;
