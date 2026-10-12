-- Two-tier, founder decisions of 2026-10-12: the Free rule (guidance only, no doctor page, no doctor task, a patient-only Free
-- record with a check-in, and the plain "no doctor was alerted because you are on the Free plan" wording) now also covers:
--   (a) amber triage tasks, (b) heart-failure rapid weight-gain alerts, (c) mental-health crisis follow-up.
-- A Member keeps today's behaviour on all three. Membership that cannot be worked out pages (private.patient_may_page_doctor).
-- NOT changed, by standing rule: abnormal screening result escalation (every plan), the lab critical-result path, and the
-- mental-health SCREEN CONCERN alert (a moderate or high score that is not a crisis; not asked for).
--
-- CRISIS. On Free the patient still gets everything patient-side: the crisis answer already writes an emergency event, which
-- shows the acknowledge-gated hospital screen, notifies the emergency contact and opens the Free record (migration
-- 20261013004008). Only the doctor-facing half (the class 1 task and the on-call page in private.raise_crisis_follow_up) is
-- skipped. That function exists live (migration f1_crisis_priority_task_and_event, 20261007003431) but is not yet in
-- main-dev, so it is patched here only if it exists, from its own live text, and the patch is asserted.
--
-- LIVE COUNTS BEFORE (2026-10-12): 0 free_red_events rows (the table is new), 0 active memberships, heart-failure alerts and
-- crisis follow-ups are untouched for any existing row; no conversion is needed.

-- 1. The Free record learns its kind -------------------------------------------------------------------------------------
alter table public.free_red_events alter column emergency_event_id drop not null;
alter table public.free_red_events add column kind text not null default 'red' check (kind in ('red', 'amber', 'heart_failure'));
alter table public.free_red_events add column source_ref uuid;
alter table public.free_red_events add column guidance_acknowledged_at timestamptz;
alter table public.free_red_events add constraint free_red_events_red_has_emergency check (kind <> 'red' or emergency_event_id is not null);
create unique index free_red_events_kind_source_uq on public.free_red_events (kind, source_ref) where source_ref is not null;

-- 2. Opens a non-emergency Free record (no emergency screen: amber and heart-failure guidance is calm and in the app) -------
create function private.open_free_notice(p_org uuid, p_patient uuid, p_kind text, p_triage uuid, p_source uuid, p_test boolean) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_kind not in ('amber', 'heart_failure') then raise exception 'unknown kind' using errcode = '22023'; end if;
  -- heart failure fires on every weight reading while the gain stands: one open notice per patient for three days
  if p_kind = 'heart_failure' then
    select id into v_id from public.free_red_events where patient_id = p_patient and kind = 'heart_failure' and created_at > now() - interval '3 days' limit 1;
    if found then return v_id; end if;
  end if;
  insert into public.free_red_events (organisation_id, patient_id, kind, triage_event_id, source_ref, is_test, recheck_due_at, checkin_due_at)
  values (p_org, p_patient, p_kind, p_triage, p_source, coalesce(p_test, false),
          now() + make_interval(mins => coalesce(private.free_red_rule('recheck_minutes'), 30)),
          now() + make_interval(mins => coalesce(private.free_red_rule('checkin_minutes'), 360)))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.free_red_events where (p_triage is not null and triage_event_id = p_triage) or (p_source is not null and kind = p_kind and source_ref = p_source) limit 1;
    return v_id;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (p_org, null, 'free_red_event.recorded', 'free_red_events', v_id, jsonb_build_object('doctor_alerted', false, 'kind', p_kind));
  perform private.free_red_notify(p_org, p_patient, 'free_red_guidance', v_id);
  return v_id;
end;
$$;
revoke all on function private.open_free_notice(uuid, uuid, text, uuid, uuid, boolean) from public, anon, authenticated;

