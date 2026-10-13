-- R2 (plan item R2): wire glucose readings into the triage engine, in SHADOW. Companion to *_r2_glucose_care_triage_v1_draft.sql.
--
-- Live checked 2026-10-13 on koiplnmbgnqnbywhpjlf before writing this: vitals_readings carries glucose_mmol_l, glucose_context, ketones_mmol_l and
-- ketone_urine; the blood pressure producer (private.emit_bp_observation_recorded), context (public.triage_context_for_observation) and result writer
-- (public.record_triage_result) are live and are NOT touched here; the older glucose pipeline (vitals_readings_glucose_emergency_backstop ->
-- private.handle_glucose_emergency_backstop) is live and is NOT touched here either. Both run until parity is shown (CMO Q1 applied to glucose).
--
-- What this adds, all new objects (no live function is rewritten):
--  1. private.emit_glucose_observation_recorded + a trigger on glucose readings: one observation.recorded event per reading, with payload kind 'glucose',
--     ids only (INV-07), idempotency key glu:<reading id>. The existing subscriber triage.grade_observation picks it up; process-events routes on kind.
--  2. public.triage_context_for_glucose_observation (service role): the reading, its context, ketones (on the reading, else a ketone reading within
--     30 minutes), symptoms logged within 10 minutes mapped onto the engine's symptom codes, diabetes type, pregnancy and age.
--  3. public.record_glucose_triage_result (service role): the graded half of record_triage_result for glucose. It has no recheck handling on purpose:
--     record_triage_result resolves the patient's pending BLOOD PRESSURE rechecks and closes their repeat-reading task, and a glucose reading must never do that.
--  4. A symptom regrade, as blood pressure has: a confusion, breathlessness, lethargy or dehydration symptom that reaches the server just AFTER a glucose reading
--     (an offline phone syncs in either order) re-emits that reading with the symptom id, and because the symptoms are part of the basis the regrade is a new result.
--     The same for a KETONE reading that arrives just after a glucose reading (the web form logs ketones as a separate reading): the glucose reading is re-emitted with
--     the ketone id, and because the ketones are part of the basis the regrade is a new result.
--  5. A sweep every 10 minutes (minute 7, staggered, not per minute: the production connection budget is tight) that re-emits any glucose reading
--     from the last 24 hours that never got its event, so a failed emit is never silent.
--
-- WHICH READINGS: manual and device (Bluetooth meter) glucose only. A continuous monitor or a wearable streams a reading every few minutes (hundreds a day per patient) and
-- syncs old readings in bulk; each would cost an event, a context read and a result on a tight production connection budget, and a stale low in a bulk sync could page once
-- signed. Those sources stay on the older pipeline in this version (open question for the CMO, recorded in the closeout). A reading that has been superseded or marked
-- entered in error (correction_status not null) is never graded, and a retracted ketone is never used.
--
-- SHADOW: while glucose_care_triage is a draft every triage_events row and triage.graded event carries shadow = true; the task and paging subscribers
-- ignore shadow events in the handler AND in the database function (create_tasks_from_triage_event, create_red_page). Nothing new pages or opens a task.
-- Two-tier: once approved, a Free patient's red/amber is handled by the existing downstream functions (record_free_red_event, open_free_notice); this
-- file adds no plan logic of its own.

-- 1. Producer ----------------------------------------------------------------------------------------------------------------------------
create or replace function private.emit_glucose_observation_recorded()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vital_type::text = 'glucose' and new.glucose_mmol_l is not null and new.source::text in ('manual', 'device') and new.correction_status is null then
    begin
      perform private.emit_domain_event(
        'observation.recorded', new.organisation_id,
        jsonb_build_object('observation_id', new.id, 'kind', 'glucose'),
        'glu:' || new.id::text,
        new.patient_id, 'observation', new.id);
    exception when others then
      -- A reading is never refused because the bus is unhappy. Not silent: the warning is logged and the sweep below re-emits it.
      raise warning 'R2: could not emit observation.recorded for glucose reading %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

create trigger vitals_readings_emit_glucose_observation
  after insert on public.vitals_readings
  for each row when (new.vital_type = 'glucose'::public.vital_type and new.source in ('manual'::public.vital_source, 'device'::public.vital_source))
  execute function private.emit_glucose_observation_recorded();

-- 1b. Symptom regrade ---------------------------------------------------------------------------------------------------------------------
create or replace function private.emit_glucose_symptom_regrade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_obs public.vitals_readings%rowtype;
begin
  if new.symptom_type::text not in ('confusion', 'breathlessness', 'lethargy', 'dehydration_signs') then
    return null;
  end if;
  begin
    select * into v_obs from public.vitals_readings v
    where v.patient_id = new.patient_id and v.vital_type::text = 'glucose' and v.glucose_mmol_l is not null
      and v.source::text in ('manual', 'device') and v.correction_status is null
      and v.created_at <= new.created_at and v.created_at >= new.created_at - interval '10 minutes'
    order by v.created_at desc, v.taken_at desc limit 1;
    if found then
      perform private.emit_domain_event(
        'observation.recorded', v_obs.organisation_id,
        jsonb_build_object('observation_id', v_obs.id, 'kind', 'glucose', 'symptom_id', new.id),
        'glu:' || v_obs.id::text || ':sym:' || new.id::text,
        v_obs.patient_id, 'observation', v_obs.id);
    end if;
  exception when others then
    raise warning 'R2: could not emit a glucose symptom regrade for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger symptoms_emit_glucose_regrade
  after insert on public.symptoms
  for each row execute function private.emit_glucose_symptom_regrade();

