-- Tarragon Health — Population Health Intelligence, internal-analytics slice
-- (docs/FULL_SPECIFICATION_V4.md §12 "Population Health Intelligence &
-- National Health Infrastructure").
--
-- §12 itself is explicitly marked long-horizon/not-scoped — most of its 20
-- subsections (national-scale multi-institution architecture, research
-- dataset export, clinical trials matching, external data-monetisation
-- partnerships) need real patient volume, NDPC/DPO registration, and a
-- reviewed anonymisation methodology this platform doesn't have yet (see
-- docs/Tarragon_Health_Master_Operating_Plan_v4.md §15's 3-gate note,
-- confirmed still open in CLAUDE.md's standing follow-ups as of this
-- migration). Nothing here builds that external/sellable product. This
-- migration is deliberately narrow: three additions to the existing
-- internal analytics console (private.is_analyst() — role in
-- ('analyst','admin'), Tarragon staff only, never exposed to an
-- organisation's own users) that close real, low-risk gaps identified
-- against §12's subsection list — all computed from data the platform
-- already has, all aggregate-only, none requiring the unmet gates above:
--
-- 1. analytics_disease_surveillance() — §12.4. Trend-over-time, which
--    analytics_population_summary()'s condition_prevalence only gives as a
--    single point-in-time snapshot. Honesty note: care_plans only stores
--    *current* status, not a status-as-of-past-date history, so this
--    reports "new enrollments per period" (a real, correctly-labelled
--    surveillance signal — is inflow rising or falling) rather than a
--    fabricated "prevalence over time" the schema cannot actually support
--    without a history table.
--
-- 2. analytics_programme_funnel() — §12.8/§12.10. The Enrolled ->
--    Monitoring -> Controlled/Uncontrolled -> Lost-to-follow-up pipeline
--    per condition. "Controlled/uncontrolled" only exists for hypertension
--    and diabetes, reusing the exact same thresholds as
--    analytics_clinical_outcomes() (BP <140/90, glucose <=7.0 mmol/L) for
--    consistency rather than inventing new ones — other conditions have no
--    equivalent single-vital threshold in this schema, so those two fields
--    come back null (not 0) for them, distinguishing "not applicable" from
--    "zero controlled".
--
-- 3. analytics_health_economics() — §12.11. Extends the existing
--    cohort_cost_model_constants ("estimated cost avoided per abnormal
--    catch", already labelled a modeled business estimate, not a real
--    claims feed — see 20260716150000_care_gap_view.sql) into
--    cost-per-enrolled-patient and cost-per-controlled-patient figures, by
--    counting abnormal screening_results that DID get an active care plan
--    opened afterward (the mirror of patient_care_gaps' own
--    "unactioned_abnormal" definition) and reusing
--    analytics_programme_funnel()'s controlled counts. Still a modeled
--    estimate, not real claims data — every UI surface rendering it must
--    say so, same rule as the existing ClaimsImpactCard.
--
-- §12.18 (health inequality) is deliberately NOT a new function here — it's
-- built as a pure derived view over get_geo_health_aggregates()'s already-
-- suppressed output in the TS query layer, since the rates it needs
-- (screening-access disparity across states) don't need a new
-- cross-table aggregate, just arithmetic on data already fetched.

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

revoke all on function public.analytics_disease_surveillance(text) from public, anon;
grant execute on function public.analytics_disease_surveillance(text) to authenticated;

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

revoke all on function public.analytics_programme_funnel() from public, anon;
grant execute on function public.analytics_programme_funnel() to authenticated;

create or replace function public.analytics_health_economics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_per_catch_kobo bigint;
  v_abnormal_catches integer;
  v_enrolled_patients integer;
  v_controlled_patients integer;
  v_estimated_avoided_kobo bigint;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select estimated_cost_avoided_per_abnormal_catch_kobo into v_per_catch_kobo
  from public.cohort_cost_model_constants
  where organisation_id is null;
  v_per_catch_kobo := coalesce(v_per_catch_kobo, 0);

  -- Mirrors patient_care_gaps' own "unactioned_abnormal" definition, inverted:
  -- an abnormal/critical result IS a "catch" once an active care plan exists
  -- for that patient dated on or after the result (i.e. it got actioned).
  select count(*) into v_abnormal_catches
  from public.screening_results sr
  where sr.result_status in ('abnormal', 'critical')
    and exists (
      select 1 from public.care_plans cp
      where cp.patient_id = sr.patient_id
        and cp.status = 'active'
        and cp.created_at >= sr.created_at
    );

  select count(distinct patient_id) into v_enrolled_patients
  from public.care_plans
  where status = 'active';

  -- Sum of analytics_programme_funnel()'s per-condition "controlled" counts.
  -- A patient controlled on both hypertension and diabetes is counted once
  -- per condition (double-counted for this specific denominator) — an
  -- accepted simplification of an already-modeled figure, not hidden: the
  -- comment on the returned jsonb key says so.
  select coalesce(sum((elem->>'controlled')::integer), 0) into v_controlled_patients
  from jsonb_array_elements(public.analytics_programme_funnel()) elem
  where elem->>'controlled' is not null;

  v_estimated_avoided_kobo := v_abnormal_catches::bigint * v_per_catch_kobo;

  return jsonb_build_object(
    'is_estimate', true,
    'per_catch_kobo', v_per_catch_kobo,
    'abnormal_catches', v_abnormal_catches,
    'estimated_cost_avoided_kobo', v_estimated_avoided_kobo,
    'enrolled_patients', v_enrolled_patients,
    'cost_per_patient_kobo', case when v_enrolled_patients > 0
      then round(v_estimated_avoided_kobo::numeric / v_enrolled_patients) else null end,
    'controlled_patients_denominator', v_controlled_patients,
    'cost_per_controlled_patient_kobo', case when v_controlled_patients > 0
      then round(v_estimated_avoided_kobo::numeric / v_controlled_patients) else null end
  );
end;
$$;

comment on function public.analytics_health_economics() is
  'Analytics-console-only (private.is_analyst()), platform-wide health-'
  'economics estimate (spec §12.11): cost avoided, cost per enrolled '
  'patient, cost per controlled patient. Modeled from '
  'cohort_cost_model_constants'' admin-set per-catch figure — never a real '
  'claims-integration feed, same disclaimer requirement as ClaimsImpactCard '
  '(apps/web/src/lib/care-gaps/estimate-cost-avoided.ts). '
  'controlled_patients_denominator sums analytics_programme_funnel()''s '
  'per-condition controlled counts and can double-count a patient controlled '
  'on two conditions.';

revoke all on function public.analytics_health_economics() from public, anon;
grant execute on function public.analytics_health_economics() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.analytics_disease_surveillance(text)', 'EXECUTE') then
    raise exception 'anon can still execute analytics_disease_surveillance';
  end if;
  if has_function_privilege('anon', 'public.analytics_programme_funnel()', 'EXECUTE') then
    raise exception 'anon can still execute analytics_programme_funnel';
  end if;
  if has_function_privilege('anon', 'public.analytics_health_economics()', 'EXECUTE') then
    raise exception 'anon can still execute analytics_health_economics';
  end if;
  raise notice 'PASS: population-health-intelligence analytics RPCs present, anon denied on all three';
end $$;
