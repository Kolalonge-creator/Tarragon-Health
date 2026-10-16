-- Single-reading dangerous vitals (pulse, SpO2, temperature): wire the readings into the triage engine, in SHADOW. Companion to
-- *_build_vitals_care_triage_v1_draft.sql and a twin of the glucose wiring (*_r2_glucose_triage_wiring.sql).
--
-- Live checked 2026-10-16 on koiplnmbgnqnbywhpjlf before writing this: vitals_readings carries pulse_bpm, spo2_pct and temperature_c; the older
-- per-vital triggers (vitals_readings_pulse_red_flag, vitals_readings_spo2_red_flag, vitals_readings_temperature_red_flag) are live and are NOT touched here;
-- the blood pressure producer (private.emit_bp_observation_recorded), the glucose producer and result writer, and public.triage_rule_set_for_grading are live
-- and are NOT touched here either. The older triggers and this engine run side by side until parity is shown (CMO Q1 applied to these vitals).
--
-- What this adds, all new objects (no live function is rewritten):
--  1. private.emit_vitals_observation_recorded + a trigger on pulse, SpO2 and temperature readings: one observation.recorded event per reading, with payload
--     kind 'vitals', ids only (INV-07), idempotency key vit:<reading id>. The existing subscriber triage.grade_observation picks it up; process-events routes
--     on kind. The event is URGENT when the older classifier calls the reading anything but green (or cannot classify it), so a dangerous reading is not
--     queued behind ordinary ones (the blood pressure producer does the same).
--  2. public.triage_context_for_vitals_observation (service role): the reading, the patient's age and the patient's own clinician-set amber line.
--  3. public.record_vitals_triage_result (service role): the graded half of record_triage_result for these vitals. It has no recheck handling on purpose:
--     record_triage_result resolves the patient's pending BLOOD PRESSURE rechecks, and a heart rate must never do that.
--  4. A sweep every 10 minutes (minute 9, staggered: the production connection budget is tight) that re-emits any reading from the last 24 hours that never
--     got its event, with the same urgent-or-normal priority as the producer, so a failed emit is never silent and a dangerous reading is not queued behind ordinary ones.
--
-- WHICH READINGS: manual, device (Bluetooth) and photo-confirmed readings (a value the patient confirmed from a photo of the device) only. A wearable streams a heart rate every few minutes (hundreds a day per patient) and syncs old
-- readings in bulk; each would cost an event, a context read and a result on a tight production connection budget, and a stale value in a bulk sync could
-- page once signed. Those stay on the older triggers in this version (open question for the CMO in the closeout). A reading marked entered in error or
-- superseded (correction_status not null) is never graded.
--
-- SHADOW: while vitals_care_triage is a draft every triage_events row and triage.graded event carries shadow = true; the task and paging subscribers ignore
-- shadow events in the handler AND in the database function (create_tasks_from_triage_event, create_red_page). Nothing new pages or opens a task.
-- Two-tier: once approved, a Free patient's red/amber is handled by the existing downstream functions (record_free_red_event, open_free_notice); this file adds
-- no plan logic of its own.

-- 1. Producer ----------------------------------------------------------------------------------------------------------------------------
create or replace function private.emit_vitals_observation_recorded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_level text;
begin
  if new.correction_status is not null or new.source::text not in ('manual', 'device', 'photo_confirmed') then
    return null;
  end if;
  v_level := case new.vital_type::text
    when 'pulse' then private.classify_pulse_level(new.pulse_bpm)
    when 'spo2' then private.classify_spo2_level(new.spo2_pct)
    when 'temperature' then private.classify_temperature_level(new.temperature_c)
    else null end;
  -- A row of one of these types with no value in its own column has nothing to grade.
  if v_level is null or v_level = 'unknown' then
    return null;
  end if;
  begin
    perform private.emit_domain_event(
      'observation.recorded', new.organisation_id,
      jsonb_build_object('observation_id', new.id, 'kind', 'vitals'),
      'vit:' || new.id::text,
      new.patient_id, 'observation', new.id,
      case when v_level = 'green' then 'normal' else 'urgent' end);
  exception when others then
    -- A reading is never refused because the bus is unhappy. Not silent: the warning is logged and the sweep below re-emits it.
    raise warning 'vitals triage: could not emit observation.recorded for reading %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create trigger vitals_readings_emit_vitals_observation
  after insert on public.vitals_readings
  for each row when (new.vital_type in ('pulse'::public.vital_type, 'spo2'::public.vital_type, 'temperature'::public.vital_type)
                     and new.source in ('manual'::public.vital_source, 'device'::public.vital_source, 'photo_confirmed'::public.vital_source))
  execute function private.emit_vitals_observation_recorded();

