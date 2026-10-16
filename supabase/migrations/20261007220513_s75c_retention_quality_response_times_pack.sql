-- S75c: retention and programme completion kept apart from clinical outcomes (22.2); clinician response times and escalation / follow-up rates (22.7);
-- the standalone data-quality report (22.8); the monthly CMO fairness report (22.3, decision S75-4); the sponsor pilot / renewal pack with an
-- enforced "no causal claim" wording check (22.9). Design: docs/design/S75.md.
-- Depends on S75a (private.suppress_*), S75b (outcome_measure_config), S75 track D (outcome_measure_snapshots, outcome_mh_snapshots), S38 to S38f, S16 to S19 (clinical_tasks, task_claims), S26 (entitlements).
-- Every figure below goes through private.suppress_cell / suppress_groups (the S75a proof's scan lists these functions too). Test accounts are left out
-- of every count (INV-13). Nothing here lists an individual and nothing ranks a clinician (decision: no per-clinician league table).

-- ---------------------------------------------------------------------------
-- 1. Retention and programme completion (22.2). A separate family: it says whether people stayed and kept logging, not whether they got better.
-- ---------------------------------------------------------------------------
create function private.retention_aggregate(p_from date, p_to date, p_patients uuid[] default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := private.min_cell_floor();
  v_grace integer := (private.outcome_rule('grace_days') #>> '{}')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_win integer := (private.outcome_measure_rule('{retention,engaged_window_days}') #>> '{}')::integer;
  d integer; a record; v_days jsonb := '[]'::jsonb; v_comp record; v_reason text;
begin
  if p_from is not null then p_from := date_trunc('month', p_from)::date; end if;
  if p_to is not null then p_to := (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date; end if;
  drop table if exists pg_temp._s75_people;
  create temp table _s75_people on commit drop as
    select j.patient_id, min(j.dt) as anchor
      from (select patient_id, (starts_at at time zone 'Africa/Lagos')::date dt from public.patient_memberships
            union all
            select patient_id, (starts_at at time zone 'Africa/Lagos')::date from public.entitlements where kind in ('membership', 'care_pack')) j
      join public.profiles p on p.id = j.patient_id and not coalesce(p.is_test, false)
     where p_patients is null or j.patient_id = any (p_patients)
     group by j.patient_id
    having (p_from is null or min(j.dt) >= p_from) and (p_to is null or min(j.dt) <= p_to);
  for d in select jsonb_array_elements_text(private.outcome_measure_rule('{retention,days}'))::integer loop
    select count(*) as due,
           count(*) filter (where exists (
             select 1 from public.patient_memberships m where m.patient_id = x.patient_id and (m.starts_at at time zone 'Africa/Lagos')::date <= x.anchor + d
                and (coalesce(m.ended_at, m.ends_at) is null or (coalesce(m.ended_at, m.ends_at) at time zone 'Africa/Lagos')::date > x.anchor + d)
              union all
             select 1 from public.entitlements e where e.patient_id = x.patient_id and e.kind in ('membership', 'care_pack') and e.state <> 'revoked'
                and (e.starts_at at time zone 'Africa/Lagos')::date <= x.anchor + d and (e.ends_at is null or (e.ends_at at time zone 'Africa/Lagos')::date > x.anchor + d))) as retained,
           count(*) filter (where exists (
             select 1 from public.vitals_readings v where v.patient_id = x.patient_id
                and (v.taken_at at time zone 'Africa/Lagos')::date between x.anchor + d - (v_win - 1) and x.anchor + d)) as engaged
      into a from _s75_people x where x.anchor + d + v_grace <= v_today;
    v_reason := private.suppress_cell(a.due, array[a.retained, a.due - a.retained]::bigint[], v_min);
    v_days := v_days || jsonb_build_array(jsonb_build_object('day', d) || case when v_reason is not null then jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', v_min)
      else jsonb_build_object('suppressed', false, 'due', a.due, 'retained', a.retained, 'retained_pct', round(100.0 * a.retained / a.due, 1),
             'engaged_pct', case when private.suppress_cell(a.due, array[a.engaged, a.due - a.engaged]::bigint[], v_min) is null then round(100.0 * a.engaged / a.due, 1) end) end);
  end loop;
  -- programme completion (decision S75-7, OQ-383): of the Memberships and care packs whose term has ended, the share that were FULLY USED: the entitlement is
  -- marked used, or its term ended with no clinical item (consultation or test) left unused (remaining_uses = 0). Revoked entitlements (refunded or cancelled)
  -- never finished a term and are not counted either way. An entitlement with no use count that simply expired is not fully used. This is an engagement
  -- measure: it says whether people used what they had, not whether they improved.
  select count(*) as ended, count(*) filter (where e.state = 'used' or (e.state = 'expired' and e.remaining_uses = 0)) as used into v_comp
    from public.entitlements e join _s75_people x on x.patient_id = e.patient_id
   where e.kind in ('membership', 'care_pack') and not e.is_test and e.state in ('used', 'expired');
  v_reason := private.suppress_cell(v_comp.ended, array[v_comp.used, v_comp.ended - v_comp.used]::bigint[], v_min);
  return jsonb_build_object(
    'family', 'retention_and_engagement', 'minimum_cell', v_min,
    'by_day', v_days,
    'programme_completion', case when v_reason is not null then jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', v_min)
      else jsonb_build_object('suppressed', false, 'ended_entitlements', v_comp.ended, 'fully_used', v_comp.used, 'fully_used_pct', round(100.0 * v_comp.used / v_comp.ended, 1),
             'label', 'Memberships and care packs whose term has ended that were fully used (every consultation and test item used)') end,
    'definition', 'Retained: still holding an active membership or care pack on the day. Engaged: logged at least one reading in the 30 days ending on that day. Programme completion: of the Memberships and care packs whose term has ended, the share that were fully used, meaning every consultation and test item in them was used by the end of the term. Refunded or cancelled ones are not counted.',
    'limitations', 'These describe staying and logging, not health. They are never combined with a clinical outcome. A person who joined later is not yet due and is not counted. Not a ranking of anyone and never a reason to deny care.',
    'not_a_causal_claim', true, 'generated_at', now());
end $$;
revoke all on function private.retention_aggregate(date, date, uuid[]) from public, anon, authenticated;

create function public.retention_completion_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'outcomes_not_authorised' using errcode = '42501'; end if;
  v_r := private.retention_aggregate(p_from, p_to);
  perform private.log_audit('outcomes.retention_report', 'outcome_report', null, jsonb_build_object('from', p_from, 'to', p_to));
  return v_r;
end $$;
revoke all on function public.retention_completion_report(date, date) from public, anon;
grant execute on function public.retention_completion_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Response times, escalation and follow-up rates (22.7). S36e already shows what is waiting now, page acknowledgement and cover gaps; this
--    adds how long tasks took, by how urgent they were and by the tier of the clinician who finished them. Never one clinician: a tier row needs
--    at least min_clinicians_per_group clinicians behind it.
-- ---------------------------------------------------------------------------
create function public.response_times_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := private.min_cell_floor();
  v_minclin integer := (private.outcome_measure_rule('{response_times,min_clinicians_per_group}') #>> '{}')::integer;
  v_from date := coalesce(p_from, (now() at time zone 'Africa/Lagos')::date - 90); v_to date := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_bands jsonb := '[]'::jsonb; v_tiers jsonb := '[]'::jsonb; g jsonb; v_groups jsonb; v_fu jsonb; b record;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'outcomes_not_authorised' using errcode = '42501'; end if;
  drop table if exists pg_temp._s75_tasks;
  create temp table _s75_tasks on commit drop as
    select t.id, t.patient_id, t.type, t.priority_class, t.escalation_level, t.handback_count, t.created_at, t.due_at, t.completed_at, t.state,
           (select min(c.claimed_at) from public.task_claims c where c.task_id = t.id) as first_claim_at,
           (select c.clinician_id from public.task_claims c where c.task_id = t.id and c.end_reason = 'completed' order by c.claimed_at desc limit 1) as finisher
      from public.clinical_tasks t join public.profiles p on p.id = t.patient_id
     where not t.is_test and not coalesce(p.is_test, false) and t.state <> 'cancelled'
       and (t.created_at at time zone 'Africa/Lagos')::date between v_from and v_to;
  -- by how urgent the task was
  for b in
    select k.band,
           count(distinct t.patient_id) as people, count(*) as tasks,
           count(*) filter (where t.state = 'completed') as done,
           count(*) filter (where t.state = 'completed' and t.completed_at <= t.due_at) as on_time,
           count(*) filter (where t.escalation_level > 0) as escalated,
           count(*) filter (where t.handback_count > 0) as handed_back,
           (percentile_cont(0.5) within group (order by extract(epoch from t.first_claim_at - t.created_at) / 60)) as med_claim,
           (percentile_cont(0.9) within group (order by extract(epoch from t.first_claim_at - t.created_at) / 60)) as p90_claim,
           (percentile_cont(0.5) within group (order by extract(epoch from t.completed_at - t.created_at) / 60) filter (where t.state = 'completed')) as med_done
      from _s75_tasks t
      join lateral (select e.key as band from jsonb_each(private.outcome_measure_rule('{response_times,priority_bands}')) e
                     where t.priority_class between (e.value ->> 0)::integer and (e.value ->> 1)::integer limit 1) k on true
     group by k.band
  loop
    v_bands := v_bands || jsonb_build_array(jsonb_build_object('priority_band', b.band, 'key', b.band, 'n', b.people, 'cats', jsonb_build_array(b.done, b.tasks - b.done),
      'tasks', b.tasks, 'done', b.done, 'on_time', b.on_time, 'escalated', b.escalated, 'handed_back', b.handed_back,
      'med_claim', round(b.med_claim::numeric, 0), 'p90_claim', round(b.p90_claim::numeric, 0), 'med_done', round(b.med_done::numeric, 0)));
  end loop;
  select coalesce(jsonb_agg(case when (x ->> 'suppressed')::boolean then jsonb_build_object('priority_band', x ->> 'key', 'suppressed', true)
    else jsonb_build_object('priority_band', x ->> 'key', 'suppressed', false, 'tasks', (x ->> 'tasks')::integer,
           'completed_pct', round(100.0 * (x ->> 'done')::numeric / (x ->> 'tasks')::numeric, 1),
           'completed_on_time_pct', round(100.0 * (x ->> 'on_time')::numeric / (x ->> 'tasks')::numeric, 1),
           'escalation_rate_pct', round(100.0 * (x ->> 'escalated')::numeric / (x ->> 'tasks')::numeric, 1),
           'handed_back_pct', round(100.0 * (x ->> 'handed_back')::numeric / (x ->> 'tasks')::numeric, 1),
           'median_minutes_to_first_claim', (x ->> 'med_claim')::numeric, 'p90_minutes_to_first_claim', (x ->> 'p90_claim')::numeric,
           'median_minutes_to_completion', (x ->> 'med_done')::numeric) end order by x ->> 'key'), '[]'::jsonb)
    into v_bands from jsonb_array_elements(private.suppress_groups(v_bands, v_min)) x;
  -- by the tier of the clinician who finished the task: a tier needs enough clinicians behind it that no one can be picked out
  select coalesce(jsonb_agg(jsonb_build_object('key', tier, 'n', people, 'cats', jsonb_build_array(done, tasks - done), 'clinicians', clin, 'tasks', tasks, 'done', done,
           'med_done', round(med_done::numeric, 0)) order by tier), '[]'::jsonb) into v_groups
    from (select cs.doctor_tier::text as tier, count(distinct t.patient_id) as people, count(*) as tasks, count(*) filter (where t.state = 'completed') as done,
                 count(distinct t.finisher) as clin, percentile_cont(0.5) within group (order by extract(epoch from t.completed_at - t.created_at) / 60) as med_done
            from _s75_tasks t join public.clinical_staff cs on cs.profile_id = t.finisher
           where t.state = 'completed' group by cs.doctor_tier) x;
  for g in select * from jsonb_array_elements(private.suppress_groups(v_groups, v_min)) loop
    v_tiers := v_tiers || jsonb_build_array(case when (g ->> 'suppressed')::boolean or (g ->> 'clinicians')::integer < v_minclin
      then jsonb_build_object('doctor_tier', g ->> 'key', 'suppressed', true, 'reason', case when not (g ->> 'suppressed')::boolean then 'few_clinicians' else g ->> 'reason' end)
      else jsonb_build_object('doctor_tier', g ->> 'key', 'suppressed', false, 'tasks_finished', (g ->> 'tasks')::integer, 'median_minutes_to_completion', (g ->> 'med_done')::numeric) end);
  end loop;
  -- follow-up: the adherence follow-up task type, which is the follow-up work a care coordinator does
  select jsonb_build_object('type', 'adherence_follow_up', 'people', count(distinct patient_id), 'tasks', count(*), 'done', count(*) filter (where state = 'completed'),
                            'on_time', count(*) filter (where state = 'completed' and completed_at <= due_at)) into v_fu from _s75_tasks where type = 'adherence_follow_up';
  v_fu := case when private.suppress_cell((v_fu ->> 'people')::bigint, array[(v_fu ->> 'done')::bigint, (v_fu ->> 'tasks')::bigint - (v_fu ->> 'done')::bigint], v_min) is not null
    then jsonb_build_object('type', 'adherence_follow_up', 'suppressed', true, 'minimum', v_min)
    else jsonb_build_object('type', 'adherence_follow_up', 'suppressed', false, 'tasks', (v_fu ->> 'tasks')::integer,
           'completed_pct', round(100.0 * (v_fu ->> 'done')::numeric / (v_fu ->> 'tasks')::numeric, 1), 'completed_on_time_pct', round(100.0 * (v_fu ->> 'on_time')::numeric / (v_fu ->> 'tasks')::numeric, 1)) end;
  perform private.log_audit('outcomes.response_times_report', 'outcome_report', null, jsonb_build_object('from', v_from, 'to', v_to));
  return jsonb_build_object('range', jsonb_build_object('from', v_from, 'to', v_to), 'minimum_cell', v_min, 'minimum_clinicians_per_tier', v_minclin,
    'by_priority_band', v_bands, 'by_finisher_tier', v_tiers, 'follow_up', v_fu,
    'what_this_is', 'How long tasks waited and how long they took, by how urgent they were and by the tier of the clinician who finished them, plus how often a task was escalated or handed back. What is waiting right now, page acknowledgement and on-call cover are on the reliability dashboard.',
    'limitations', 'Tasks, not people, are counted in the rates; a group is withheld when too few different people are behind it, and so is the next smallest. A tier is shown only when enough different clinicians finished its tasks. There is no per-clinician figure anywhere. Not a ranking of anyone.',
    'not_a_causal_claim', true, 'generated_at', now());
end $$;
revoke all on function public.response_times_report(date, date) from public, anon;
grant execute on function public.response_times_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Data quality and missing data (22.8): across the snapshots, the sources and the sync lag.
-- ---------------------------------------------------------------------------
create function public.outcome_data_quality_report(p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := private.min_cell_floor();
  v_grace integer := (private.outcome_rule('grace_days') #>> '{}')::integer;
  v_from date := coalesce(p_from, (now() at time zone 'Africa/Lagos')::date - 90); v_to date := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_fam jsonb := '[]'::jsonb; v_src jsonb := '[]'::jsonb; r record; v_reason text; v_lag record;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'outcomes_not_authorised' using errcode = '42501'; end if;
  -- snapshot completeness, by family and day: of the people whose day was due, how many were measured, had nothing, or were excluded. HbA1c and weight only here:
  -- the mental-health snapshot table is read by exactly the functions the S75 proof lists, and this is not one of them. (A person excluded from a measure has no row, so is not in 'due'.)
  for r in
    select family, day, count(*) as due, count(*) filter (where st = 'measured') as measured, count(*) filter (where st = 'none') as nothing, count(*) filter (where st = 'excluded') as excluded
      from (select 'blood_pressure' as family, s.day::integer as day, case s.bp_status when 'insufficient_data' then 'none' else 'measured' end as st, s.patient_id
              from public.outcome_snapshots s join public.profiles p on p.id = s.patient_id
             where s.pathway_code = 'bp' and not s.is_test and not coalesce(p.is_test, false) and s.anchor_date between v_from - 400 and v_to
            union all
            select m.measure_code, m.day::integer, case when m.value is not null then 'measured' else 'none' end, m.patient_id
              from public.outcome_measure_snapshots m join public.profiles p on p.id = m.patient_id
             where not m.is_test and not coalesce(p.is_test, false) and m.anchor_date between v_from - 400 and v_to) u
     group by family, day order by family, day
  loop
    v_reason := private.suppress_cell(r.due, array[r.measured, r.nothing, r.excluded]::bigint[], v_min);
    v_fam := v_fam || jsonb_build_array(jsonb_build_object('family', r.family, 'day', r.day) || case when v_reason is not null then jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', v_min)
      else jsonb_build_object('suppressed', false, 'due', r.due, 'measured_pct', round(100.0 * r.measured / r.due, 1), 'nothing_recorded_pct', round(100.0 * r.nothing / r.due, 1), 'excluded_pct', round(100.0 * r.excluded / r.due, 1)) end);
  end loop;
  -- where blood pressure readings come from, and how many a clinician still has to clear: counted in people, one source at a time
  for r in
    select src, count(distinct patient_id) as people, count(*) as readings, count(*) filter (where flagged) as flagged
      from (select v.source::text as src, v.patient_id, v.validation_status <> 'valid' as flagged
              from public.vitals_readings v join public.profiles p on p.id = v.patient_id
             where v.vital_type = 'blood_pressure' and not coalesce(p.is_test, false) and (v.taken_at at time zone 'Africa/Lagos')::date between v_from and v_to) x
     group by src order by src
  loop
    v_reason := private.suppress_cell(r.people, null, v_min);
    v_src := v_src || jsonb_build_array(jsonb_build_object('source', r.src) || case when v_reason is not null then jsonb_build_object('suppressed', true, 'reason', v_reason, 'minimum', v_min)
      else jsonb_build_object('suppressed', false, 'people', r.people, 'readings', r.readings, 'flagged_for_review_pct', round(100.0 * r.flagged / r.readings, 1)) end);
  end loop;
  -- sync lag: how long after it was taken a device or wearable reading reached us
  select count(distinct v.patient_id) as people, count(*) as readings,
         count(*) filter (where v.created_at::date - (v.taken_at at time zone 'Africa/Lagos')::date > v_grace) as late,
         percentile_cont(0.5) within group (order by extract(epoch from v.created_at - v.taken_at) / 3600) as med_hours
    into v_lag
    from public.vitals_readings v join public.profiles p on p.id = v.patient_id
   where v.source::text in ('device', 'wearable') and not coalesce(p.is_test, false) and (v.taken_at at time zone 'Africa/Lagos')::date between v_from and v_to;
  perform private.log_audit('outcomes.data_quality_report', 'outcome_report', null, jsonb_build_object('from', v_from, 'to', v_to));
  return jsonb_build_object('range', jsonb_build_object('from', v_from, 'to', v_to), 'minimum_cell', v_min,
    'snapshot_completeness', v_fam, 'reading_sources', v_src,
    'sync_lag', case when private.suppress_cell(v_lag.people, null, v_min) is not null then jsonb_build_object('suppressed', true, 'minimum', v_min)
                else jsonb_build_object('suppressed', false, 'readings', v_lag.readings, 'median_hours_to_arrive', round(v_lag.med_hours::numeric, 1),
                       'arrived_after_grace_pct', round(100.0 * v_lag.late / v_lag.readings, 1), 'grace_days', v_grace) end,
    'what_this_is', 'How complete the data behind every outcome figure is: how many people had a usable result when their day came, where readings come from, how many wait for a clinician, and how late device readings arrive. A late reading is never added to a past snapshot.',
    'limitations', 'Counted in people (readings are shown only beside the people behind them). Small groups are withheld. A reading that arrives after the grace period is counted here and not in the outcome it came too late for.',
    'not_a_causal_claim', true, 'generated_at', now());
end $$;
revoke all on function public.outcome_data_quality_report(date, date) from public, anon;
grant execute on function public.outcome_data_quality_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The monthly CMO fairness report (22.3, decision S75-4). Risk stays deterministic; each month a frozen distribution by sex, age band and region
--    is written once, for the CMO to review. (Language is not a cut: the platform is English only, decision 2026-10-07.)
-- ---------------------------------------------------------------------------
create function private.risk_distribution_json(p_as_of date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := private.min_cell_floor(); v_out jsonb := '{}'::jsonb; d text; v_cells jsonb; v_total integer;
begin
  drop table if exists pg_temp._s75_latest;
  create temp table _s75_latest on commit drop as
    select distinct on (s.patient_id) s.patient_id, s.level,
           coalesce(p.sex::text, 'unknown') as sex, coalesce(p.state, 'unknown') as state,
           case when p.date_of_birth is null then 'unknown'
                when extract(year from age(s.computed_on, p.date_of_birth)) < 18 then 'under_18'
                else (floor(extract(year from age(s.computed_on, p.date_of_birth)) / 10) * 10)::integer::text || 's' end as age_band
      from public.risk_scores s join public.profiles p on p.id = s.patient_id
     where not s.is_test and not coalesce(p.is_test, false) and (p_as_of is null or s.computed_on <= p_as_of)
     order by s.patient_id, s.computed_on desc;
  select count(*) into v_total from _s75_latest;
  foreach d in array array['sex', 'age_band', 'state'] loop
    execute format($q$
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', n, 'cats', jsonb_build_array(hi, me, lo), 'hi', hi, 'me', me, 'lo', lo)), '[]'::jsonb)
        from (select %1$I as k, count(*) n, count(*) filter (where level = 'high') hi, count(*) filter (where level = 'medium') me, count(*) filter (where level = 'low') lo
                from _s75_latest group by 1) cells$q$, d) into v_cells;
    select coalesce(jsonb_agg(case when (g ->> 'suppressed')::boolean then jsonb_build_object('key', g ->> 'key', 'suppressed', true)
                                   else jsonb_build_object('key', g ->> 'key', 'n', (g ->> 'n')::integer, 'high', (g ->> 'hi')::integer, 'medium', (g ->> 'me')::integer,
                                                           'low', (g ->> 'lo')::integer, 'high_pct', round(100.0 * (g ->> 'hi')::numeric / (g ->> 'n')::numeric, 1)) end
                             order by g ->> 'key'), '[]'::jsonb)
      into v_cells from jsonb_array_elements(private.suppress_groups(v_cells, v_min)) g;
    v_out := v_out || jsonb_build_object(case d when 'state' then 'region' else d end, v_cells);
  end loop;
  return jsonb_build_object('total_scored', case when private.suppress_cell(v_total, null, v_min) is null then v_total end, 'minimum_cell', v_min, 'by', v_out,
    'purpose', 'Checks that the ordering does not fall unevenly on one group. A group with few people is withheld, and so is the next smallest so it cannot be recovered by subtraction.',
    'not_a_causal_claim', true);
end $$;
revoke all on function private.risk_distribution_json(date) from public, anon, authenticated;

-- The existing report keeps its name, its caller check and its audit row, and its keys ("state" stays "state" for the page that reads it).
create or replace function public.risk_distribution_report() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'risk_not_authorised' using errcode = '42501'; end if;
  v_r := private.risk_distribution_json(null);
  v_r := jsonb_set(v_r, '{by}', (v_r -> 'by') - 'region' || jsonb_build_object('state', v_r #> '{by,region}'));
  perform private.log_audit('risk.distribution_report', 'risk_scores', null, '{}'::jsonb);
  return v_r;
end $$;

create table public.risk_fairness_reports (
  month           date primary key check (month = date_trunc('month', month)::date),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  payload         jsonb not null,
  model_version   integer references public.risk_config (version),
  generated_at    timestamptz not null default now(),
  reviewed_by     uuid references public.profiles (id) on delete restrict,
  reviewed_at     timestamptz,
  review_note     text,
  check ((reviewed_by is null) = (reviewed_at is null)),
  check (reviewed_by is null or length(btrim(coalesce(review_note, ''))) >= 10)
);
alter table public.risk_fairness_reports enable row level security;
revoke all on public.risk_fairness_reports from public, anon, authenticated;
-- No policy, no grant: read through the functions below. The figures are written once; only the CMO's review fields can be filled, once.
create function private.risk_fairness_reports_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'risk_fairness_reports_append_only' using errcode = 'P0001'; end if;
  if new.month is distinct from old.month or new.payload is distinct from old.payload or new.generated_at is distinct from old.generated_at
     or new.organisation_id is distinct from old.organisation_id or new.model_version is distinct from old.model_version then
    raise exception 'risk_fairness_reports_append_only' using errcode = 'P0001';
  end if;
  if old.reviewed_by is not null then raise exception 'risk_fairness_reports_already_reviewed' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger risk_fairness_reports_guard before update or delete on public.risk_fairness_reports
  for each row execute function private.risk_fairness_reports_guard();
revoke all on function private.risk_fairness_reports_guard() from public, anon, authenticated;

-- Written once for the month that just closed, from the 3rd (grace for late-syncing readings), using the scores as they stood at the month's end.
create function private.generate_risk_fairness_report(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Lagos')::date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_end date := (date_trunc('month', v_today) - interval '1 day')::date;
  v_org uuid;
begin
  if v_today < (date_trunc('month', v_today)::date + 2) then return 0; end if;
  if exists (select 1 from public.risk_fairness_reports where month = v_month) then return 0; end if;
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.risk_fairness_reports (month, organisation_id, payload, model_version)
  values (v_month, v_org, private.risk_distribution_json(v_end), (select version from public.risk_config where is_active))
  on conflict (month) do nothing;
  return 1;
exception when others then
  perform private.open_job_incident('risk-fairness-failing', 'The monthly fairness report is failing', 'It could not be written (' || left(sqlerrm, 200) || '). It is retried every day.');
  return 0;
end $$;
revoke all on function private.generate_risk_fairness_report(timestamptz) from public, anon, authenticated;
select cron.schedule('risk-fairness-monthly', '30 2 * * *', $$ select private.generate_risk_fairness_report(); $$);

create function public.risk_fairness_history() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'risk_not_authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('month', f.month, 'generated_at', f.generated_at, 'model_version', f.model_version, 'payload', f.payload,
           'reviewed', f.reviewed_by is not null, 'reviewed_at', f.reviewed_at, 'review_note', f.review_note,
           'reviewed_by_name', (select p.full_name from public.profiles p where p.id = f.reviewed_by)) order by f.month desc), '[]'::jsonb) into v_r
    from public.risk_fairness_reports f;
  perform private.log_audit('risk.fairness_history', 'risk_fairness_reports', null, '{}'::jsonb);
  return v_r;
end $$;
revoke all on function public.risk_fairness_history() from public, anon;
grant execute on function public.risk_fairness_history() to authenticated;

-- The CMO records that a month was reviewed, with a note. Only the active CMO; once per month; never by an agent.
create function public.record_risk_fairness_review(p_month date, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.credential_is_cmo() then raise exception 'risk_not_authorised' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say what was reviewed' using errcode = '22023'; end if;
  begin
    update public.risk_fairness_reports set reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = btrim(p_note) where month = date_trunc('month', p_month)::date;
  exception when sqlstate 'P0001' then return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_such_month'); end if;
  perform private.log_audit('risk.fairness_reviewed', 'risk_fairness_reports', null, jsonb_build_object('month', date_trunc('month', p_month)::date));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.record_risk_fairness_review(date, text) from public, anon;
grant execute on function public.record_risk_fairness_review(date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The wording check that keeps causal claims out of anything a sponsor receives (22.9, spec: no causal claim without an evaluation design)
-- ---------------------------------------------------------------------------
-- A sentence that states a limit ("does not show that the programme caused ...") is allowed: a sentence containing a negation is not scanned.
-- The same two patterns are mirrored in packages/shared/src/causal-wording.ts and a drift test compares them with the lines between the markers.
-- causal-pattern-begin
-- \m(caused|causes|causing|because of the programme|due to the programme|as a result of the programme|thanks to the programme|led to|leads to|resulted in|results in|attributable to|attributed to|proves|proved|proven|demonstrates that|demonstrated that|saved|savings|return on investment|roi|prevented|reduced the risk|impact of the programme|improved because)\M
-- causal-negation: \m(not|no|never|cannot|without|nor|neither|rather than)\M|n't
-- causal-pattern-end
create function private.causal_wording_hits(p_text text) returns text[]
language plpgsql immutable set search_path = ''
as $$
declare s text; m text[]; v_hits text[] := '{}';
begin
  for s in select lower(x) from regexp_split_to_table(coalesce(p_text, ''), '[.!?;\n]+') x loop
    continue when s ~ '\m(not|no|never|cannot|without|nor|neither|rather than)\M|n''t';
    for m in select regexp_matches(s, '\m(caused|causes|causing|because of the programme|due to the programme|as a result of the programme|thanks to the programme|led to|leads to|resulted in|results in|attributable to|attributed to|proves|proved|proven|demonstrates that|demonstrated that|saved|savings|return on investment|roi|prevented|reduced the risk|impact of the programme|improved because)\M', 'g') loop
      if not (m[1] = any (v_hits)) then v_hits := v_hits || m[1]; end if;
    end loop;
  end loop;
  return v_hits;
end $$;
revoke all on function private.causal_wording_hits(text) from public, anon, authenticated;

-- every string in a JSON document, joined as sentences, so the check sees what a sponsor would read
create function private.json_text(p_doc jsonb) returns text
language sql immutable set search_path = ''
as $$ select coalesce(string_agg(v #>> '{}', E'. '), '') from jsonb_path_query(p_doc, 'strict $.** ? (@.type() == "string")') v $$;
revoke all on function private.json_text(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The sponsor pilot and renewal pack (22.9)
-- ---------------------------------------------------------------------------
create function private.sponsor_pack_build(p_cohort uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.sponsor_cohorts%rowtype; v_members uuid[]; v_fig jsonb; v_meas jsonb := '{}'::jsonb; m text; v_signed boolean := private.outcome_measures_signed();
  v_min integer; v_doc jsonb; v_hits text[]; d integer; v_by jsonb; v_pack jsonb;
begin
  select * into c from public.sponsor_cohorts where id = p_cohort;
  if not found then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  v_members := private.sponsor_agreed_members(p_cohort);
  v_fig := private.sponsor_report_aggregate(p_cohort, p_from, p_to);
  v_min := (v_fig ->> 'minimum_cell')::integer;
  -- All four measures. PHQ-9 and GAD-7 reach a sponsor ONLY as suppressed group figures, through private.outcome_measure_cohort (CMO decision 2026-10-14, S75-7): never a person,
  -- never below the minimum cohort size.
  foreach m in array array['hba1c', 'weight', 'phq9', 'gad7'] loop
    if not v_signed then
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('withheld', true, 'reason', 'awaiting_cmo_signature'));
    elsif private.suppress_cell(cardinality(v_members), null, v_min) is not null then
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min));
    else
      v_by := '{}'::jsonb;
      foreach d in array array[90, 180] loop v_by := v_by || jsonb_build_object(d::text, private.outcome_measure_cohort(m, d, p_from, p_to, v_members)); end loop;
      v_meas := v_meas || jsonb_build_object(m, jsonb_build_object('withheld', false, 'by_day', v_by));
    end if;
  end loop;
  v_pack := jsonb_build_object(
    'cover', jsonb_build_object('programme', c.name, 'sponsor', v_fig #>> '{cohort,sponsor}', 'valid_from', c.valid_from, 'valid_to', c.valid_to,
                                'range', jsonb_build_object('from', p_from, 'to', p_to), 'generated_at', now()),
    'evaluation_design', private.outcome_measure_rule('{pack,evaluation_design}') #>> '{}',
    'caveat', private.outcome_measure_rule('{pack,caveat}') #>> '{}',
    'group_figures', v_fig,
    'retention_and_engagement', case when private.suppress_cell(cardinality(v_members), null, v_min) is null then private.retention_aggregate(p_from, p_to, v_members)
                                     else jsonb_build_object('suppressed', true, 'reason', 'under_minimum', 'minimum', v_min) end,
    'clinical_measures', v_meas,
    'not_a_causal_claim', true);
  v_hits := private.causal_wording_hits(private.json_text(v_pack));
  if cardinality(v_hits) > 0 then return jsonb_build_object('ok', false, 'reason', 'causal_wording', 'hits', to_jsonb(v_hits)); end if;
  return jsonb_build_object('ok', true, 'pack', v_pack, 'wording_check', jsonb_build_object('passed', true));
end $$;
revoke all on function private.sponsor_pack_build(uuid, date, date) from public, anon, authenticated;

create function public.sponsor_pilot_pack(p_cohort uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_r jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  v_r := private.sponsor_pack_build(p_cohort, p_from, p_to);
  perform private.log_audit('sponsor.pilot_pack', 'sponsor_cohort', p_cohort, jsonb_build_object('from', p_from, 'to', p_to, 'ok', v_r -> 'ok'));
  return v_r;
end $$;
revoke all on function public.sponsor_pilot_pack(uuid, date, date) from public, anon;
grant execute on function public.sponsor_pilot_pack(uuid, date, date) to authenticated;

-- A pack download is logged BEFORE the file is built, like the other exports.
create function public.log_sponsor_pack_export(p_cohort uuid, p_format text default 'csv') returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if p_format not in ('csv', 'pdf') then raise exception 'bad_format' using errcode = '22023'; end if;
  if not exists (select 1 from public.sponsor_cohorts where id = p_cohort) then raise exception 'sponsor_cohort_not_found' using errcode = '22023'; end if;
  perform private.log_audit('sponsor.pilot_pack_export', 'sponsor_cohort', p_cohort, jsonb_build_object('format', p_format));
end $$;
revoke all on function public.log_sponsor_pack_export(uuid, text) from public, anon;
grant execute on function public.log_sponsor_pack_export(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.risk_fairness_reports', 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon', 'public.risk_fairness_reports', 'SELECT') then
    raise exception 'S75c: a user can touch risk_fairness_reports';
  end if;
  if has_function_privilege('anon', 'public.sponsor_pilot_pack(uuid,date,date)', 'EXECUTE') or has_function_privilege('anon', 'public.response_times_report(date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.outcome_data_quality_report(date,date)', 'EXECUTE') or has_function_privilege('anon', 'public.retention_completion_report(date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.risk_fairness_history()', 'EXECUTE') or has_function_privilege('anon', 'public.record_risk_fairness_review(date,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.log_sponsor_pack_export(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.risk_distribution_report()', 'EXECUTE') then
    raise exception 'S75c: anon can run a report';
  end if;
  if cardinality(private.causal_wording_hits('The programme caused the fall in blood pressure.')) <> 1 then raise exception 'S75c: causal wording not caught'; end if;
  if cardinality(private.causal_wording_hits('This does not show that the programme caused any change.')) <> 0 then raise exception 'S75c: a stated limit was rejected'; end if;
end $$;
