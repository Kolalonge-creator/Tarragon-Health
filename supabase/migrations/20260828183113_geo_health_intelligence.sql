-- Tarragon Health — Risk & Prevention Engine enhancement, 5/7
-- Geographic health intelligence (spec §2.17): aggregate, state-level view
-- of hypertension/diabetes/CVD high-risk concentration and overdue-
-- screening load — for spotting where a screening drive or outreach
-- campaign would matter most, never for looking at one person's location.
--
-- Deliberately narrower than the spec's own bullet list: "areas with high
-- hypertension/diabetes/CVD risk" and "screening gaps" are built; "service
-- shortages" and "engagement differences" would need facility-coverage and
-- product-usage data this function doesn't touch and are left for a
-- follow-up rather than guessed at here.
--
-- Lives alongside, not instead of, the existing Analytics console (its
-- other RPCs: 20260717180931_analytics_console_rpcs.sql) — same access
-- gate (private.is_analyst(): role in ('analyst','admin')) and same
-- platform-wide scope (no organisation_id parameter, mirroring
-- analytics_population_summary()'s own "select count(*) from profiles
-- where role = 'patient'" with no org filter) rather than inventing a
-- second, narrower access model for what is conceptually one more section
-- of the same console (see population-dashboard.tsx).
--
-- Privacy posture, stricter than that console's other RPCs (which have no
-- suppression at all — org-wide totals are a coarser figure): a
-- state-by-condition breakdown is a finer cut than a single platform total,
-- so this applies the same small-cell-suppression FLOOR the I9 institution
-- pattern uses (lib/institutions/suppression.ts: 5, fallback 10) — never a
-- per-organisation threshold, since this is a cross-organisation, platform-
-- wide view, not any one clinic's own report. State-level only
-- (profiles.state) — never city/area, which the platform also collects
-- (20260716160000_profiles_location.sql) but is granular enough to risk
-- re-identifying a person in a sparse area. A suppressed state's entire row
-- nulls out, not just the risk counts, so even its patient count can't be
-- read off.

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