create or replace function private.emit_glucose_ketone_regrade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_obs public.vitals_readings%rowtype;
begin
  if new.vital_type::text <> 'ketones' or new.correction_status is not null or (new.ketones_mmol_l is null and new.ketone_urine is null) then
    return null;
  end if;
  begin
    select * into v_obs from public.vitals_readings v
    where v.patient_id = new.patient_id and v.vital_type::text = 'glucose' and v.glucose_mmol_l is not null and v.id <> new.id
      and v.source::text in ('manual', 'device') and v.correction_status is null
      and v.taken_at between new.taken_at - interval '30 minutes' and new.taken_at + interval '30 minutes'
      and v.created_at <= new.created_at
    order by abs(extract(epoch from (v.taken_at - new.taken_at))) limit 1;
    if found then
      perform private.emit_domain_event(
        'observation.recorded', v_obs.organisation_id,
        jsonb_build_object('observation_id', v_obs.id, 'kind', 'glucose', 'ketone_id', new.id),
        'glu:' || v_obs.id::text || ':ket:' || new.id::text,
        v_obs.patient_id, 'observation', v_obs.id);
    end if;
  exception when others then
    raise warning 'R2: could not emit a glucose ketone regrade for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger vitals_readings_emit_glucose_ketone_regrade
  after insert on public.vitals_readings
  for each row when (new.vital_type = 'ketones'::public.vital_type)
  execute function private.emit_glucose_ketone_regrade();

-- 2. Context -----------------------------------------------------------------------------------------------------------------------------
create or replace function public.triage_context_for_glucose_observation(p_observation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_prof public.profiles%rowtype;
  v_k record;
  v_symptoms jsonb;
  v_open jsonb;
  v_blood numeric;
  v_urine text;
  v_type text;
  v_ketones jsonb := '{}'::jsonb;
begin
  select * into v from public.vitals_readings where id = p_observation_id;
  -- A reading marked entered in error, cancelled or superseded is not graded (S05b: reads do not hide those rows, each reader filters them).
  if not found or v.vital_type::text <> 'glucose' or v.glucose_mmol_l is null or v.correction_status is not null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_prof from public.profiles where id = v.patient_id;

  v_blood := v.ketones_mmol_l;
  v_urine := v.ketone_urine;
  if v_blood is null and v_urine is null then
    select k.ketones_mmol_l, k.ketone_urine into v_k
    from public.vitals_readings k
    where k.patient_id = v.patient_id and k.vital_type::text = 'ketones' and k.id <> v.id and k.correction_status is null
      and k.taken_at between v.taken_at - interval '30 minutes' and v.taken_at + interval '30 minutes'
    order by abs(extract(epoch from (k.taken_at - v.taken_at))) limit 1;
    if found then v_blood := v_k.ketones_mmol_l; v_urine := v_k.ketone_urine; end if;
  end if;
  if v_blood is not null then v_ketones := v_ketones || jsonb_build_object('bloodMmol', v_blood); end if;
  if v_urine in ('negative', 'trace', 'small', 'moderate', 'large') then v_ketones := v_ketones || jsonb_build_object('urine', v_urine); end if;

  -- The server's symptom log has no seizure, unconscious, cannot swallow, vomiting or abdominal pain entry yet (the phone asks for them at entry), so only
  -- the symptoms it does have are mapped: confusion, breathlessness (fast breathing), lethargy (drowsiness), dehydration signs (very thirsty, not keeping fluids).
  select coalesce(jsonb_agg(distinct m.code), '[]'::jsonb) into v_symptoms
  from public.symptoms s
  join (values ('confusion', 'confusion'), ('breathlessness', 'fast_breathing'), ('lethargy', 'drowsiness'),
               ('dehydration_signs', 'very_thirsty_cannot_keep_fluids')) as m(symptom, code) on m.symptom = s.symptom_type::text
  where s.patient_id = v.patient_id
    and s.created_at between v.created_at - interval '10 minutes' and v.created_at + interval '10 minutes';

  select coalesce(d.confirmed_type, d.patient_reported_type)::text into v_type from public.patient_diabetes_profile d where d.patient_id = v.patient_id;

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
    'basis', md5(coalesce((select string_agg(s2, ',' order by s2) from jsonb_array_elements_text(v_symptoms) s2), '') || '|' || coalesce(v_blood::text, '') || '|' || coalesce(v_urine, '')),
    'input', jsonb_strip_nulls(jsonb_build_object(
      'trigger', jsonb_build_object(
        'type', 'glucose',
        'reading', jsonb_build_object('mmol', v.glucose_mmol_l, 'takenAt', v.taken_at, 'context', coalesce(v.glucose_context::text, 'random')),
        'ketones', v_ketones,
        'symptoms', v_symptoms),
      'diabetesType', v_type,
      'pregnant', coalesce((select pp.is_pregnant from public.patient_pregnancy pp where pp.patient_id = v.patient_id limit 1), false),
      'ageYears', case when v_prof.date_of_birth is null then null else extract(year from age(v.taken_at, v_prof.date_of_birth))::int end,
      'now', now(),
      'existingOpenTaskKeys', v_open)));