-- 3. (a) amber triage tasks ----------------------------------------------------------------------------------------------
create or replace function public.create_tasks_from_triage_event(p_triage_event uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  te public.triage_events%rowtype;
  a jsonb;
  v_type text;
  v_made integer := 0;
  v_due integer;
begin
  select * into te from public.triage_events where id = p_triage_event;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  if te.shadow or te.patient_id is null then return 0; end if;
  -- Two-tier: a Free patient's red or amber event creates no clinical task for a doctor. Red already has its guidance record
  -- (create_red_page); an amber event that asked for a task gets the calm in-app guidance record instead.
  if te.grade in ('red', 'amber') and not private.patient_may_page_doctor(te.patient_id) then
    if te.grade = 'amber' and exists (select 1 from jsonb_array_elements(te.actions) x where x ->> 'kind' = 'create_task') then
      perform private.open_free_notice(te.organisation_id, te.patient_id, 'amber', te.id, null, te.is_test);
    end if;
    return 0;
  end if;
  for a in select x from jsonb_array_elements(te.actions) x where x ->> 'kind' = 'create_task' loop
    select code into v_type from public.task_types where is_active and creatable and source_task_keys @> array[a ->> 'task'];
    if v_type is null then
      raise exception 'no task type answers the triage task key %', a ->> 'task' using errcode = 'P0001';
    end if;
    v_due := nullif(a ->> 'dueMinutes', '')::integer;
    perform private.create_clinical_task(te.patient_id, v_type, v_due,
      'triage:' || te.patient_id || ':' || v_type, te.id, te.rule_set_version, null);
    v_made := v_made + 1;
  end loop;
  return v_made;
end;
$$;

-- 4. (b) heart-failure rapid weight gain ---------------------------------------------------------------------------------
create or replace function private.handle_heart_failure_weight_gain_red_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_earliest_weight numeric;
  v_earliest_taken_at timestamptz;
  v_gain numeric;
  v_existing_id uuid;
  v_title text := 'Heart failure: rapid weight gain';
  v_detail text;
begin
  if new.vital_type <> 'weight' or new.weight_kg is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.chronic_programme_enrolments e
    join public.chronic_condition_programmes p on p.id = e.programme_id
    where e.patient_id = new.patient_id
      and e.status = 'enrolled'
      and p.condition = 'heart_failure'
  ) then
    return new;
  end if;

  -- Oldest weight reading within the trailing 3-day window, compared to this
  -- one. Using the OLDEST available point (not necessarily exactly 3 days
  -- back) is the conservative choice for sparse daily logging.
  select weight_kg, taken_at into v_earliest_weight, v_earliest_taken_at
  from public.vitals_readings
  where patient_id = new.patient_id
    and vital_type = 'weight'
    and taken_at >= new.taken_at - interval '3 days'
    and taken_at < new.taken_at
  order by taken_at asc
  limit 1;

  if v_earliest_weight is null then
    return new;
  end if;

  v_gain := new.weight_kg - v_earliest_weight;
  if v_gain <= 2.0 then
    return new;
  end if;

  -- Two-tier (founder 2026-10-12): a Free patient gets calm in-app guidance and no clinician alert. A Member, or a patient
  -- whose membership cannot be worked out, falls through and is alerted as before.
  if not private.patient_may_page_doctor(new.patient_id) then
    perform private.open_free_notice(new.organisation_id, new.patient_id, 'heart_failure', null, new.id,
      coalesce((select is_test from public.profiles where id = new.patient_id), false));
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (new.organisation_id, new.patient_id, 'heart_failure_weight_gain.raised', 'vitals_readings', new.id,
      jsonb_build_object('gain_kg', round(v_gain, 1), 'earliest_weight_kg', v_earliest_weight, 'latest_weight_kg', new.weight_kg, 'doctor_alerted', false));
    return new;
  end if;

  v_detail := format(
    'Weight rose from %s kg (%s) to %s kg (%s) — a %s kg gain within 3 days. WHO/ESC heart-failure guidance: '
    || 'report gain of more than 2 kg in 3 days as a possible sign of decompensation.',
    v_earliest_weight, to_char(v_earliest_taken_at, 'YYYY-MM-DD HH24:MI'),
    new.weight_kg, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'),
    round(v_gain, 1)
  );

  select id into v_existing_id
  from public.clinician_alerts
  where patient_id = new.patient_id and title = v_title and status = 'open'
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    update public.clinician_alerts
      set detail = v_detail, sla_due_at = now() + interval '4 hours',
          vital_reading_id = new.id, updated_at = now()
    where id = v_existing_id;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at,
       escalation_level, vital_reading_id)
    values (
      new.organisation_id, new.patient_id, 'urgent_escalation', 'open', v_title, v_detail,
      now() + interval '4 hours', 3, new.id
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'heart_failure_weight_gain.raised',
    'vitals_readings', new.id,
    jsonb_build_object('gain_kg', round(v_gain, 1), 'earliest_weight_kg', v_earliest_weight, 'latest_weight_kg', new.weight_kg)
  );

  return new;
