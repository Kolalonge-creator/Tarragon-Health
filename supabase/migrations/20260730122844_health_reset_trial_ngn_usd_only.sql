-- Tarragon Health — 90-Day Health Reset trial: NGN/USD only, per founder
-- direction. GBP subscribers now default to the NGN trial plan instead of a
-- GBP one (same "else -> NGN" fallback the function already had, just with
-- the GBP branch removed rather than mapped to complete_gbp).
create or replace function public.claim_health_reset_trial()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset public.patient_health_resets;
  v_already_paid boolean;
  v_currency public.currency;
  v_plan_code text;
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

  select coalesce(
    (select currency from public.subscriptions where subscriber_id = (select auth.uid()) order by created_at desc limit 1),
    'NGN'
  ) into v_currency;

  -- NGN/USD only — a GBP subscriber (or anything else) gets the NGN trial.
  v_currency := case when v_currency = 'USD' then 'USD'::public.currency else 'NGN'::public.currency end;
  v_plan_code := case when v_currency = 'USD' then 'complete_usd' else 'complete' end;

  select id into v_plan_id from public.subscription_plans where code = v_plan_code and is_active limit 1;
  if v_plan_id is null then
    raise exception 'The trial plan is not currently available' using errcode = 'check_violation';
  end if;

  insert into public.subscriptions (
    organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
    interval, current_period_end, cancel_at_period_end
  )
  values (
    v_reset.organisation_id, (select auth.uid()), v_plan_id, 'trialing', v_currency, 0,
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
