create or replace function public.analytics_engagement_outcome_correlation()
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
    with latest_tier as (
      select distinct on (s.patient_id) s.patient_id, s.tier
      from public.patient_engagement_scores s
      join private.real_patient_ids() rp on rp.patient_id = s.patient_id
      order by s.patient_id, s.computed_at desc
    ),
    latest_bp as (
      select distinct on (r.patient_id) r.patient_id, r.risk_level
      from public.patient_risk_scores r
      where r.score_type = 'bp_control'
      order by r.patient_id, r.computed_at desc
    ),
    joined as (
      select t.tier, b.risk_level
      from latest_tier t
      join latest_bp b on b.patient_id = t.patient_id
    )
    select jsonb_agg(jsonb_build_object(
      'tier', tier,
      'cohort_size', cohort_size,
      'bp_in_range_count', bp_in_range_count
    ))
    from (
      select tier, count(*) as cohort_size,
             count(*) filter (where risk_level = 'low') as bp_in_range_count
      from joined
      group by tier
    ) grouped
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.analytics_engagement_outcome_correlation() from public;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'analytics_engagement_outcome_correlation'
  ) then
    raise exception 'FAIL: analytics_engagement_outcome_correlation() was not created';
  end if;
  if has_function_privilege('anon', 'public.analytics_engagement_outcome_correlation()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute analytics_engagement_outcome_correlation()';
  end if;
  raise notice 'PASS: analytics_engagement_outcome_correlation() created, anon EXECUTE revoked';
end $$;
