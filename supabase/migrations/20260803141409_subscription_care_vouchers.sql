-- Care vouchers get a SKU they can actually deliver: a year of a plan.
--
-- The prepaid voucher lost its only SKU when lab fulfilment was deferred
-- (20260803134416), because every voucher was a panel_bundle and Tarragon no
-- longer sells a test. A subscription is different in the way that matters:
-- it IS the thing Tarragon provides, so selling it ahead of time is honest.
--
-- Founder decisions, 2026-08-03:
--   * the recipient REDEEMS when ready, rather than the plan starting the
--     moment somebody else pays for it. Nobody is put on a plan without an
--     act of their own, which matches every other voucher here and lets you
--     gift to someone who has not finished onboarding yet.
--   * YEARLY plans only. A gift is naturally a year of cover, and it avoids a
--     gifted monthly plan lapsing after 30 days and immediately asking the
--     recipient for a card.
--
-- Everything else is reused rather than rebuilt: face_value_kobo/
-- amount_paid_kobo already give instalments, private.
-- apply_voucher_payment_from_transaction already flips reserved -> active on
-- payment, and the expiry sweep and reminders already work. Only the SKU and
-- the redemption target are new.

alter table public.care_vouchers
  add column if not exists subscription_plan_id uuid
    references public.subscription_plans (id) on delete restrict;

comment on column public.care_vouchers.subscription_plan_id is
  'The plan this voucher buys a year of. Mutually exclusive with panel_bundle_id.';

-- A prepaid voucher must name exactly one thing. panel_bundle_id is retained
-- (not dropped) so lab prepay can return with partners, but a voucher naming
-- both, or neither, is meaningless and must not be storable.
alter table public.care_vouchers drop constraint if exists care_vouchers_one_sku;
alter table public.care_vouchers add constraint care_vouchers_one_sku check (
  kind <> 'prepaid_service'
  or (panel_bundle_id is null) <> (subscription_plan_id is null)
);