end $$;

-- 3. Result writer -----------------------------------------------------------------------------------------------------------------------
create or replace function public.record_glucose_triage_result(
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
begin
  if v_status not in ('graded', 'rejected') then
    raise exception 'record_glucose_triage_result: unknown status %', v_status using errcode = '22023';
  end if;
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found or v.vital_type::text <> 'glucose' then
    raise exception 'record_glucose_triage_result: glucose reading % not found', p_observation_id using errcode = '22023';
  end if;
  select * into v_rs from public.triage_rule_sets where id = p_rule_set_id;
  if not found or v_rs.code <> 'glucose_care_triage' then
    raise exception 'record_glucose_triage_result: rule set % is not a glucose rule set', p_rule_set_id using errcode = '22023';
  end if;
  if p_result #>> '{ruleSet,code}' is distinct from v_rs.code or (p_result #>> '{ruleSet,version}')::int is distinct from v_rs.version then
    raise exception 'record_glucose_triage_result: result was graded with a different rule set than the one named' using errcode = '22023';
  end if;
  select coalesce(is_test, false) into v_is_test from public.profiles where id = v.patient_id;
  v_shadow := v_rs.status <> 'approved';

  -- A rejected (implausible) reading stores nothing, exactly as for blood pressure.
  if v_status = 'rejected' then
    return jsonb_build_object('status', 'rejected', 'created', false);
  end if;
  if v_grade not in ('green', 'amber', 'red') then
    raise exception 'record_glucose_triage_result: a graded result needs a grade' using errcode = '22023';
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
    -- The reading keeps ONE triage_event_id (the first); a shadow grade of a draft must not displace a link a later approved grade would want, so only an empty link is filled.
    update public.vitals_readings set triage_event_id = v_id where id = v.id and triage_event_id is null;
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

-- 4. Sweep -------------------------------------------------------------------------------------------------------------------------------
create or replace function private.sweep_glucose_observation_events()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select v.id, v.organisation_id, v.patient_id from public.vitals_readings v
    where v.vital_type::text = 'glucose' and v.glucose_mmol_l is not null and v.source::text in ('manual', 'device') and v.correction_status is null
      and v.created_at > now() - interval '24 hours' and v.created_at < now() - interval '1 minute'
      and not exists (select 1 from public.domain_events e
                      where e.event_type = 'observation.recorded' and e.idempotency_key = 'glu:' || v.id::text)
  loop
    -- One reading that cannot be emitted must not stop the readings behind it: it is logged and skipped, and tried again at the next run.
    begin
      perform private.emit_domain_event(
        'observation.recorded', r.organisation_id,
        jsonb_build_object('observation_id', r.id, 'kind', 'glucose'),
        'glu:' || r.id::text, r.patient_id, 'observation', r.id);
      v_n := v_n + 1;
    exception when others then
      raise warning 'R2: sweep could not emit glucose reading %: %', r.id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

select cron.schedule('triage-glucose-sweep', '7-57/10 * * * *', $$select private.sweep_glucose_observation_events()$$);

-- 5. Grants ------------------------------------------------------------------------------------------------------------------------------
revoke all on function private.emit_glucose_observation_recorded() from public, anon, authenticated;
revoke all on function private.emit_glucose_symptom_regrade() from public, anon, authenticated;
revoke all on function private.emit_glucose_ketone_regrade() from public, anon, authenticated;
revoke all on function private.sweep_glucose_observation_events() from public, anon, authenticated;
revoke all on function public.triage_context_for_glucose_observation(uuid) from public, anon, authenticated;
revoke all on function public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.triage_context_for_glucose_observation(uuid) to service_role;
grant execute on function public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_context_for_glucose_observation(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.triage_context_for_glucose_observation(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.sweep_glucose_observation_events()', 'EXECUTE')
     or has_function_privilege('anon', 'private.emit_glucose_observation_recorded()', 'EXECUTE') then
    raise exception 'R2 functions must be service role only';
  end if;
  if not exists (select 1 from cron.job where jobname = 'triage-glucose-sweep') then
    raise exception 'R2 self-check: the glucose sweep is not scheduled';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vitals_readings_emit_glucose_observation' and tgrelid = 'public.vitals_readings'::regclass) then
    raise exception 'R2 self-check: the glucose producer trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'symptoms_emit_glucose_regrade' and tgrelid = 'public.symptoms'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'vitals_readings_emit_glucose_ketone_regrade' and tgrelid = 'public.vitals_readings'::regclass) then
    raise exception 'R2 self-check: a glucose regrade trigger is missing';
  end if;
end $$;
