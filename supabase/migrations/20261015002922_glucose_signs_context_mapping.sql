-- Glucose warning signs stored on the server, last part: map every sign the phone ticks onto the symptom log, so the server can grade it.
--
-- The nine signs the glucose entry offers (the engine's GLUCOSE_SYMPTOMS) and the symptom_type each is stored as:
--   confusion -> confusion            seizure -> convulsion              unconscious -> loss_of_consciousness
--   cannot_swallow -> cannot_swallow  vomiting -> vomiting               abdominal_pain -> abdominal_pain
--   fast_breathing -> breathlessness  drowsiness -> lethargy             very_thirsty_cannot_keep_fluids -> dehydration_signs
-- Before this only the last three plus confusion were mapped, so GL-R2, GL-R3, GL-R5 (vomiting, stomach pain) and GL-R7 could not fire on the server
-- from a phone entry. cannot_swallow, vomiting and abdominal_pain are the three values added by the three files before this one
-- (convulsion and loss_of_consciousness already existed from the pregnancy work).
--
-- Two functions are rewritten, each starting from its LIVE definition (pg_get_functiondef, 2026-10-15), changing only the symptom list:
--   private.emit_glucose_symptom_regrade  (a sign arriving just after its reading re-grades that reading)
--   public.triage_context_for_glucose_observation  (the symptom mapping inside the context)
-- NOT touched: private.handle_symptom_red_flag. It pages on severity (5 or more), not on the type, and the phone stores a glucose-form tick at
-- severity 4 (config glucose.symptom_checklist), so a tick written by this path never pages through the older symptom trigger; the governed
-- engine is the one place a glucose sign can page. No threshold, rule or wording changes.
create or replace function private.emit_glucose_symptom_regrade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_obs public.vitals_readings%rowtype;
begin
  if new.symptom_type::text not in ('confusion', 'convulsion', 'loss_of_consciousness', 'cannot_swallow', 'vomiting', 'abdominal_pain',
                                    'breathlessness', 'lethargy', 'dehydration_signs') then
    return null;
  end if;
  begin
    select * into v_obs from private.vitals_readings_current v
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
  select * into v from private.vitals_readings_current where id = p_observation_id;
  -- A reading marked entered in error, cancelled or superseded is not graded (S05b: reads do not hide those rows, each reader filters them).
  if not found or v.vital_type::text <> 'glucose' or v.glucose_mmol_l is null or v.correction_status is not null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_prof from public.profiles where id = v.patient_id;

  v_blood := v.ketones_mmol_l;
  v_urine := v.ketone_urine;
  if v_blood is null and v_urine is null then
    select k.ketones_mmol_l, k.ketone_urine into v_k
    from private.vitals_readings_current k
    where k.patient_id = v.patient_id and k.vital_type::text = 'ketones' and k.id <> v.id and k.correction_status is null
      and k.taken_at between v.taken_at - interval '30 minutes' and v.taken_at + interval '30 minutes'
    order by abs(extract(epoch from (k.taken_at - v.taken_at))) limit 1;
    if found then v_blood := v_k.ketones_mmol_l; v_urine := v_k.ketone_urine; end if;
  end if;
  if v_blood is not null then v_ketones := v_ketones || jsonb_build_object('bloodMmol', v_blood); end if;
  if v_urine in ('negative', 'trace', 'small', 'moderate', 'large') then v_ketones := v_ketones || jsonb_build_object('urine', v_urine); end if;

  -- Every sign the glucose entry offers maps onto a symptom_type (see the header): the engine's code on the right.
  select coalesce(jsonb_agg(distinct m.code), '[]'::jsonb) into v_symptoms
  from public.symptoms s
  join (values ('confusion', 'confusion'), ('convulsion', 'seizure'), ('loss_of_consciousness', 'unconscious'),
               ('cannot_swallow', 'cannot_swallow'), ('vomiting', 'vomiting'), ('abdominal_pain', 'abdominal_pain'),
               ('breathlessness', 'fast_breathing'), ('lethargy', 'drowsiness'),
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

-- Grants are kept by create or replace; assert them anyway (anon inherits execute through PUBLIC).
do $$
begin
  if has_function_privilege('anon', 'public.triage_context_for_glucose_observation(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.triage_context_for_glucose_observation(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.emit_glucose_symptom_regrade()', 'EXECUTE') then
    raise exception 'glucose signs: context or regrade function is executable by a client role';
  end if;
  if (select count(*) from pg_enum where enumtypid = 'public.symptom_type'::regtype
        and enumlabel in ('vomiting', 'abdominal_pain', 'cannot_swallow', 'convulsion', 'loss_of_consciousness')) <> 5 then
    raise exception 'glucose signs: a symptom_type value this mapping needs is missing';
  end if;
  if position('''cannot_swallow''' in pg_get_functiondef('public.triage_context_for_glucose_observation(uuid)'::regprocedure)) = 0 then
    raise exception 'glucose signs: the context function was not updated';
  end if;
end $$;