-- ---------------------------------------------------------------------------
-- Buying one.
-- ---------------------------------------------------------------------------
create or replace function public.purchase_subscription_voucher(
  p_beneficiary uuid,
  p_plan_id uuid,
  p_gift_message text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_plan public.subscription_plans%rowtype;
  v_months int;
  v_id uuid;
  v_number text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  -- Same consent gate as every other voucher: yourself, or somebody who has
  -- linked you to their care.
  if not private.can_purchase_voucher_for(p_beneficiary, v_caller) then
    raise exception 'You can only buy care for yourself or someone who has linked you to their care'
      using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then raise exception 'that plan is not in the catalogue'; end if;
  if not v_plan.is_active then
    raise exception 'that plan is not currently on sale' using errcode = '23514';
  end if;
  if v_plan.interval <> 'yearly' then
    raise exception 'Only yearly plans can be bought for someone else, so the gift covers a full year'
      using errcode = '23514';
  end if;
  if coalesce(v_plan.price_minor, 0) <= 0 then
    raise exception 'that plan is free, so there is nothing to buy' using errcode = '23514';
  end if;
  -- Naira only: face_value_kobo is a naira amount, and the dollar price is
  -- derived from the naira one anyway (one price list). The purchaser's own
  -- currency is handled at payment, not here.
  if v_plan.currency <> 'NGN' then
    raise exception 'buy the naira plan; we convert at payment if you are paying from abroad'
      using errcode = '23514';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation'; end if;

  select validity_months into v_months from public.care_voucher_config limit 1;

  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    subscription_plan_id, sku_code, sku_name,
    face_value_kobo, status, gift_message,
    expires_at
  ) values (
    v_org, v_number, 'prepaid_service',
    p_beneficiary, v_caller,
    v_plan.id, v_plan.code, v_plan.name,
    v_plan.price_minor, 'reserved', p_gift_message,
    now() + make_interval(months => coalesce(v_months, 24))
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'voucher_id', v_id,
    'voucher_number', v_number,
    'face_value_kobo', v_plan.price_minor
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Redeeming it. The recipient's own act, never the purchaser's.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_subscription_voucher(p_voucher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_v public.care_vouchers%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_existing public.subscriptions%rowtype;
  v_sub uuid;
  v_until timestamptz;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_v from public.care_vouchers where id = p_voucher_id for update;
  if not found then raise exception 'voucher not found' using errcode = '42501'; end if;

  -- Only the person it is for. A purchaser cannot start somebody's plan for
  -- them, which is the whole point of redeem-when-ready.
  if v_v.beneficiary_profile_id <> v_caller then
    raise exception 'This voucher belongs to someone else' using errcode = '42501';
  end if;
  if v_v.subscription_plan_id is null then
    raise exception 'This voucher is not for a plan' using errcode = '23514';
  end if;
  if v_v.status = 'reserved' then
    raise exception 'This voucher is not paid for yet' using errcode = '23514';
  end if;
  if v_v.status <> 'active' then
    raise exception 'This voucher cannot be used (%)' , v_v.status using errcode = '23514';
  end if;
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'This voucher expired on %', to_char(v_v.expires_at, 'DD Mon YYYY')
      using errcode = '23514';
  end if;

  select * into v_plan from public.subscription_plans where id = v_v.subscription_plan_id;

  select * into v_existing
    from public.subscriptions
   where subscriber_id = v_caller and status in ('active', 'trialing')
   order by current_period_end desc nulls last
   limit 1;

  if v_existing.id is not null then
    -- Never double-bill: add the year to what they already have rather than
    -- opening a second subscription or switching their plan under them.
    v_until := greatest(coalesce(v_existing.current_period_end, now()), now())
               + interval '1 year';
    update public.subscriptions
       set current_period_end = v_until,
           updated_at = now()
     where id = v_existing.id;
    v_sub := v_existing.id;
  else
    v_until := now() + interval '1 year';
    -- amount_minor 0 and cancel_at_period_end true: the purchaser has already
    -- paid, nothing recurs, and the existing
    -- expire-cancelled-subscriptions-daily sweep settles it at the end of the
    -- year rather than silently trying to charge a card that is not there.
    insert into public.subscriptions
      (organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
       interval, current_period_end, started_at, cancel_at_period_end, paid_by_profile_id)
    values
      (v_v.organisation_id, v_caller, v_plan.id, 'active', v_plan.currency, 0,
       'yearly', v_until, now(), true, v_v.purchaser_profile_id)
    returning id into v_sub;
  end if;

  update public.care_vouchers
     set status = 'redeemed', redeemed_at = now(), updated_at = now()
   where id = p_voucher_id;

  return jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub,
    'plan_name', v_plan.name,
    'covered_until', v_until
  );
end;
$function$;

revoke all on function public.purchase_subscription_voucher(uuid, uuid, text) from public, anon;
revoke all on function public.purchase_subscription_voucher(uuid, uuid, text) from anon;
grant execute on function public.purchase_subscription_voucher(uuid, uuid, text) to authenticated;
revoke all on function public.redeem_subscription_voucher(uuid) from public, anon;
revoke all on function public.redeem_subscription_voucher(uuid) from anon;
grant execute on function public.redeem_subscription_voucher(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='care_vouchers' and column_name='subscription_plan_id') then
    raise exception 'subscription_plan_id was not added';
  end if;
  if not exists (select 1 from pg_constraint where conname='care_vouchers_one_sku') then
    raise exception 'the one-SKU constraint is missing';
  end if;
  if has_function_privilege('anon','public.purchase_subscription_voucher(uuid, uuid, text)','EXECUTE')
     or has_function_privilege('anon','public.redeem_subscription_voucher(uuid)','EXECUTE') then
    raise exception 'anon can execute a voucher RPC';
  end if;
  if not has_function_privilege('authenticated','public.redeem_subscription_voucher(uuid)','EXECUTE') then
    raise exception 'authenticated cannot redeem';
  end if;
  -- Selling a test prepaid must STILL be closed.
  if (select pg_get_functiondef(oid) from pg_proc
        where proname='purchase_care_voucher' and pronamespace='public'::regnamespace)
     like '%insert into public.care_vouchers%' then
    raise exception 'lab prepay was reopened';
  end if;
end $$;
