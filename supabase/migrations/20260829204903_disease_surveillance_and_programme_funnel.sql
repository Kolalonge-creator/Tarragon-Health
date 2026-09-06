-- Tarragon Health — Population Health Intelligence, internal-analytics slice
-- (docs/FULL_SPECIFICATION_V4.md §12.4 "disease surveillance" and §12.8/§12.10
-- "population programme management" / "population outcome dashboard").
--
-- Deliberately narrow: this is the internal, analyst-console-only slice —
-- built against Tarragon's own real (currently small) patient data, not the
-- long-horizon §12 vision as a whole. §13 (Population Health Contracts,
-- capitation-adjacent external pricing) is explicitly out of scope here and
-- needs its own legal/regulatory review before any engineering, per that
-- section's own guardrail.
--
-- Same access model as the rest of the console (private.is_analyst(), see
-- 20260717180931_analytics_console_rpcs.sql): SECURITY DEFINER, returns
-- empty/zeroed for a non-analyst caller, aggregates only — never a raw
-- patient row.
--
-- Two additions, chosen because they were the concrete gaps left after the
-- existing population/outcomes dashboards (population-dashboard.tsx,
-- outcomes-dashboard.tsx) were audited against §12's subsection list:
--
-- 1. analytics_disease_surveillance(): trend-over-time, which
--    analytics_population_summary()'s condition_prevalence only gives as a
--    single point-in-time snapshot. Honesty note: care_plans only stores
--    *current* status, not a status-as-of-past-date history, so this reports
--    "new enrollments per period" (a real, correctly-labelled surveillance
--    signal — is inflow rising or falling) rather than a fabricated
--    "prevalence over time" the schema cannot actually support without a
--    history table.
--
-- 2. analytics_programme_funnel(): the Enrolled → Monitoring →
--    Controlled/Uncontrolled → Lost-to-follow-up pipeline per condition,
--    matching §12.8/§12.10's shape. "Controlled/uncontrolled" only exists
--    for hypertension and diabetes, reusing the exact same thresholds as
--    analytics_clinical_outcomes() (BP <140/90, glucose <=7.0 mmol/L) for
--    consistency rather than inventing new ones — other conditions
--    (obesity/ckd/cardiovascular/asthma/copd/heart_failure/other) have no
--    equivalent single-vital threshold in this schema, so those two fields
--    come back null (not 0) for them, distinguishing "not applicable" from
--    "zero controlled".

create or replace function public.analytics_disease_surveillance(p_period text default 'month')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_period text := case when p_period in ('week', 'month', 'quarter') then p_period else 'month' end;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;
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
  'view (spec §12.4): new care-plan enrollments, risk-score computations, and '
  'screening results, bucketed by period. "new_enrollment_trend" is inflow, not '
  'a historical prevalence snapshot — care_plans has no status-as-of-past-date '
  'history to compute the latter honestly.';

create or replace function public.analytics_programme_funnel()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_analyst() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    with enrolled as (
      select distinct condition, patient_id
      from public.care_plans
      where status = 'active'
    ),
    recent_activity as (
      select distinct patient_id
      from public.vitals_readings
      where taken_at >= now() - interval '90 days'
    ),
    latest_bp as (
      select distinct on (patient_id) patient_id, systolic, diastolic
      from public.vitals_readings
      where vital_type = 'blood_pressure'
        and systolic is not null and diastolic is not null
        and taken_at >= now() - interval '90 days'
      order by patient_id, taken_at desc
    ),
    latest_glucose as (
      select distinct on (patient_id) patient_id, glucose_mmol_l
      from public.vitals_readings
      where vital_type = 'glucose'
        and glucose_mmol_l is not null
        and taken_at >= now() - interval '90 days'
      order by patient_id, taken_at desc
    ),
    per_condition as (
      select
        e.condition::text as condition,
        count(distinct e.patient_id) as enrolled,
        count(distinct e.patient_id) filter (where ra.patient_id is not null) as monitoring,
        count(distinct e.patient_id) filter (where ra.patient_id is null) as lost_to_follow_up,
        count(distinct bp.patient_id) filter (
          where e.condition = 'hypertension' and bp.systolic < 140 and bp.diastolic < 90
        ) as controlled_bp,
        count(distinct bp.patient_id) filter (
          where e.condition = 'hypertension' and (bp.systolic >= 140 or bp.diastolic >= 90)
        ) as uncontrolled_bp,
        count(distinct gl.patient_id) filter (
          where e.condition = 'diabetes' and gl.glucose_mmol_l <= 7.0
        ) as controlled_glucose,
        count(distinct gl.patient_id) filter (
          where e.condition = 'diabetes' and gl.glucose_mmol_l > 7.0
        ) as uncontrolled_glucose
      from enrolled e
      left join recent_activity ra on ra.patient_id = e.patient_id
      left join latest_bp bp on bp.patient_id = e.patient_id
      left join latest_glucose gl on gl.patient_id = e.patient_id
      group by e.condition
    )
    select jsonb_agg(jsonb_build_object(
      'condition', condition,
      'enrolled', enrolled,
      'monitoring', monitoring,
      'lost_to_follow_up', lost_to_follow_up,
      'controlled', case
        when condition = 'hypertension' then controlled_bp
        when condition = 'diabetes' then controlled_glucose
        else null
      end,
      'uncontrolled', case
        when condition = 'hypertension' then uncontrolled_bp
        when condition = 'diabetes' then uncontrolled_glucose
        else null
      end
    ) order by enrolled desc)
    from per_condition
  ), '[]'::jsonb);
end;
$$;

comment on function public.analytics_programme_funnel() is
  'Analytics-console-only (private.is_analyst()), per-condition programme '
  'funnel (spec §12.8/§12.10): Enrolled (active care_plans) -> Monitoring '
  '(any vitals_reading in the last 90 days) -> Controlled/Uncontrolled '
  '(hypertension and diabetes only, same thresholds as '
  'analytics_clinical_outcomes()) -> Lost to follow-up (enrolled, no reading '
  'in 90 days). controlled/uncontrolled are null, not 0, for conditions with '
  'no defined single-vital threshold.';

revoke all on function public.analytics_disease_surveillance(text) from public, anon;
grant execute on function public.analytics_disease_surveillance(text) to authenticated;

revoke all on function public.analytics_programme_funnel() from public, anon;
grant execute on function public.analytics_programme_funnel() to authenticated;
