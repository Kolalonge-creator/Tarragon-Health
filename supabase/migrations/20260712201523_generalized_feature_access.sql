-- Tarragon Health
-- Generalized subscription/add-on feature-entitlement RPC (Sprint 6).
--
-- Lives in `public`, not `private` — PostgREST only exposes functions from
-- schemas listed in supabase/config.toml's [api].schemas (public only, this
-- project), same reason public.has_ai_coach_access() had to move out of
-- private in 20260707072157_ai_coach_access_public_rpc.sql. Always resolves
-- for auth.uid(), never a passed-in id, so there's no spoofing surface.
--
-- Resolution: admin always passes; otherwise true if any active/trialing
-- base-plan subscription's features[] contains `feature`, OR any
-- active/trialing attached add-on's features[] contains it.
create or replace function public.has_feature_access(feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = (select auth.uid());

  if v_role = 'admin' then
    return true;
  end if;

  return exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing')
      and feature = any(p.features)
  ) or exists (
    select 1
    from public.subscription_add_ons sao
    join public.subscriptions s on s.id = sao.subscription_id
    join public.add_ons a on a.id = sao.add_on_id
    where s.subscriber_id = (select auth.uid())
      and sao.status in ('active', 'trialing')
      and feature = any(a.features)
  );
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC/anon by default in this project —
-- revoke both up front (see 20260707074210_ai_coach_daily_limits.sql for the
-- same fix applied after-the-fact; do it inline here instead).
revoke execute on function public.has_feature_access(text) from public;
revoke execute on function public.has_feature_access(text) from anon;
grant execute on function public.has_feature_access(text) to authenticated;

-- Behavior-preserving refactor of public.has_ai_coach_access(): identical
-- admin / per-patient-rule / org-wide-rule resolution order, only the final
-- fallback clause now delegates to has_feature_access('ai_coach') instead of
-- its own inline plan-features query, so both entitlement systems share one
-- resolution source of truth for the plan/add-on tier going forward.
create or replace function public.has_ai_coach_access()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_org uuid;
  v_patient_rule boolean;
  v_global_rule boolean;
begin
  select role, organisation_id into v_role, v_org
    from public.profiles where id = (select auth.uid());

  if v_role = 'admin' then
    return true;
  end if;

  select enabled into v_patient_rule
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id = (select auth.uid());
  if v_patient_rule is not null then
    return v_patient_rule;
  end if;

  select enabled into v_global_rule
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id is null;
  if v_global_rule is not null then
    return v_global_rule;
  end if;

  return public.has_feature_access('ai_coach');
end;
$$;

revoke execute on function public.has_ai_coach_access() from public;
revoke execute on function public.has_ai_coach_access() from anon;
grant execute on function public.has_ai_coach_access() to authenticated;
