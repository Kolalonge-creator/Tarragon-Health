-- Tarragon Health — fix: sponsor-paid service purchases never activate.
--
-- private.activate_sponsored_subscription (the sponsor checkout activation
-- trigger) had this exact processed_at-dependency bug fixed once already, in
-- 20260830112900_fix_activate_sponsored_subscription_processed_at_dependency.sql:
-- the live webhooks (paystack-webhook/index.ts, stripe-webhook/index.ts)
-- insert payment_transactions with processed_at NULL and only set it later
-- via markProcessed() — which their charge.success/checkout.session.completed
-- switch only ever calls for metadata.kind IN ('booking','subscription').
-- Every other kind, including 'sponsored_subscription', falls into the
-- generic else-branch (treated as an 'add_on' checkout, finds no matching
-- row, calls markFailed()) — so processed_at is NEVER set for a real
-- sponsor-paid checkout. That fix replaced the `processed_at is null` guard
-- with an `event_type` check, exactly like private.apply_voucher_payment_
-- from_transaction already did.
--
-- One day later, 20260831150844_repoint_vouchers_and_sponsor_to_service_
-- products.sql repointed this same trigger at service_products/
-- service_purchases (the pay-per-service rebuild) and renamed it to
-- private.activate_sponsored_service_purchase — but rewrote it from an
-- older copy of the function that still had the original, already-fixed
-- `if new.processed_at is null then return new; end if;` guard, silently
-- reintroducing the exact bug the previous day's migration had closed. The
-- trigger itself is (and remains) `AFTER INSERT` only, with no `OR UPDATE OF
-- processed_at`, so — confirmed live via pg_get_functiondef and
-- pg_get_triggerdef before writing this — the function returns immediately
-- on the only INSERT it will ever see for a sponsor checkout, and never runs
-- again. Checkout metadata.kind is unchanged ('sponsored_subscription' —
-- see that migration's own header, "the TS caller ... needs updating,
-- tracked as a follow-up", i.e. this was known to still read the same
-- checkout kind), so this is not a hypothetical: every real sponsor-paid
-- service-purchase checkout today takes the sponsor's money and silently
-- never grants the beneficiary anything — no service_purchases row, no
-- notification, no error, nothing to reconcile against.
--
-- Fix, identical in shape to the 20260830112900 fix: replace the
-- processed_at guard with the same event_type check every other
-- metadata-kind trigger on this table already uses. Every other line of the
-- function is preserved verbatim.
--
-- Live-verified before writing this: 0 profile_access rows with
-- permission_level='manage' exist on the live project (so 0 sponsor
-- relationships currently exist to have been silently broken by this), and
-- platform is pre-revenue — nothing to backfill, but this must be fixed
-- before the first real sponsor checkout, not after.

create or replace function private.activate_sponsored_service_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
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
    -- Never abort the payment record itself.
    return new;
  end;

  return new;
end;
$$;

revoke all on function private.activate_sponsored_service_purchase() from public;

-- ---------------------------------------------------------------------------
-- Assertions — a real behavioural round trip proving a bare INSERT with
-- processed_at NULL now activates the sponsored purchase, not just that the
-- guard text changed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_beneficiary uuid;
  v_sponsor uuid;
  v_org uuid;
  v_product record;
  v_access_id uuid;
  v_txn_id uuid;
  v_purchase_id uuid;
begin
  v_def := pg_get_functiondef('private.activate_sponsored_service_purchase()'::regprocedure);
  if v_def like '%new.processed_at is null%' then
    raise exception 'FAIL: activate_sponsored_service_purchase still gates on processed_at';
  end if;
  if v_def not like '%event_type%' then
    raise exception 'FAIL: activate_sponsored_service_purchase does not gate on event_type';
  end if;

  select id, organisation_id into v_beneficiary, v_org from public.profiles where role = 'patient' order by created_at limit 1;
  select id into v_sponsor from public.profiles where role = 'patient' and id <> v_beneficiary order by created_at limit 1;
  select id, code, currency, price_kobo, access_duration_days into v_product
    from public.service_products where is_active and code = 'ai_coach_daily_pass_30d';

  if v_beneficiary is null or v_sponsor is null or v_product.id is null then
    raise notice 'SKIPPED behavioural proof: not enough fixture data (need 2 patient profiles + ai_coach_daily_pass_30d)';
  else
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
    values (v_beneficiary, v_sponsor, 'manage', v_sponsor)
    returning id into v_access_id;

    insert into public.payment_transactions
      (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
    values (
      'paystack', 'evt-sponsored-purchase-activation-proof', 'charge.success', v_product.price_kobo, 'NGN',
      jsonb_build_object('data', jsonb_build_object(
        'reference', 'test-ref-sponsored-purchase-activation-proof',
        'metadata', jsonb_build_object(
          'kind', 'sponsored_subscription',
          'beneficiary_profile_id', v_beneficiary::text,
          'sponsor_profile_id', v_sponsor::text,
          'plan_code', v_product.code
        )
      ))
      -- processed_at deliberately left NULL — that is the whole point of this proof.
    )
    returning id into v_txn_id;

    select id into v_purchase_id from public.service_purchases
      where patient_id = v_beneficiary and service_product_id = v_product.id and status = 'active';

    if v_purchase_id is null then
      raise exception 'FAIL: sponsored purchase was not activated for a processed_at-NULL transaction — the gap is not closed';
    end if;

    -- Clean up every row this proof created.
    delete from public.notifications where organisation_id = v_org and template = 'sponsored_plan_started'
      and (payload ->> 'plan_name') = v_product.code
      and created_at >= now() - interval '1 minute';
    delete from public.service_purchases where id = v_purchase_id;
    delete from public.payment_transactions where id = v_txn_id;
    delete from public.profile_access where id = v_access_id;
  end if;

  raise notice 'PASS: activate_sponsored_service_purchase now activates on the real (processed_at-NULL) INSERT a live sponsor checkout produces';
end $$;
