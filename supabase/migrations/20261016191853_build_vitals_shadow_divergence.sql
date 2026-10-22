-- Parity tooling for the single-reading vitals rule set (CMO Q1 applied to pulse, SpO2 and temperature: the three older triggers keep running beside
-- vitals_care_triage until parity is shown), and a fix to the engine parity report that vitals (and glucose) results would otherwise have corrupted.
--
-- 1. FIX: private.triage_parity_rows (P1/D1, patched by S19d to skip unified rows) took EVERY non-test 'observation' triage result and named the legacy
--    action by looking for a BLOOD PRESSURE emergency or a clinician alert on the same reading id. Once glucose results exist (glucose_care_triage) and vitals
--    results exist (this change), every one of them is a "bp" row with no blood-pressure emergency and so reads as legacy class 'none': the report the CMO uses as
--    evidence for the blood pressure rules (Q1) would show hundreds of false "engine red, legacy none" cases. It now reads only bp_care_triage results. The body is
--    the live function's body (read with pg_get_functiondef) with one asserted replacement; it is patched in place rather than rewritten from a copy.
-- 2. NEW: public.triage_vitals_shadow_divergence / triage_vitals_shadow_disagreements, the vitals twins of the glucose reports, same gating (admin or the active
--    clinical director), aggregates without a patient id, test accounts excluded, ids only in the disagreement list.
--    "Live level" is the older classifier's level for the reading (private.classify_pulse_level, classify_spo2_level, classify_temperature_level, with the patient's own
--    amber line applied to a green SpO2 or temperature exactly as the older triggers do). "Urgent" is the live emergency or red level, and a red engine grade. Classes:
--    both_urgent, neither_urgent, shadow_only_urgent (the engine pages and the older trigger does not), live_only_urgent (the older trigger pages and the engine does
--    not: the dangerous row) and live_urgent_no_shadow (the older trigger pages and the engine produced no result at all: the reading was rejected as an impossible
--    value, or its event never arrived). The aggregate also carries the engine grade against the live level, so an amber that the older trigger calls green (or
--    the reverse) is visible, not only the urgent classes. by_design marks the one expected disagreement: a heart rate outside the adult range in a patient under 18
--    is routed to a clinician (amber, rule VT-PU3) where the older trigger pages.
--    LIMITS, stated on the functions: manual, Bluetooth and photo-confirmed readings only (wearable readings are not graded by the engine in v1); the report keeps working after the rule set is signed (it reads the engine's results whether shadow or not), because it is needed until the older triggers are retired; the older triggers merge repeat
--    readings into an open alert and de-duplicate emergencies over six hours, so the report compares the reading's level, not whether a page was actually sent.

do $$
declare
  v_def text := pg_get_functiondef('private.triage_parity_rows(integer)'::regprocedure);
  v_old constant text := 'te.rule_set_code is distinct from ''unified_red_paging''';
  v_new constant text := 'te.rule_set_code = ''bp_care_triage'' and te.rule_set_code is distinct from ''unified_red_paging''';
begin
  if v_def not like '%' || v_old || '%' then
    raise exception 'vitals divergence: private.triage_parity_rows no longer has the expected anchor; patch it from its current definition by hand';
  end if;
  execute replace(v_def, v_old, v_new);
  if pg_get_functiondef('private.triage_parity_rows(integer)'::regprocedure) not like '%' || v_new || '%' then
    raise exception 'vitals divergence: the parity report patch did not apply';
  end if;
end $$;

-- One place that names the older classifier for a reading of any of the three metrics (so the report and its proof do not each spell the dispatch).
create or replace function private.live_level_of_vital(p_type text, p_pulse integer, p_spo2 integer, p_temp numeric)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'pulse' then private.classify_pulse_level(p_pulse)
    when 'spo2' then private.classify_spo2_level(p_spo2)
    when 'temperature' then private.classify_temperature_level(p_temp)
    else 'unknown' end;
$$;

create or replace function private.vitals_divergence_rows(p_days integer)
returns table (triage_event_id uuid, observation_id uuid, metric text, shadow_grade text, shadow_rule_id text, live_level text, created_at timestamptz,
               divergence text, by_design boolean)
language sql stable security definer set search_path = '' as $$
  with win as (select now() - make_interval(days => greatest(1, least(p_days, 365))) as since),
  live as (
    select v.id, v.patient_id, v.vital_type::text as metric, v.created_at,
           case
             when private.live_level_of_vital(v.vital_type::text, v.pulse_bpm, v.spo2_pct, v.temperature_c) = 'green'
                  and v.vital_type::text = 'spo2' and st.amber_threshold_pct is not null and v.spo2_pct <= st.amber_threshold_pct then 'amber'
             when private.live_level_of_vital(v.vital_type::text, v.pulse_bpm, v.spo2_pct, v.temperature_c) = 'green'
                  and v.vital_type::text = 'temperature' and tt.amber_threshold_c is not null and v.temperature_c >= tt.amber_threshold_c then 'amber'
             else private.live_level_of_vital(v.vital_type::text, v.pulse_bpm, v.spo2_pct, v.temperature_c)
           end as live_level
      from private.vitals_readings_current v
      left join public.patient_spo2_targets st on st.patient_id = v.patient_id
      left join public.patient_temperature_targets tt on tt.patient_id = v.patient_id
     where v.vital_type::text in ('pulse', 'spo2', 'temperature') and v.source::text in ('manual', 'device', 'photo_confirmed') and v.correction_status is null
       and v.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
  )
  select e.id, e.trigger_id, l.metric, e.grade, e.rule_id, l.live_level, e.created_at,
    case
      when e.grade = 'red' and l.live_level in ('emergency', 'red') then 'both_urgent'
      when e.grade = 'red' then 'shadow_only_urgent'
      when l.live_level in ('emergency', 'red') then 'live_only_urgent'
      else 'neither_urgent'
    end,
    (e.rule_id = 'VT-PU3' and l.live_level in ('emergency', 'red'))
  from public.triage_events e
  join live l on l.id = e.trigger_id
  cross join win
  where e.trigger_type = 'observation' and not e.is_test and e.rule_set_code = 'vitals_care_triage' and e.created_at >= win.since
  union all
  -- The older trigger raised something and the engine left no result at all. Only readings made since the draft existed count: an older reading was never going to be graded.
  select null::uuid, l.id, l.metric, null::text, null::text, l.live_level, l.created_at, 'live_urgent_no_shadow', false
  from live l
  cross join win
  where l.live_level in ('emergency', 'red')
    and l.created_at >= win.since
    and l.created_at >= (select min(rs.created_at) from public.triage_rule_sets rs where rs.code = 'vitals_care_triage')
    and l.created_at < now() - interval '15 minutes'
    and not (select coalesce(p.is_test, false) from public.profiles p where p.id = l.patient_id)
    and not exists (select 1 from public.triage_events e2 where e2.trigger_type = 'observation' and e2.trigger_id = l.id and e2.rule_set_code = 'vitals_care_triage');
$$;

create or replace function public.triage_vitals_shadow_divergence(p_days integer default 30)
returns table (metric text, divergence text, shadow_grade text, live_level text, readings bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select d.metric, d.divergence, d.shadow_grade, d.live_level, count(*)
    from private.vitals_divergence_rows(p_days) d
    group by d.metric, d.divergence, d.shadow_grade, d.live_level
    order by d.metric, d.divergence, d.shadow_grade nulls last, d.live_level;
end $$;
comment on function public.triage_vitals_shadow_divergence(integer) is 'Counts of pulse, SpO2 and temperature triage grades (shadow or signed) against the older per-vital classifier, by metric and divergence class (both_urgent, neither_urgent, shadow_only_urgent, live_only_urgent, live_urgent_no_shadow). Aggregates only, manual, Bluetooth and photo-confirmed readings only. Admin or the active clinical director; test accounts excluded.';

create or replace function public.triage_vitals_shadow_disagreements(p_days integer default 30, p_limit integer default 200)
returns table (triage_event_id uuid, observation_id uuid, metric text, shadow_grade text, shadow_rule_id text, live_level text, divergence text, by_design boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select d.triage_event_id, d.observation_id, d.metric, d.shadow_grade, d.shadow_rule_id, d.live_level, d.divergence, d.by_design, d.created_at
    from private.vitals_divergence_rows(p_days) d
    where d.divergence in ('live_only_urgent', 'shadow_only_urgent', 'live_urgent_no_shadow')
    order by (d.divergence in ('live_only_urgent', 'live_urgent_no_shadow')) desc, d.by_design, d.created_at desc
    limit greatest(1, least(p_limit, 1000));
end $$;

revoke all on function private.vitals_divergence_rows(integer) from public, anon, authenticated;
revoke all on function private.live_level_of_vital(text, integer, integer, numeric) from public, anon, authenticated;
grant execute on function private.vitals_divergence_rows(integer) to service_role;
revoke all on function public.triage_vitals_shadow_divergence(integer) from public, anon;
revoke all on function public.triage_vitals_shadow_disagreements(integer, integer) from public, anon;
grant execute on function public.triage_vitals_shadow_divergence(integer) to authenticated, service_role;
grant execute on function public.triage_vitals_shadow_disagreements(integer, integer) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.triage_vitals_shadow_divergence(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_vitals_shadow_disagreements(integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.vitals_divergence_rows(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.vitals_divergence_rows(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.live_level_of_vital(text, integer, integer, numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.live_level_of_vital(text, integer, integer, numeric)', 'EXECUTE') then
    raise exception 'vitals divergence functions are not callable by anon, and the row functions are not callable by a signed-in user';
  end if;
end $$;
