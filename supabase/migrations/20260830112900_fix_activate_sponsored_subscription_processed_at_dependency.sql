-- Corrects and completes the fix in the immediately-preceding migration
-- (fix_activate_sponsored_subscription_trigger_timing). That migration made
-- the trigger listen on UPDATE OF processed_at too, on the theory that
-- processed_at eventually gets set. It doesn't, for this specific kind: the
-- real webhook's charge.success/checkout.session.completed switch has no
-- case for metadata.kind='sponsored_subscription' — it falls into the
-- generic else-branch, which treats any unrecognised kind as an
-- 'add_on' checkout, looks for a matching subscription_add_ons row by
-- pending_provider_ref, finds none (a sponsored-subscription checkout never
-- creates one), and calls markFailed(), never markProcessed(). So
-- processed_at is NEVER set for a real sponsored_subscription payment,
-- confirmed by replaying the bare INSERT alone in a rolled-back transaction
-- and observing no activation under either version of the trigger.
--
-- The correct fix mirrors private.apply_voucher_payment_from_transaction —
-- the other metadata-kind trigger that deliberately ships without
-- redeploying either webhook (see checkout-metadata.ts's docblock) — which
-- never depends on processed_at at all, only on event_type being a genuine
-- money-in event. The webhook signature-verifies and inserts the row before
-- any switch/case logic runs, so gating on event_type alone is exactly as
-- safe as gating on processed_at, and unlike processed_at, event_type is
-- always set correctly on the very first INSERT for every real charge.
--
-- Reverts the trigger to plain AFTER INSERT (removing the now-incorrect OR
-- UPDATE OF processed_at from the prior migration) and replaces the
-- `processed_at is null` guard with an event_type check.

create or replace function private.activate_sponsored_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_beneficiary uuid;
  v_sponsor uuid;
  v_plan record;
  v_org uuid;
  v_existing uuid;
begin
  if new.event_type::text not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_meta := coalesce(
    new.raw_payload -> 'data' -> 'metadata',
    new.raw_payload -> 'data' -> 'object' -> 'metadata',
    new.raw_payload -> 'metadata',
    '{}'::jsonb
  );

  if coalesce(v_meta ->> 'kind', '') <> 'sponsored_subscription' then
    return new;
  end if;

  begin
    v_beneficiary := nullif(v_meta ->> 'beneficiary_profile_id', '')::uuid;
    v_sponsor     := nullif(v_meta ->> 'sponsor_profile_id', '')::uuid;

    select id, code, currency, price_minor, interval
      into v_plan
      from public.subscription_plans
     where code = v_meta ->> 'plan_code';

    if v_beneficiary is null or v_sponsor is null or v_plan.id is null then
      return new;
    end if;

    -- The sponsor must still hold a manage grant at the moment money lands.
    -- A grant revoked between checkout and webhook must not buy anything.
    if not exists (
      select 1 from public.profile_access pa
       where pa.profile_id = v_beneficiary
         and pa.grantee_user_id = v_sponsor
         and pa.permission_level = 'manage'
    ) then
      return new;
    end if;

    select organisation_id into v_org from public.profiles where id = v_beneficiary;

    select id into v_existing
      from public.subscriptions
     where subscriber_id = v_beneficiary
       and status in ('active', 'trialing')
     limit 1;

    if v_existing is not null then
      update public.subscriptions
         set plan_id = v_plan.id,
             paid_by_profile_id = v_sponsor,
             status = 'active',
             currency = v_plan.currency,
             amount_minor = v_plan.price_minor,
             interval = v_plan.interval,
             cancel_at_period_end = false,
             current_period_end = case
               when v_plan.interval = 'yearly' then now() + interval '1 year'
               else now() + interval '1 month' end,
             updated_at = now()
       where id = v_existing;
    else
      insert into public.subscriptions
        (organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
         interval, paid_by_profile_id, started_at, current_period_end)
      values
        (v_org, v_beneficiary, v_plan.id, 'active', v_plan.currency,
         v_plan.price_minor, v_plan.interval, v_sponsor, now(),
         case when v_plan.interval = 'yearly' then now() + interval '1 year'
              else now() + interval '1 month' end);
    end if;

    -- Tell both sides. The person whose care it is must never discover they
    -- have been put on a paid plan by noticing new features.
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    select v_org, x.recipient, c.channel, 'sponsored_plan_started',
           jsonb_build_object(
             'plan_name', v_plan.code,
             'sponsor_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_sponsor),
             'person_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_beneficiary),
             'is_payer', x.recipient = v_sponsor
           ),
           'non_clinical'
      from (values (v_beneficiary), (v_sponsor)) as x(recipient)
      cross join (values ('in_app'::public.notification_channel),
                         ('email'::public.notification_channel)) as c(channel);

  exception when others then
    -- Never abort the payment record itself.
    return new;
  end;

  return new;
end;
$$;

drop trigger if exists activate_sponsored_subscription on public.payment_transactions;
create trigger activate_sponsored_subscription
  after insert on public.payment_transactions
  for each row execute function private.activate_sponsored_subscription();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.payment_transactions'::regclass
      and tgname = 'activate_sponsored_subscription'
      and not tgisinternal
  ) then
    raise exception 'activate_sponsored_subscription trigger is missing after migration';
  end if;
end $$;
