-- Patient Engagement Engine, step 6: the analyst-facing rollup (§16.17 —
-- disengagement, re-engagement, care-plan adherence counts). Deliberately a
-- new RPC on the EXISTING /analytics/engagement page rather than a new
-- top-level analytics category: that page's nav (lib/analytics/sections.ts)
-- is an explicitly fixed, designed "16 categories" list, and "how patients
-- use the app" already lives there — this is a same-page addition, not a new
-- surface. Same security shape as every other analytics_* RPC:
-- security definer, gated by private.is_analyst(), empty result for anyone
-- else rather than an error (so a stale client can't be tricked into
-- thinking access was denied vs. there being no data).
create or replace function public.analytics_care_engagement_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level_counts jsonb;
  v_segment_counts jsonb;
  v_re_engaged_30d bigint;
  v_scored_patients bigint;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  with latest as (
    select distinct on (ces.patient_id) ces.patient_id, ces.engagement_level, ces.segments
    from public.care_engagement_scores ces
    join private.real_patient_ids() rp on rp.patient_id = ces.patient_id
    order by ces.patient_id, ces.computed_at desc
  )
  select
    coalesce(jsonb_object_agg(engagement_level, level_count), '{}'::jsonb),
    count(*)
  into v_level_counts, v_scored_patients
  from (
    select engagement_level, count(*) as level_count
    from latest
    group by engagement_level
  ) t;

  with latest as (
    select distinct on (ces.patient_id) ces.patient_id, ces.segments
    from public.care_engagement_scores ces
    join private.real_patient_ids() rp on rp.patient_id = ces.patient_id
    order by ces.patient_id, ces.computed_at desc
  ),
  expanded as (
    select unnest(segments) as segment from latest
  )
  select coalesce(jsonb_object_agg(segment, segment_count), '{}'::jsonb)
  into v_segment_counts
  from (
    select segment, count(*) as segment_count
    from expanded
    group by segment
  ) t;

  select count(*) into v_re_engaged_30d
  from public.patient_milestones pm
  join private.real_patient_ids() rp on rp.patient_id = pm.patient_id
  where pm.milestone_type = 'engagement_recovery' and pm.achieved_at >= now() - interval '30 days';

  return jsonb_build_object(
    'scored_patients', v_scored_patients,
    'level_counts', v_level_counts,
    'segment_counts', v_segment_counts,
    're_engaged_30d', v_re_engaged_30d
  );
end;
$$;

revoke all on function public.analytics_care_engagement_summary() from public, anon;
grant execute on function public.analytics_care_engagement_summary() to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'analytics_care_engagement_summary'
  ) then
    raise exception 'public.analytics_care_engagement_summary() missing after migration';
  end if;
end $$;
