-- Tarragon Health — Pay-per-service business model, Phase 1 (AI coach limit)
--
-- public.get_ai_coach_daily_limit() was found still querying
-- subscriptions/subscription_plans directly (a duplicated entitlement check,
-- same class of bug as private.apply_screening_subscriber_discount and
-- apps/web/src/lib/clinical/vitals-escalation-access.ts, both already
-- rewired) — since nothing writes those tables any more, every real
-- patient's AI coach daily-limit resolution was silently falling through to
-- the org-wide/env-default fallback instead of their actual plan's
-- configured cap. Repointed at service_purchases/service_products, same
-- "most generous of any currently active grant" resolution order.

create or replace function public.get_ai_coach_daily_limit()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_org uuid;
  v_patient_limit integer;
  v_plan_limit integer;
  v_global_limit integer;
begin
  select role, organisation_id into v_role, v_org
    from public.profiles where id = (select auth.uid());

  if v_role = 'admin' then
    return 1000000;
  end if;

  select daily_limit into v_patient_limit
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id = (select auth.uid());
  if v_patient_limit is not null then
    return v_patient_limit;
  end if;

  -- Most generous of any currently active service_purchases grant, if they
  -- hold more than one with a configured cap.
  select max(p.ai_coach_daily_limit) into v_plan_limit
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = (select auth.uid())
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now());
  if v_plan_limit is not null then
    return v_plan_limit;
  end if;

  select daily_limit into v_global_limit
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id is null;

  return v_global_limit;
end;
$$;

revoke execute on function public.get_ai_coach_daily_limit() from public, anon;
grant execute on function public.get_ai_coach_daily_limit() to authenticated;

do $$
declare
  v_test_patient uuid;
  v_org uuid;
  v_essential_id uuid;
  v_purchase_id uuid;
begin
  if has_function_privilege('anon', 'public.get_ai_coach_daily_limit()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute get_ai_coach_daily_limit';
  end if;
  if pg_get_functiondef('public.get_ai_coach_daily_limit()'::regprocedure) ~ 'from public\.subscriptions' then
    raise exception 'get_ai_coach_daily_limit still reads the retired subscriptions table';
  end if;
  raise notice 'PASS: get_ai_coach_daily_limit repointed to service_purchases/service_products';
end $$;
