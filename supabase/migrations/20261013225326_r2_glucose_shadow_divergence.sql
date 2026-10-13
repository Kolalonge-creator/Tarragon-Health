-- R2: the parity tooling for glucose (CMO Q1 applied to glucose: the older glucose pipeline keeps running beside glucose_care_triage until parity is
-- shown), and a fix to the blood pressure divergence report that glucose shadow results would otherwise have corrupted.
--
-- 1. FIX: private.triage_divergence_rows (S12b) joined EVERY shadow triage_events row to vitals_readings and compared it with the blood pressure band.
--    Once glucose results are recorded (the wiring migration of this change) a glucose reading has no systolic, so its shadow red would have been counted as
--    "shadow_only_urgent" and every shadow green as "neither_urgent" in the report the CMO uses as the evidence for the blood pressure rules (Q1). It now
--    reads only bp_care_triage results. Same body as the live function (read with pg_get_functiondef 2026-10-13) plus that one condition.
-- 2. NEW: public.triage_glucose_shadow_divergence / triage_glucose_shadow_disagreements, the glucose twins, same gating (admin or the active clinical
--    director), aggregates without a patient id, test accounts excluded, ids only in the disagreement list.
--    "Live urgent" for glucose is the older pipeline's EMERGENCY: an emergency_events row with source glucose_red_flag for the same patient within three
--    hours of the reading (private.raise_glucose_backstop_emergency raises at most one active event per three hours, so a reading inside that window is
--    covered by the one before it). "Shadow urgent" is a red result. The dangerous row is live_only_urgent: the draft would have missed something the older
--    pipeline escalates. LIMITS, stated on the functions: the older emergency tier is severe hypoglycaemia (under 3.0) and suspected DKA with blood ketones
--    3.0 or more; it does not look at symptoms or urine ketones, the TypeScript 'urgent' tier (3.0 to 3.8, 20.0 or more) is not an emergency event so is not
--    compared, and an engine red that the older pipeline lacks (a level 3 sign, ketones with vomiting) will show as shadow_only_urgent BY DESIGN: those are
--    the new rules (Q6, Q7, Q8), to be read as such, not as errors.

create or replace function private.triage_divergence_rows(p_days integer)
returns table (triage_event_id uuid, observation_id uuid, shadow_grade text, shadow_rule_id text, live_level text, created_at timestamptz, divergence text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.trigger_id, e.grade, e.rule_id, private.classify_bp_level(v.systolic::int, v.diastolic::int), e.created_at,
    case
      when e.grade = 'red' and private.classify_bp_level(v.systolic::int, v.diastolic::int) in ('emergency', 'red') then 'both_urgent'
      when e.grade = 'red' then 'shadow_only_urgent'
      when private.classify_bp_level(v.systolic::int, v.diastolic::int) in ('emergency', 'red') then 'live_only_urgent'
      else 'neither_urgent'
    end
  from public.triage_events e
  join public.vitals_readings v on v.id = e.trigger_id
  where e.trigger_type = 'observation' and e.shadow and not e.is_test
    and e.rule_set_code = 'bp_care_triage'
    and e.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)));
$$;

create or replace function private.glucose_divergence_rows(p_days integer)
returns table (triage_event_id uuid, observation_id uuid, shadow_grade text, shadow_rule_id text, live_level text, created_at timestamptz, divergence text)
language sql stable security definer set search_path = '' as $$
  with base as (
    select e.id, e.trigger_id, e.grade, e.rule_id, e.created_at,
           exists (select 1 from public.emergency_events m
                    where m.patient_id = e.patient_id and m.source::text = 'glucose_red_flag'
                      and m.created_at between v.created_at - interval '3 hours' and v.created_at + interval '3 hours') as live_emergency
      from public.triage_events e
      join public.vitals_readings v on v.id = e.trigger_id
     where e.trigger_type = 'observation' and e.shadow and not e.is_test
       and e.rule_set_code = 'glucose_care_triage'
       and e.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
  )
  select b.id, b.trigger_id, b.grade, b.rule_id, case when b.live_emergency then 'emergency' else 'none' end, b.created_at,
    case
      when b.grade = 'red' and b.live_emergency then 'both_urgent'
      when b.grade = 'red' then 'shadow_only_urgent'
      when b.live_emergency then 'live_only_urgent'
      else 'neither_urgent'
    end
  from base b;
$$;

create or replace function public.triage_glucose_shadow_divergence(p_days integer default 30)
returns table (divergence text, shadow_grade text, live_level text, readings bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select d.divergence, d.shadow_grade, d.live_level, count(*)
    from private.glucose_divergence_rows(p_days) d
    group by d.divergence, d.shadow_grade, d.live_level
    order by d.divergence, d.shadow_grade, d.live_level;
end $$;
comment on function public.triage_glucose_shadow_divergence(integer) is 'R2: counts of shadow glucose triage grades against the older glucose pipeline''s emergency events, by divergence class. Aggregates only. Compares the older EMERGENCY tier only (severe low, suspected DKA by blood ketones), not symptoms, urine ketones or the urgent tier; an engine red the older pipeline lacks is shadow_only_urgent by design (CMO Q6 to Q8). Admin or the active clinical director; test accounts excluded.';

create or replace function public.triage_glucose_shadow_disagreements(p_days integer default 30, p_limit integer default 200)
returns table (triage_event_id uuid, observation_id uuid, shadow_grade text, shadow_rule_id text, live_level text, divergence text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select d.triage_event_id, d.observation_id, d.shadow_grade, d.shadow_rule_id, d.live_level, d.divergence, d.created_at
    from private.glucose_divergence_rows(p_days) d
    where d.divergence in ('live_only_urgent', 'shadow_only_urgent')
    order by (d.divergence = 'live_only_urgent') desc, d.created_at desc
    limit greatest(1, least(p_limit, 1000));
end $$;

revoke all on function private.glucose_divergence_rows(integer) from public, anon, authenticated;
grant execute on function private.glucose_divergence_rows(integer) to service_role;
revoke all on function public.triage_glucose_shadow_divergence(integer) from public, anon;
revoke all on function public.triage_glucose_shadow_disagreements(integer, integer) from public, anon;
grant execute on function public.triage_glucose_shadow_divergence(integer) to authenticated, service_role;
grant execute on function public.triage_glucose_shadow_disagreements(integer, integer) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.triage_glucose_shadow_divergence(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_glucose_shadow_disagreements(integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.glucose_divergence_rows(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.glucose_divergence_rows(integer)', 'EXECUTE') then
    raise exception 'R2 divergence functions are not callable by anon, and the row function is not callable by a signed-in user';
  end if;
  if pg_get_functiondef('private.triage_divergence_rows(integer)'::regprocedure) not like '%rule_set_code = ''bp_care_triage''%' then
    raise exception 'R2 self-check: the blood pressure divergence rows are not limited to bp_care_triage';
  end if;
end $$;
