-- Tarragon Health — Risk & Prevention Engine enhancement, 5/7. Committed to
-- git but never actually applied to production. Content byte-identical to
-- the committed 20260827202439_geo_health_intelligence.sql.

create or replace function public.get_geo_health_aggregates()
returns table (
  state text,
  patient_count integer,
  hypertension_high_count integer,
  diabetes_high_count integer,
  cvd_high_count integer,
  overdue_screening_count integer,
  suppressed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min_cohort constant integer := 10;
begin
  if not private.is_analyst() then
    return query select null::text, null::integer, null::integer, null::integer, null::integer, null::integer, null::boolean
      where false;
    return;
  end if;

  return query
  with patients as (
    select p.id, lower(trim(p.state)) as state_key, p.state as state_label
    from public.profiles p
    where p.role = 'patient'
      and p.state is not null
      and trim(p.state) <> ''
  ),
  latest_scores as (
    select distinct on (prs.profile_id, prs.condition)
      prs.profile_id, prs.condition, prs.tier
    from public.prevention_risk_scores prs
    order by prs.profile_id, prs.condition, prs.computed_at desc
  ),
  overdue as (
    select ss.patient_id
    from public.screening_schedules ss
    where ss.status = 'overdue'
  ),
  per_state as (
    select
      pt.state_key,
      max(pt.state_label) as state_label,
      count(distinct pt.id)::integer as patient_count,
      count(distinct ls.profile_id) filter (
        where ls.condition = 'hypertension' and ls.tier in ('high', 'very_high')
      )::integer as hypertension_high_count,
      count(distinct ls.profile_id) filter (
        where ls.condition = 'diabetes' and ls.tier in ('high', 'very_high')
      )::integer as diabetes_high_count,
      count(distinct ls.profile_id) filter (
        where ls.condition = 'cvd' and ls.tier in ('high', 'very_high')
      )::integer as cvd_high_count,
      count(distinct ov.patient_id)::integer as overdue_screening_count
    from patients pt
    left join latest_scores ls on ls.profile_id = pt.id
    left join overdue ov on ov.patient_id = pt.id
    group by pt.state_key
  )
  select
    ps.state_label,
    case when ps.patient_count < v_min_cohort then null else ps.patient_count end,
    case when ps.patient_count < v_min_cohort then null else ps.hypertension_high_count end,
    case when ps.patient_count < v_min_cohort then null else ps.diabetes_high_count end,
    case when ps.patient_count < v_min_cohort then null else ps.cvd_high_count end,
    case when ps.patient_count < v_min_cohort then null else ps.overdue_screening_count end,
    ps.patient_count < v_min_cohort as suppressed
  from per_state ps
  order by ps.state_label;
end;
$$;

comment on function public.get_geo_health_aggregates() is
  'Analytics-console-only (private.is_analyst()), platform-wide, state-level, '
  'small-cell-suppressed population health aggregates (spec §2.17). A state '
  'with fewer than 10 patients nulls out entirely rather than showing a number.';

revoke all on function public.get_geo_health_aggregates() from public;
revoke all on function public.get_geo_health_aggregates() from anon;
grant execute on function public.get_geo_health_aggregates() to authenticated;