end;
$$;

-- 5. (c) crisis follow-up: patched from its own live text, only if it exists ------------------------------------------------
do $$
declare v_def text; v_new text; v_marker text := E'  select coalesce(is_test, false) into v_test from public.profiles where id = s.patient_id;\n';
begin
  if to_regprocedure('private.raise_crisis_follow_up(uuid)') is null then return; end if;
  v_def := pg_get_functiondef('private.raise_crisis_follow_up(uuid)'::regprocedure);
  if position('patient_may_page_doctor' in v_def) > 0 then return; end if;
  if position(v_marker in v_def) = 0 then raise exception 'two-tier: raise_crisis_follow_up changed shape, patch by hand'; end if;
  v_new := replace(v_def, v_marker, v_marker ||
    E'  -- Two-tier (founder 2026-10-12): on Free no clinical task and no page. The patient-side crisis guidance, the emergency\n' ||
    E'  -- event and the Free record already exist (the emergency event is written by the screen itself).\n' ||
    E'  if not private.patient_may_page_doctor(s.patient_id) then\n' ||
    E'    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)\n' ||
    E'      values (s.organisation_id, ''crisis.handled'', ''mental_health_screen'', s.id, jsonb_build_object(''doctor_alerted'', false));\n' ||
    E'    return true;\n' ||
    E'  end if;\n');
  execute v_new;
  if position('patient_may_page_doctor' in pg_get_functiondef('private.raise_crisis_follow_up(uuid)'::regprocedure)) = 0 then
    raise exception 'two-tier: the crisis follow-up patch did not apply';
  end if;
end $$;

-- 6. The patient's calm in-app guidance (amber and heart failure) ---------------------------------------------------------
create function public.my_free_guidance() returns table (id uuid, kind text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select f.id, f.kind, f.created_at from public.free_red_events f
     where f.patient_id = auth.uid() and f.kind <> 'red' and f.guidance_acknowledged_at is null
       and f.created_at > now() - interval '3 days'
     order by f.created_at desc limit 1;
end;
$$;
create function public.acknowledge_free_guidance(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.free_red_events set guidance_acknowledged_at = coalesce(guidance_acknowledged_at, now()) where id = p_id and patient_id = auth.uid();
  if not found then raise exception 'not found' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.my_free_guidance() from public, anon;
revoke all on function public.acknowledge_free_guidance(uuid) from public, anon;
grant execute on function public.my_free_guidance() to authenticated;
grant execute on function public.acknowledge_free_guidance(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_free_guidance()', 'EXECUTE') or has_function_privilege('anon', 'public.acknowledge_free_guidance(uuid)', 'EXECUTE') then
    raise exception 'free guidance RPCs must not be callable by anon';
  end if;
  if has_function_privilege('authenticated', 'private.open_free_notice(uuid,uuid,text,uuid,uuid,boolean)', 'EXECUTE') then raise exception 'open_free_notice must stay private'; end if;
  if position('patient_may_page_doctor' in pg_get_functiondef('private.handle_heart_failure_weight_gain_red_flag()'::regprocedure)) = 0 then raise exception 'heart-failure gate missing'; end if;
  if position('patient_may_page_doctor' in pg_get_functiondef('public.create_tasks_from_triage_event(uuid)'::regprocedure)) = 0 then raise exception 'amber gate missing'; end if;
end $$;
