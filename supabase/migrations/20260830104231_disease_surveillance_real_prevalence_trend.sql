-- Tarragon Health — real prevalence-over-time for analytics_disease_surveillance()
-- (spec §12.4), now that 20260830103524_care_plan_status_history.sql exists.
--
-- The original 20260830015307_population_health_intelligence_analytics.sql
-- had to substitute "new enrollments per period" for genuine prevalence,
-- with an honesty note explaining care_plans had no status-as-of-past-date
-- history to compute the real thing. That's no longer true. Adds
-- prevalence_trend: a true "how many patients had an active care plan for
-- condition X as of the end of period Y" reconstruction from
-- care_plan_status_history, via an as-of lateral join (for each period
-- bucket, each patient/condition's most recent status at or before that
-- bucket's end). new_enrollment_trend is kept, not replaced — inflow and
-- current burden are different, both-useful signals.

create or replace function public.analytics_disease_surveillance(p_period text default 'month')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period text := case when p_period in ('week', 'month', 'quarter') then p_period else 'month' end;
  v_step interval := case v_period
    when 'week' then interval '7 days'
    when 'quarter' then interval '3 months'
    else interval '1 month'
  end;
  v_min_changed timestamptz;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select min(changed_at) into v_min_changed from public.care_plan_status_history;

  return jsonb_build_object(
    'period', v_period,
    'new_enrollment_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'condition', condition,
        'count', c
      ) order by bucket, condition), '[]'::jsonb)
      from (
        select date_trunc(v_period, created_at) as bucket, condition::text as condition,
               count(distinct patient_id) as c
        from public.care_plans
        group by 1, 2
      ) t
    ),
    'prevalence_trend', case when v_min_changed is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'condition', condition,
        'count', c
      ) order by bucket, condition), '[]'::jsonb)
      from (
        select gs.bucket, sub.condition::text as condition, count(*) as c
        from generate_series(date_trunc(v_period, v_min_changed), date_trunc(v_period, now()), v_step) as gs(bucket)
        cross join lateral (
          select distinct on (csh.patient_id, csh.condition) csh.condition, csh.status
          from public.care_plan_status_history csh
          where csh.changed_at <= gs.bucket + v_step - interval '1 microsecond'
          order by csh.patient_id, csh.condition, csh.changed_at desc
        ) sub
        where sub.status = 'active'
        group by gs.bucket, sub.condition
      ) t
    ) end,
    'risk_scoring_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'risk_level', risk_level,
        'count', c
      ) order by bucket, risk_level), '[]'::jsonb)
      from (
        select date_trunc(v_period, computed_at) as bucket, risk_level::text as risk_level, count(*) as c
        from public.patient_risk_scores
        group by 1, 2
      ) t
    ),
    'screening_result_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'bucket', to_char(bucket, 'YYYY-MM-DD'),
        'total', total,
        'abnormal', abnormal
      ) order by bucket), '[]'::jsonb)
      from (
        select date_trunc(v_period, created_at) as bucket,
               count(*) as total,
               count(*) filter (where result_status in ('abnormal', 'critical')) as abnormal
        from public.screening_results
        group by 1
      ) t
    )
  );
end;
$$;

comment on function public.analytics_disease_surveillance(text) is
  'Analytics-console-only (private.is_analyst()), platform-wide trend-over-time '
  'view (spec §12.4): prevalence_trend is a real as-of-date reconstruction '
  'from care_plan_status_history (how many patients had an active care plan '
  'per condition as of each period''s end); new_enrollment_trend is inflow '
  '(distinct patients whose FIRST care_plan row for a condition landed in '
  'that period) — a different, still-useful signal, kept alongside rather '
  'than replaced. risk_scoring_trend/screening_result_trend unchanged.';

do $$
begin
  if has_function_privilege('anon', 'public.analytics_disease_surveillance(text)', 'EXECUTE') then
    raise exception 'anon can still execute analytics_disease_surveillance';
  end if;
  raise notice 'PASS: analytics_disease_surveillance still anon-denied after prevalence_trend upgrade';
end $$;
