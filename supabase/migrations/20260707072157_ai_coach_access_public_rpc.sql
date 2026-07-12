-- Tarragon Health
-- Fix: private.has_ai_coach_access() (20260707010000) is not callable via
-- supabase.rpc() — PostgREST only exposes functions from schemas listed in
-- supabase/config.toml's [api].schemas (public only, in this project). Every
-- other function in this codebase lives in `private` on purpose (internal
-- to triggers/other SQL, never meant to be called directly) — this is the
-- first one that patients need to call themselves, so it has to live in
-- `public` instead. ALTERs the migration created above rather than editing
-- it in place, since it's already applied.

drop function private.has_ai_coach_access();

create function public.has_ai_coach_access()
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

  return exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing')
      and 'ai_coach' = any(p.features)
  );
end;
$$;

grant execute on function public.has_ai_coach_access() to authenticated;
