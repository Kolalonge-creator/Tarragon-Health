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
-- Privacy posture, deliberately stricter than the existing I9 institution-
-- aggregate pattern (lib/institutions/suppression.ts's isCohortSuppressed):
--   - State-level only (profiles.state) — never city/area, which the
--     platform also collects (20260716160000_profiles_location.sql) but
--     is granular enough to risk re-identifying a person in a sparse area.
--   - Gated to a genuine platform admin (private.is_admin()), not the
--     institution-admin class I9 already locked out of every patient-scoped
--     table — an employer/HMO has no legitimate reason to see population
--     health outside its own roster, and this is Tarragon's own population-
--     health tooling, not a per-institution report.
--   - The same small-cell suppression floor as I9 (5, fallback 10 from
--     organisations.min_cohort_size) applied per state, and a suppressed
--     state's entire row nulls out — not just the risk counts — so even the
--     total patient count in a sparse state can't be read off.

create or replace function public.get_geo_health_aggregates(p_organisation_id uuid)
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
  v_min_cohort integer;
begin
  if not private.is_admin() then
    raise exception 'not authorised: geographic health aggregates are a platform-admin surface';
  end if;

  select greatest(coalesce(o.min_cohort_size, 10), 5) into v_min_cohort
  from public.organisations o where o.id = p_organisation_id;
  v_min_cohort := coalesce(v_min_cohort, 10);

  return query
  with patients as (
    select p.id, lower(trim(p.state)) as state_key, p.state as state_label
    from public.profiles p
    where p.organisation_id = p_organisation_id
      and p.role = 'patient'
      and p.state is not null
      and trim(p.state) <> ''
  ),
  latest_scores as (
    select distinct on (prs.profile_id, prs.condition)
      prs.profile_id, prs.condition, prs.tier
    from public.prevention_risk_scores prs
    where prs.organisation_id = p_organisation_id
    order by prs.profile_id, prs.condition, prs.computed_at desc
  ),
  overdue as (
    select ss.patient_id
    from public.screening_schedules ss
    where ss.organisation_id = p_organisation_id and ss.status = 'overdue'
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

comment on function public.get_geo_health_aggregates(uuid) is
  'Platform-admin-only, state-level, small-cell-suppressed population health '
  'aggregates (spec §2.17). Never returns anything below organisations.'
  'min_cohort_size (floor 5) for a state — the whole row nulls out instead.';

revoke all on function public.get_geo_health_aggregates(uuid) from public;
revoke all on function public.get_geo_health_aggregates(uuid) from anon;
grant execute on function public.get_geo_health_aggregates(uuid) to authenticated;