-- 2. Context -----------------------------------------------------------------------------------------------------------------------------
create or replace function public.triage_context_for_vitals_observation(p_observation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.vitals_readings%rowtype;
  v_prof public.profiles%rowtype;
  v_type text;
  v_value numeric;
  v_personal numeric;
  v_open jsonb;
begin
  select * into v from private.vitals_readings_current where id = p_observation_id;
  -- A reading marked entered in error, cancelled or superseded is not graded (S05b: reads do not hide those rows, each reader filters them).
  if not found or v.correction_status is not null then
    return jsonb_build_object('found', false);
  end if;
  v_type := v.vital_type::text;
  v_value := case v_type when 'pulse' then v.pulse_bpm when 'spo2' then v.spo2_pct when 'temperature' then v.temperature_c else null end;
  if v_type not in ('pulse', 'spo2', 'temperature') or v_value is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_prof from public.profiles where id = v.patient_id;

  -- The patient's own clinician-set amber line; it can only turn a green reading amber (the engine's VT-OX4 and VT-TE4).
  if v_type = 'spo2' then
    select t.amber_threshold_pct into v_personal from public.patient_spo2_targets t where t.patient_id = v.patient_id;
  elsif v_type = 'temperature' then
    select t.amber_threshold_c into v_personal from public.patient_temperature_targets t where t.patient_id = v.patient_id;
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
    -- Nothing but the reading itself decides the grade, so a redelivery is the same result.
    'basis', '',
    'input', jsonb_strip_nulls(jsonb_build_object(
      'trigger', jsonb_build_object('type', v_type, 'reading', jsonb_build_object('value', v_value, 'takenAt', v.taken_at)),
      'ageYears', case when v_prof.date_of_birth is null then null else extract(year from age(v.taken_at, v_prof.date_of_birth))::int end,
      'personalAmberLine', v_personal,
      'now', now(),
      'existingOpenTaskKeys', v_open)));
end $$;

-- 3. Result writer -----------------------------------------------------------------------------------------------------------------------
create or replace function public.record_vitals_triage_result(
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
    raise exception 'record_vitals_triage_result: unknown status %', v_status using errcode = '22023';
  end if;
  select * into v from public.vitals_readings where id = p_observation_id;
  if not found or v.vital_type::text not in ('pulse', 'spo2', 'temperature') then
    raise exception 'record_vitals_triage_result: pulse, SpO2 or temperature reading % not found', p_observation_id using errcode = '22023';
  end if;
  select * into v_rs from public.triage_rule_sets where id = p_rule_set_id;
  if not found or v_rs.code <> 'vitals_care_triage' then
    raise exception 'record_vitals_triage_result: rule set % is not the vitals rule set', p_rule_set_id using errcode = '22023';
  end if;
  if p_result #>> '{ruleSet,code}' is distinct from v_rs.code or (p_result #>> '{ruleSet,version}')::int is distinct from v_rs.version then
    raise exception 'record_vitals_triage_result: result was graded with a different rule set than the one named' using errcode = '22023';
  end if;
  select coalesce(is_test, false) into v_is_test from public.profiles where id = v.patient_id;
  v_shadow := v_rs.status <> 'approved';

  -- A rejected (impossible value) reading stores nothing, exactly as for blood pressure and glucose.
  if v_status = 'rejected' then
    return jsonb_build_object('status', 'rejected', 'created', false);
  end if;
  if v_grade not in ('green', 'amber', 'red') then
    raise exception 'record_vitals_triage_result: a graded result needs a grade' using errcode = '22023';
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
create or replace function private.sweep_vitals_observation_events()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select v.id, v.organisation_id, v.patient_id,
           case case v.vital_type::text when 'pulse' then private.classify_pulse_level(v.pulse_bpm) when 'spo2' then private.classify_spo2_level(v.spo2_pct) else private.classify_temperature_level(v.temperature_c) end
             when 'green' then 'normal' else 'urgent' end as prio
      from private.vitals_readings_current v
    where v.vital_type::text in ('pulse', 'spo2', 'temperature') and v.source::text in ('manual', 'device', 'photo_confirmed') and v.correction_status is null
      and (case v.vital_type::text when 'pulse' then v.pulse_bpm::numeric when 'spo2' then v.spo2_pct::numeric else v.temperature_c end) is not null
      and v.created_at > now() - interval '24 hours' and v.created_at < now() - interval '1 minute'
      and not exists (select 1 from public.domain_events e
                      where e.event_type = 'observation.recorded' and e.idempotency_key = 'vit:' || v.id::text)
  loop
    -- One reading that cannot be emitted must not stop the readings behind it: it is logged and skipped, and tried again at the next run.
    begin
      perform private.emit_domain_event(
        'observation.recorded', r.organisation_id,
        jsonb_build_object('observation_id', r.id, 'kind', 'vitals'),
        'vit:' || r.id::text, r.patient_id, 'observation', r.id, r.prio);
      v_n := v_n + 1;
    exception when others then
      raise warning 'vitals triage: sweep could not emit reading %: %', r.id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

select cron.schedule('triage-vitals-sweep', '9-59/10 * * * *', $$select private.sweep_vitals_observation_events()$$);

-- 5. Grants ------------------------------------------------------------------------------------------------------------------------------
revoke all on function private.emit_vitals_observation_recorded() from public, anon, authenticated;
revoke all on function private.sweep_vitals_observation_events() from public, anon, authenticated;
revoke all on function public.triage_context_for_vitals_observation(uuid) from public, anon, authenticated;
revoke all on function public.record_vitals_triage_result(uuid, jsonb, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.triage_context_for_vitals_observation(uuid) to service_role;
grant execute on function public.record_vitals_triage_result(uuid, jsonb, uuid, uuid, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.record_vitals_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_vitals_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_context_for_vitals_observation(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.triage_context_for_vitals_observation(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.sweep_vitals_observation_events()', 'EXECUTE')
     or has_function_privilege('anon', 'private.emit_vitals_observation_recorded()', 'EXECUTE') then
    raise exception 'vitals triage functions must be service role only';
  end if;
  if not exists (select 1 from cron.job where jobname = 'triage-vitals-sweep') then
    raise exception 'vitals self-check: the vitals sweep is not scheduled';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vitals_readings_emit_vitals_observation' and tgrelid = 'public.vitals_readings'::regclass) then
    raise exception 'vitals self-check: the vitals producer trigger is missing';
  end if;
end $$;
