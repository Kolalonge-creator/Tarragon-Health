-- Tarragon Health — Pay-per-service business model, Phase 1 (voucher/sponsor repoint)
--
-- care_vouchers.subscription_plan_id and private.activate_sponsored_subscription
-- both hard-depend on subscription_plans/subscriptions. Repointed at
-- service_products/service_purchases so subscription_plans/subscriptions can
-- eventually be dropped — this migration does NOT drop them yet (14+ other
-- app files still read those tables directly; that UI/admin/marketing
-- cleanup is separate follow-up work, tracked in the approved plan as
-- "§1.6 last three bullets"). Confirmed live before writing this: 6 real
-- subscriptions rows exist, all QA fixtures ("Test Free/Essential/Complete/
-- Prevent/ParentCare/Diaspora Patient" — the documented 23-account QA set,
-- pw TarragonQA2026!), zero real customers, zero care_vouchers referencing
-- subscription_plan_id — backfilled below so the QA fixture set keeps
-- working against the new tables rather than silently going stale.

-- ---------------------------------------------------------------------------
-- care_vouchers: add service_product_id, repoint the one-SKU constraint to
-- accept it as a third mutually-exclusive option alongside panel_bundle_id.
-- subscription_plan_id is left in place (nullable, unreferenced going
-- forward) rather than dropped here — dropping a column is a one-way door,
-- and it costs nothing to leave it until subscription_plans itself is
-- actually dropped.
-- ---------------------------------------------------------------------------

alter table public.care_vouchers
  add column if not exists service_product_id uuid
    references public.service_products (id) on delete restrict;

comment on column public.care_vouchers.service_product_id is
  'The service pack this voucher buys a window of. Mutually exclusive with panel_bundle_id/subscription_plan_id. Replaces subscription_plan_id going forward (2026-08-31 pay-per-service migration) — subscription_plan_id is kept only for any historical row, of which none exist live.';

alter table public.care_vouchers drop constraint if exists care_vouchers_one_sku;
alter table public.care_vouchers add constraint care_vouchers_one_sku check (
  kind <> 'prepaid_service'
  or (
    (panel_bundle_id is not null)::int
    + (subscription_plan_id is not null)::int
    + (service_product_id is not null)::int
  ) = 1
);

-- ---------------------------------------------------------------------------
-- purchase_service_voucher — same role as purchase_subscription_voucher, but
-- against service_products. No "yearly only" restriction (that was specific
-- to subscription_plans.interval, which no longer exists) — instead requires
-- the product to have a real access_duration_days (a perpetual/null-duration
-- product is not something "a year of" ever meant to describe).
-- ---------------------------------------------------------------------------

