-- S11c: the server side of the CMO decisions of 2026-10-05 (see 20261005233912_s11c_bp_rule_set_v2_cmo_decisions.sql).
--  * triage_context_for_observation: finds the previous reading inside the longest recheck window of the grading rule set
--    (the engine decides what counts as a repeat), says the symptom question is answered (the phone's form asked it),
--    and passes postpartum (a delivery in postnatal_profiles within the last 42 Lagos days).
--  * record_triage_result: tolerates the new status symptom_check_required (nothing to store). A recheck_required result
--    already takes its due time and window from the result, so the 2 hour recheck needs no change here.
-- Backward compatible with rule set version 1 and the engine as it was.
create or replace function public.triage_context_for_observation(p_observation_id uuid, p_recheck text default null, p_window_minutes integer default 15)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_prof public.profiles%rowtype;
  v_target record;
  v_prev record;
  v_recheck jsonb := null;
  v_symptoms jsonb;
  v_history jsonb;
  v_open jsonb;
  v_window integer;
begin
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found or v.vital_type::text <> 'blood_pressure' or v.systolic is null or v.diastolic is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_prof from public.profiles where id = v.patient_id;
  -- The longest wait either recheck can have, read from the rule set that will grade (the engine itself decides which
  -- previous reading counts as a repeat), so a 2 hour recheck after 200/130 is found as well as a 5 minute one.
  select coalesce(greatest((rs.rules #>> '{params,recheck,windowMinutes}')::int, (rs.rules #>> '{params,extremeRecheck,windowMinutes}')::int), p_window_minutes)
    into v_window
  from public.triage_rule_sets rs
  where rs.code = 'bp_care_triage' and rs.status in ('approved', 'draft')
  order by (rs.status = 'approved') desc, rs.version desc limit 1;
  v_window := coalesce(v_window, p_window_minutes);
  select * into v_target from private.patient_home_bp_target(v.patient_id);

  select coalesce(jsonb_agg(distinct s.symptom_type::text), '[]'::jsonb) into v_symptoms
  from public.symptoms s
  where s.patient_id = v.patient_id
    and s.symptom_type::text in ('severe_headache', 'chest_pain', 'breathlessness', 'weakness_or_numbness',
          'difficulty_speaking', 'back_pain', 'epigastric_pain', 'confusion', 'visual_disturbance', 'fainting',
          'dizziness', 'palpitations')
    and s.created_at between v.created_at - interval '10 minutes' and v.created_at + interval '10 minutes';

  select coalesce(jsonb_agg(jsonb_build_object('systolic', h.systolic, 'diastolic', h.diastolic, 'takenAt', h.taken_at)
                            order by h.taken_at desc), '[]'::jsonb) into v_history
  from public.vitals_readings h
  where h.patient_id = v.patient_id and h.vital_type::text = 'blood_pressure' and h.id <> v.id
    and h.systolic is not null and h.diastolic is not null
    and h.taken_at between v.taken_at - interval '14 days' and v.taken_at;

  if p_recheck = 'timed_out' then
    v_recheck := jsonb_build_object('kind', 'timed_out');
  else
    select h.systolic, h.diastolic, h.taken_at into v_prev
    from public.triage_pending_rechecks p
    join public.vitals_readings h on h.id = p.observation_id
    where p.patient_id = v.patient_id and p.state = 'pending' and p.observation_id <> v.id
      and h.taken_at <= v.taken_at and h.taken_at >= v.taken_at - make_interval(mins => v_window)
    order by h.taken_at desc limit 1;
    if found then
      v_recheck := jsonb_build_object('kind', 'repeat',
        'previous', jsonb_build_object('systolic', v_prev.systolic, 'diastolic', v_prev.diastolic, 'takenAt', v_prev.taken_at),
        'minutesSincePrevious', round(extract(epoch from (v.taken_at - v_prev.taken_at)) / 60.0, 2));
    end if;
  end if;

  select coalesce(jsonb_agg(c.task_key), '[]'::jsonb) into v_open
  from (select distinct e.task_key from public.triage_events e
        where e.patient_id = v.patient_id and e.task_key is not null and not e.shadow
          and e.created_at > now() - interval '30 days') c;

  return jsonb_build_object(
    'found', true,
    'organisationId', v.organisation_id,
    'patientId', v.patient_id,
    'isTest', coalesce(v_prof.is_test, false),
    'observationId', v.id,
    'basis', md5(coalesce((select string_agg(s2, ',' order by s2) from jsonb_array_elements_text(v_symptoms) s2), '') || '|' || coalesce(v_recheck ->> 'kind', '')),
    'input', jsonb_strip_nulls(jsonb_build_object(
      'trigger', jsonb_strip_nulls(jsonb_build_object(
        'type', 'observation',
        'reading', jsonb_build_object('systolic', v.systolic, 'diastolic', v.diastolic, 'takenAt', v.taken_at),
        'symptoms', v_symptoms,
        -- The server cannot ask a question; the phone's form already did, so a reading here is answered.
        'symptomsAnswered', true,
        'recheck', v_recheck)),
      'history', v_history,
      'target', jsonb_build_object('systolic', v_target.systolic, 'diastolic', v_target.diastolic),
      'pathway', jsonb_build_object('state', 'self_guided'),
      'postpartum', exists (select 1 from public.postnatal_profiles pn where pn.patient_id = v.patient_id
                            and pn.delivery_date <= (v.taken_at at time zone 'Africa/Lagos')::date
                            and pn.delivery_date > (v.taken_at at time zone 'Africa/Lagos')::date - 42),
      'pregnant', coalesce((select pp.is_pregnant from public.patient_pregnancy pp where pp.patient_id = v.patient_id limit 1), false),
      'ageYears', case when v_prof.date_of_birth is null then null else extract(year from age(v.taken_at, v_prof.date_of_birth))::int end,
      'now', now(),
      'existingOpenTaskKeys', v_open)));
end $$;

create or replace function public.record_triage_result(
  p_observation_id uuid,
  p_result jsonb,
  p_rule_set_id uuid,
  p_causation_id uuid default null,
  p_basis text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_rs public.triage_rule_sets%rowtype;
  v_status text := p_result ->> 'status';
  v_grade text := p_result ->> 'grade';
  v_shadow boolean;
  v_id uuid;
  v_created boolean := false;
  v_is_test boolean;
  v_actions jsonb := coalesce(p_result -> 'actions', '[]'::jsonb);
  v_after integer;
  v_window integer;
begin
  if v_status not in ('graded', 'recheck_required', 'symptom_check_required', 'rejected') then
    raise exception 'record_triage_result: unknown status %', v_status using errcode = '22023';
  end if;
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found then
    raise exception 'record_triage_result: observation % not found', p_observation_id using errcode = '22023';
  end if;
  select * into v_rs from public.triage_rule_sets where id = p_rule_set_id;
  if not found then
    raise exception 'record_triage_result: rule set % not found', p_rule_set_id using errcode = '22023';
  end if;
  if p_result #>> '{ruleSet,code}' is distinct from v_rs.code or (p_result #>> '{ruleSet,version}')::int is distinct from v_rs.version then
    raise exception 'record_triage_result: result was graded with a different rule set than the one named' using errcode = '22023';
  end if;
  select coalesce(is_test, false) into v_is_test from public.profiles where id = v.patient_id;
  v_shadow := v_rs.status <> 'approved';

  -- Not graded and nothing to store: a rejected reading, or a symptom question only the phone can ask.
  if v_status in ('rejected', 'symptom_check_required') then
    return jsonb_build_object('status', v_status, 'created', false);
  end if;

  if v_status = 'recheck_required' then
    v_after := coalesce((p_result #>> '{recheck,afterMinutes}')::int, 5);
    v_window := coalesce((p_result #>> '{recheck,windowMinutes}')::int, 15);
    update public.triage_pending_rechecks set state = 'superseded'
      where patient_id = v.patient_id and state = 'pending' and observation_id <> v.id;
    insert into public.triage_pending_rechecks (observation_id, organisation_id, patient_id, due_at)
      values (v.id, v.organisation_id, v.patient_id, v.taken_at + make_interval(mins => v_window))
      on conflict (observation_id) do nothing;
    if not exists (select 1 from public.care_tasks t where t.patient_id = v.patient_id and t.source = 'triage_recheck'
                   and t.status in ('not_started', 'scheduled', 'in_progress')) then
      insert into public.care_tasks (organisation_id, patient_id, title, owner_role, priority, due_at, source, kind, source_event_id)
        values (v.organisation_id, v.patient_id, '', 'patient', 1, v.taken_at + make_interval(mins => v_after), 'triage_recheck', 'log_bp', p_causation_id);
    end if;
    return jsonb_build_object('status', 'recheck_required', 'created', true);
  end if;

  if v_grade not in ('green', 'amber', 'red') then
    raise exception 'record_triage_result: a graded result needs a grade' using errcode = '22023';
  end if;

  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id,
      rule_set_code, rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test)
    values (v.organisation_id, v.patient_id, 'observation', v.id, v_grade, p_result ->> 'ruleId', v_rs.id,
      v_rs.code, v_rs.version, v_rs.status, p_result ->> 'explanationKey', v_actions,
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_result -> 'matchedRuleIds', '[]'::jsonb)) x), '{}'),
      p_result ->> 'taskKey', coalesce(p_basis, ''), v_shadow, coalesce(v_is_test, false))
    on conflict (trigger_type, trigger_id, rule_set_id, basis) do nothing
    returning id into v_id;
  v_created := v_id is not null;
  if not v_created then
    select id into v_id from public.triage_events
      where trigger_type = 'observation' and trigger_id = v.id and rule_set_id = v_rs.id and basis = coalesce(p_basis, '');
  end if;

  if v_created then
    update public.vitals_readings set triage_event_id = v_id where id = v.id and triage_event_id is null;
    -- Only readings taken no later than this one are settled by it: a late or regraded older reading must not
    -- close the wait on a newer first elevated reading.
    update public.triage_pending_rechecks p set state = case when p.observation_id = v.id then 'timed_out' else 'resolved' end
      where p.patient_id = v.patient_id and p.state = 'pending'
        and exists (select 1 from public.vitals_readings h where h.id = p.observation_id and h.taken_at <= v.taken_at);
    update public.care_tasks set status = 'completed'
      where patient_id = v.patient_id and source = 'triage_recheck' and status in ('not_started', 'scheduled', 'in_progress')
        and not exists (select 1 from public.triage_pending_rechecks p where p.patient_id = v.patient_id and p.state = 'pending');
    perform private.emit_domain_event(
      'triage.graded', v.organisation_id,
      jsonb_build_object('grade', v_grade, 'triage_event_id', v_id, 'observation_id', v.id,
        'rule_id', p_result ->> 'ruleId', 'rule_set_status', v_rs.status, 'shadow', v_shadow,
        'explanation_key', p_result ->> 'explanationKey', 'task_key', p_result ->> 'taskKey', 'actions', v_actions),
      'triage:' || v_id::text, v.patient_id, 'triage_event', v_id,
      case when v_grade = 'red' then 'urgent' else 'normal' end, null, p_causation_id);
  end if;
  return jsonb_build_object('status', 'graded', 'created', v_created, 'triage_event_id', v_id, 'shadow', v_shadow);
end $$;

