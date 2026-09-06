-- Fixes a real bug in part 3/6 (20260829093527), caught by a live smoke test
-- before anything downstream depended on it.
--
-- private.sync_employer_subscription_from_roster() inserted currency => 'ngn'
-- (lowercase, following the lowercase convention every OTHER enum on this
-- table uses — billing_interval 'monthly', payment_provider 'employer',
-- subscription_status 'active'). public.currency is the one enum on
-- `subscriptions` that is actually uppercase ('NGN'/'GBP'/'USD'), so every
-- claim of a roster member carrying a benefit package would have failed with
-- "invalid input value for enum currency" and rolled back the claim itself —
-- caught immediately rather than shipped, since claim_employer_roster_member
-- calls this trigger synchronously.

create or replace function private.sync_employer_subscription_from_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package public.employer_benefit_packages;
  v_period_end timestamptz;
  v_sub_id uuid;
begin
  if new.claimed_profile_id is null then
    return null;
  end if;

  if new.status in ('departed', 'removed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.granted_subscription_id is not null then
      update public.subscriptions
         set status = 'cancelled', cancelled_at = now()
       where id = new.granted_subscription_id
         and status in ('active', 'trialing');
    end if;
    return null;
  end if;

  if new.status <> 'claimed' then
    return null;
  end if;

  if new.benefit_package_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'claimed'
     and old.benefit_package_id is not distinct from new.benefit_package_id
     and old.claimed_profile_id is not distinct from new.claimed_profile_id
     and old.eligible_until is not distinct from new.eligible_until then
    return null;
  end if;

  select * into v_package from public.employer_benefit_packages where id = new.benefit_package_id and is_active;
  if v_package.id is null then
    return null;
  end if;

  v_period_end := case when new.eligible_until is not null
                       then new.eligible_until::timestamptz + interval '1 day'
                       else now() + interval '1 year' end;

  if new.granted_subscription_id is not null then
    update public.subscriptions
       set plan_id = v_package.subscription_plan_id,
           current_period_end = v_period_end,
           status = 'active',
           cancelled_at = null
     where id = new.granted_subscription_id
       and subscriber_id = new.claimed_profile_id
     returning id into v_sub_id;
  end if;

  if v_sub_id is null then
    insert into public.subscriptions
      (organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
       interval, provider, current_period_end, started_at)
    values
      (new.organisation_id, new.claimed_profile_id, v_package.subscription_plan_id,
       'active', 'NGN', 0, 'monthly', 'employer', v_period_end, now())
    returning id into v_sub_id;

    update public.employer_roster_members set granted_subscription_id = v_sub_id where id = new.id;
  end if;

  return null;
end;
$$;

do $$
begin
  if pg_get_functiondef('private.sync_employer_subscription_from_roster()'::regprocedure) like '%''ngn''%' then
    raise exception 'FAIL: lowercase ngn literal still present';
  end if;
  if pg_get_functiondef('private.sync_employer_subscription_from_roster()'::regprocedure) not like '%''NGN''%' then
    raise exception 'FAIL: NGN literal missing';
  end if;
  raise notice 'PASS  sync_employer_subscription_from_roster uses the real currency enum casing';
end $$;
