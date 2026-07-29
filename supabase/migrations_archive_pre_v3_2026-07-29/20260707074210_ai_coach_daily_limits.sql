-- Tarragon Health
-- AI Health Coach — per-group and per-patient daily message caps
--
-- Extends the access-rules work (20260707010000/20260707020000/20260707020200)
-- with a configurable cap instead of one hardcoded env-var limit for
-- everyone. Two admin-editable knobs, both optional (null = "no override
-- here, keep resolving"):
--   - subscription_plans.ai_coach_daily_limit — one cap per plan tier (free,
--     standard, premium, family, etc. are just existing subscription_plans
--     rows), so different tiers can get different daily allowances.
--   - ai_coach_access_rules.daily_limit — reuses the existing global/
--     per-patient scope rows to let admin override the cap org-wide or for
--     one patient specifically, same as the existing `enabled` column.
--
-- Resolution order (see public.get_ai_coach_daily_limit()): admin (no cap)
-- > per-patient rule > best (highest) active/trialing plan cap > org-wide
-- rule > null, meaning the caller falls back to its own env-configured
-- default (AI_COACH_DAILY_MESSAGE_LIMIT).

alter table public.subscription_plans
  add column ai_coach_daily_limit integer
    check (ai_coach_daily_limit is null or ai_coach_daily_limit > 0);

alter table public.ai_coach_access_rules
  add column daily_limit integer
    check (daily_limit is null or daily_limit > 0);

create function public.get_ai_coach_daily_limit()
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

  -- Admins test the coach constantly; a message cap would just get in the
  -- way, same reasoning as hasCoachAccess() exempting admin from the gate.
  if v_role = 'admin' then
    return 1000000;
  end if;

  select daily_limit into v_patient_limit
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id = (select auth.uid());
  if v_patient_limit is not null then
    return v_patient_limit;
  end if;

  -- Most generous of any plan they're actively paying for, if they hold
  -- more than one subscription with a configured cap.
  select max(p.ai_coach_daily_limit) into v_plan_limit
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing');
  if v_plan_limit is not null then
    return v_plan_limit;
  end if;

  select daily_limit into v_global_limit
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id is null;

  return v_global_limit;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC/anon by default in this project
-- (confirmed via information_schema.role_routine_grants while fixing the
-- same issue for has_ai_coach_access — 20260707020100/20260707020200) —
-- revoke both up front instead of finding out from the security advisor.
revoke execute on function public.get_ai_coach_daily_limit() from public;
revoke execute on function public.get_ai_coach_daily_limit() from anon;
grant execute on function public.get_ai_coach_daily_limit() to authenticated;
