-- Tarragon Health — fix: the 90-Day Health Reset free-trial RPC
-- (public.claim_health_reset_trial) hardcoded 'complete'/'complete_usd' as
-- the trial plan, both `and is_active`. Retiring Complete Care
-- (20260829011710_retire_tiers_and_care_pass.sql) silently broke this —
-- found sweeping for stale tier references rather than by a bug report.
-- Without this fix, every patient reaching either trial trigger (the
-- milestone trial after completing the 90-Day Health Reset, or the
-- risk-triggered trial) would hit `raise exception 'The trial plan is not
-- currently available'` — a real, currently-shipped acquisition mechanism
-- silently dead, not just stale marketing copy.
--
-- Retargets to care_pass_12mo. Care Pass is NGN-only by design (no USD
-- self-serve equivalent — Family Watch is a different product, funding
-- someone else's care, not a self-trial), so the USD branch is folded into
-- the NGN default the same way the function already treats "GBP or
-- anything else" — one fewer special case, not a narrowing of who gets a
-- trial. The trial's own mechanics (30-day period, amount_minor 0,
-- cancel_at_period_end true, 'trialing' status) are set by this function
-- independently of the target plan's own price/interval, so swapping the
-- plan code is the whole fix.

create or replace function public.claim_health_reset_trial()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset public.patient_health_resets;
  v_already_paid boolean;
  v_plan_id uuid;
  v_sub_id uuid;
  v_period_end timestamptz := now() + interval '30 days';
begin
  select * into v_reset from public.patient_health_resets where patient_id = (select auth.uid());
  if v_reset.id is null then
    raise exception 'No health reset found for this account' using errcode = 'check_violation';
  end if;
  if v_reset.completed_at is null then
    raise exception 'Your 90-Day Health Reset is not complete yet' using errcode = 'check_violation';
  end if;
  if v_reset.trial_claimed_at is not null then
    raise exception 'You have already claimed this trial' using errcode = 'check_violation';
  end if;

  select exists(
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing')
      and p.code not in ('free')
  ) into v_already_paid;
  if v_already_paid then
    raise exception 'You already have an active paid plan' using errcode = 'check_violation';
  end if;

  select id into v_plan_id from public.subscription_plans where code = 'care_pass_12mo' and is_active limit 1;
  if v_plan_id is null then
    raise exception 'The trial plan is not currently available' using errcode = 'check_violation';
  end if;

  insert into public.subscriptions (
    organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
    interval, current_period_end, cancel_at_period_end
  )
  values (
    v_reset.organisation_id, (select auth.uid()), v_plan_id, 'trialing', 'NGN', 0,
    'monthly', v_period_end, true
  )
  returning id into v_sub_id;

  update public.patient_health_resets
    set trial_claimed_at = now(), trial_subscription_id = v_sub_id
    where id = v_reset.id;

  return jsonb_build_object('subscription_id', v_sub_id, 'current_period_end', v_period_end);
end;
$$;

revoke execute on function public.claim_health_reset_trial() from public;
revoke execute on function public.claim_health_reset_trial() from anon;
grant execute on function public.claim_health_reset_trial() to authenticated;

do $$
declare v_plan_id uuid;
begin
  select id into v_plan_id from public.subscription_plans where code = 'care_pass_12mo' and is_active;
  if v_plan_id is null then
    raise exception 'FAIL: care_pass_12mo is not active — claim_health_reset_trial would be broken';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc
        where proname = 'claim_health_reset_trial' and pronamespace = 'public'::regnamespace)
     ilike '%complete%' then
    raise exception 'FAIL: claim_health_reset_trial still references a retired plan code';
  end if;
end $$;