create or replace function public.purchase_service_voucher(
  p_beneficiary uuid,
  p_service_product_id uuid,
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
  v_product public.service_products%rowtype;
  v_months int;
  v_id uuid;
  v_number text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not private.can_purchase_voucher_for(p_beneficiary, v_caller) then
    raise exception 'You can only buy care for yourself or someone who has linked you to their care'
      using errcode = '42501';
  end if;

  select * into v_product from public.service_products where id = p_service_product_id;
  if not found then raise exception 'that service is not in the catalogue'; end if;
  if not v_product.is_active then
    raise exception 'that service is not currently on sale' using errcode = '23514';
  end if;
  if v_product.access_duration_days is null then
    raise exception 'this service has no fixed access window and cannot be gifted as a voucher'
      using errcode = '23514';
  end if;
  if coalesce(v_product.price_kobo, 0) <= 0 then
    raise exception 'that service is free, so there is nothing to buy' using errcode = '23514';
  end if;
  if v_product.currency <> 'NGN' then
    raise exception 'buy the naira service; we convert at payment if you are paying from abroad'
      using errcode = '23514';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation'; end if;

  select validity_months into v_months from public.care_voucher_config limit 1;

  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    service_product_id, sku_code, sku_name,
    face_value_kobo, status, gift_message,
    expires_at
  ) values (
    v_org, v_number, 'prepaid_service',
    p_beneficiary, v_caller,
    v_product.id, v_product.code, v_product.name,
    v_product.price_kobo, 'reserved', p_gift_message,
    now() + make_interval(months => coalesce(v_months, 24))
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'voucher_id', v_id,
    'voucher_number', v_number,
    'face_value_kobo', v_product.price_kobo
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- redeem_service_voucher — activates (or extends) a service_purchases grant
-- rather than a subscriptions row. Same "recipient redeems when ready" rule.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_service_voucher(p_voucher_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_v public.care_vouchers%rowtype;
  v_product public.service_products%rowtype;
  v_existing public.service_purchases%rowtype;
  v_purchase uuid;
  v_until timestamptz;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select * into v_v from public.care_vouchers where id = p_voucher_id for update;
  if not found then raise exception 'voucher not found' using errcode = '42501'; end if;

  if v_v.beneficiary_profile_id <> v_caller then
    raise exception 'This voucher belongs to someone else' using errcode = '42501';
  end if;
  if v_v.service_product_id is null then
    raise exception 'This voucher is not for a service' using errcode = '23514';
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

  select * into v_product from public.service_products where id = v_v.service_product_id;

  select * into v_existing
    from public.service_purchases
   where patient_id = v_caller and service_product_id = v_product.id and status = 'active'
   order by expires_at desc nulls last
   limit 1;

  if v_existing.id is not null then
    -- Never double-bill: extend what they already have by one access window
    -- rather than opening a second grant.
    v_until := greatest(coalesce(v_existing.expires_at, now()), now())
               + (v_product.access_duration_days || ' days')::interval;
    update public.service_purchases
       set expires_at = v_until, updated_at = now()
     where id = v_existing.id;
    v_purchase := v_existing.id;
  else
    v_until := now() + (v_product.access_duration_days || ' days')::interval;
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, purchased_at, expires_at)
    values
      (v_v.organisation_id, v_caller, v_v.purchaser_profile_id, v_product.id, 'active',
       0, v_product.currency, now(), v_until)
    returning id into v_purchase;
  end if;

  update public.care_vouchers
     set status = 'redeemed', redeemed_at = now(), updated_at = now()
   where id = p_voucher_id;

  return jsonb_build_object(
    'ok', true,
    'service_purchase_id', v_purchase,
    'product_name', v_product.name,
    'covered_until', v_until
  );
end;
$function$;

revoke all on function public.purchase_service_voucher(uuid, uuid, text) from public;
revoke all on function public.purchase_service_voucher(uuid, uuid, text) from anon;
grant execute on function public.purchase_service_voucher(uuid, uuid, text) to authenticated;
revoke all on function public.redeem_service_voucher(uuid) from public;
revoke all on function public.redeem_service_voucher(uuid) from anon;
grant execute on function public.redeem_service_voucher(uuid) to authenticated;

-- The old subscription-plan voucher RPCs are superseded, not deleted outright
-- (nothing live calls them per the app-side grep behind this migration, but
-- dropping a SECURITY DEFINER function on a live project without a beat to
-- confirm is exactly the kind of one-way door CLAUDE.md warns about) — they
-- are simply no longer reachable from any UI, and will be dropped in the
-- same follow-up pass that drops subscription_plans/subscriptions.

-- ---------------------------------------------------------------------------
-- Sponsor flow: repoint private.activate_sponsored_subscription at
-- service_products/service_purchases. Renamed to
-- activate_sponsored_service_purchase for clarity (the trigger name changes
-- too); checkout-metadata.ts's 'sponsored_subscription' kind and its
-- plan_code field are UNCHANGED (still read here, now resolved against
-- service_products.code instead of subscription_plans.code) — only the
-- TS caller (initiateSponsoredSubscriptionCheckout) needs updating to query
-- service_products, tracked as a follow-up alongside the other dependent
-- TS surfaces.
-- ---------------------------------------------------------------------------

create or replace function private.activate_sponsored_service_purchase()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_meta jsonb;
  v_beneficiary uuid;
  v_sponsor uuid;
  v_product record;
  v_org uuid;
  v_existing uuid;
  v_until timestamptz;
begin
  if new.processed_at is null then return new; end if;

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

    select id, code, currency, price_kobo, access_duration_days
      into v_product
      from public.service_products
     where code = v_meta ->> 'plan_code';

    if v_beneficiary is null or v_sponsor is null or v_product.id is null then
      return new;
    end if;

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
      from public.service_purchases
     where patient_id = v_beneficiary
       and service_product_id = v_product.id
       and status = 'active'
     limit 1;

    v_until := now() + (coalesce(v_product.access_duration_days, 30) || ' days')::interval;

    if v_existing is not null then
      update public.service_purchases
         set purchaser_profile_id = v_sponsor,
             expires_at = v_until,
             updated_at = now()
       where id = v_existing;
    else
      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
         amount_kobo, currency, purchased_at, expires_at)
      values
        (v_org, v_beneficiary, v_sponsor, v_product.id, 'active',
         v_product.price_kobo, v_product.currency, now(), v_until);
    end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    select v_org, x.recipient, c.channel, 'sponsored_plan_started',
           jsonb_build_object(
             'plan_name', v_product.code,
             'sponsor_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_sponsor),
             'person_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_beneficiary),
             'is_payer', x.recipient = v_sponsor
           ),
           'non_clinical'
      from (values (v_beneficiary), (v_sponsor)) as x(recipient)
      cross join (values ('in_app'::public.notification_channel),
                         ('email'::public.notification_channel)) as c(channel);

  exception when others then
    return new;
  end;

  return new;
