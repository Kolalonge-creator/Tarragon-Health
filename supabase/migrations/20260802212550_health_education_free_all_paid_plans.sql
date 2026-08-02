-- Health education included free on every paid plan (Complete/Prevent
-- already had it; only Essential Care, NGN+USD/monthly+yearly, was missing
-- it). Generic over "every active non-free plan" so a future paid tier
-- picks this up automatically rather than needing its own fix.
update public.subscription_plans
  set features = (
    select array(select distinct unnest(coalesce(features, '{}') || array['health_education']))
  )
  where is_active
    and code <> 'free'
    and not ('health_education' = any(coalesce(features, '{}')));

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.subscription_plans
    where is_active and code <> 'free'
      and not ('health_education' = any(coalesce(features, '{}')));
  if v_count > 0 then
    raise exception 'health_education should be on every active paid plan, % still missing it', v_count;
  end if;
end $$;