end;
$$;

drop trigger if exists activate_sponsored_subscription on public.payment_transactions;
create trigger activate_sponsored_service_purchase
  after insert on public.payment_transactions
  for each row execute function private.activate_sponsored_service_purchase();

-- ---------------------------------------------------------------------------
-- Backfill: the 6 live subscriptions rows are all documented QA fixtures
-- (Test Free/Essential/Complete/Prevent/ParentCare/Diaspora Patient — the
-- 23-account @tarragon.test set) — mirror each into service_purchases so
-- the fixture set keeps exercising has_feature_access after this migration,
-- rather than silently losing coverage. Skips any row whose plan code has
-- no matching *_pack product (there is none live today, but this is
-- data-only and must not hard-fail if that ever changes).
-- ---------------------------------------------------------------------------

insert into public.service_purchases
  (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
   amount_kobo, currency, payment_provider, payment_provider_ref, purchased_at, expires_at)
select
  s.organisation_id, s.subscriber_id, coalesce(s.paid_by_profile_id, s.subscriber_id), sp.id,
  (case when s.status = 'cancelled' then 'cancelled' else 'active' end)::public.service_purchase_status,
  s.amount_minor, s.currency, s.provider, s.provider_ref, s.started_at, s.current_period_end
from public.subscriptions s
join public.subscription_plans p on p.id = s.plan_id
-- Strips a _yearly/_usd/_gbp interval-or-currency suffix before matching a
-- pack code — subscription_plans had separate rows per interval/currency
-- (e.g. complete_yearly, complete_usd) but service_products does not (a
-- pack's duration/price already fully describes it), so a QA fixture on any
-- of those variants still backfills onto the one base-tier pack.
join public.service_products sp
  on sp.code = regexp_replace(p.code, '_(yearly|usd|gbp)$', '') || '_pack'
where s.subscriber_id is not null
  and not exists (
    select 1 from public.service_purchases sp2
    where sp2.patient_id = s.subscriber_id and sp2.service_product_id = sp.id
  );

do $$
declare
  v_backfilled integer;
  v_expected integer;
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='care_vouchers' and column_name='service_product_id') then
    raise exception 'service_product_id was not added to care_vouchers';
  end if;
  if has_function_privilege('anon', 'public.purchase_service_voucher(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.redeem_service_voucher(uuid)', 'EXECUTE') then
    raise exception 'anon can execute a service voucher RPC';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'activate_sponsored_service_purchase') then
    raise exception 'sponsored service-purchase trigger missing';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'activate_sponsored_subscription') then
    raise exception 'old sponsored_subscription trigger was not removed';
  end if;

  -- Not a hardcoded 6: that only held on the live project's actual QA
  -- fixture data (see header) and made this assertion fail on a from-scratch
  -- replay, where public.subscriptions is empty (seed.sql seeds none -- see
  -- CLAUDE.md's standing note that data-only backfills silently diverge
  -- between a fresh reset and the live project). Mirrors the backfill
  -- INSERT's own join logic so it stays a real proof of 1:1 coverage in
  -- either environment: 0 expected/0 backfilled on a fresh reset, 6/6 live.
  select count(*) into v_expected
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    join public.service_products sp
      on sp.code = regexp_replace(p.code, '_(yearly|usd|gbp)$', '') || '_pack'
   where s.subscriber_id is not null;

  select count(*) into v_backfilled from public.service_purchases
    where patient_id in (select subscriber_id from public.subscriptions);
  if v_backfilled <> v_expected then
    raise exception 'expected % backfilled QA service_purchases rows (one per matched subscription), got %', v_expected, v_backfilled;
  end if;

  raise notice 'PASS: vouchers and sponsor flow repointed to service_products/service_purchases; % QA rows backfilled', v_backfilled;
end $$;
