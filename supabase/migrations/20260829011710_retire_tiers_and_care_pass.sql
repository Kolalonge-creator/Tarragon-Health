-- Tarragon Health — retire Prevent/Essential/Complete, replace with Care Pass
-- (Revenue Architecture and Earnings Plan, engines E2, founder direction
-- 2026-08-29: "removing subscription based plan totally").
--
-- Row counts checked immediately before writing this, per the reusable
-- removal pattern this codebase already uses (see 20260729143514's own
-- header): prevent/essential/complete and their _usd derived rows have been
-- is_active=false since 20260805201508 (pending a Paystack/Stripe re-sync
-- that never happened) — nothing purchasable is being withdrawn. This
-- migration does not touch the FEATURE KEYS these plans granted (chronic,
-- clinician_review, doctor_checkin, lab_coordination, medication_refills,
-- priority_escalation, annual_review, lifestyle_coaching, ai_coach,
-- health_education, async_doctor_visit, prevention_coordination,
-- result_document_review) — Care Pass below grants the full union of them,
-- and add-ons (lifestyle-coaching, prevention-screening) still reference
-- some by name. Rows are DEACTIVATED, not deleted (same convention as the
-- Dedicated Care Coordinator / Starter Kit / Expedited Response
-- withdrawals) — plan CODE strings are referenced by name in application
-- code (pricing.ts, sponsor checkout, voucher purchase), unlike
-- family_plan_members' clean-room removal, so a full DELETE is
-- unnecessary risk for no benefit over is_active=false.
--
-- Family/FamilyPlus/FamilyPremium/ParentCare are NOT touched here — they
-- were already fully DELETED (not merely deactivated) by
-- 20260729143514_individual_enrolment_only.sql, confirmed by that
-- migration's own assertions. Nothing to do.

update public.subscription_plans
   set is_active = false,
       price_locked = false,
       paystack_plan_code = null,
       stripe_price_id = null,
       stripe_product_id = null
 where code in (
   'prevent', 'prevent_yearly', 'prevent_usd', 'prevent_yearly_usd',
   'essential', 'essential_yearly', 'essential_usd', 'essential_yearly_usd',
   'complete', 'complete_yearly', 'complete_usd', 'complete_yearly_usd'
 );

comment on table public.subscription_plans is
  'Retired 2026-08-29: prevent/essential/complete (+ _usd) are permanently withdrawn, replaced by care_pass_12mo/care_pass_6mo. Kept as is_active=false rows rather than deleted — their code strings are referenced by name elsewhere (sponsor checkout, voucher purchase, historical subscriptions.plan_id).';

-- ---------------------------------------------------------------------------
-- Fix a real, previously-undiscovered bug found while building Care Pass:
-- private.activate_sponsored_subscription (20260801092000) has never fired.
-- Its guard `if new.processed_at is null then return new` runs on an AFTER
-- INSERT trigger — payment_transactions.processed_at is only ever set by a
-- LATER .update() from the webhook (markProcessed), never present on the
-- initial .insert() the trigger actually fires on. Every other trigger of
-- this shape (private.apply_voucher_payment_from_transaction, the one below
-- for Care Pass) correctly reads new.event_type + new.raw_payload directly,
-- both of which ARE present at insert time — that is the working pattern
-- this fixes it to match. Net effect until now: "put my mother on Complete
-- Care and bill my card monthly" (CLAUDE.md's own description of this as
-- "the most-asked-for diaspora action") has silently never activated a
-- single subscription in production.
-- ---------------------------------------------------------------------------
create or replace function private.activate_sponsored_subscription()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_meta jsonb;
  v_beneficiary uuid;
  v_sponsor uuid;
  v_plan record;
  v_org uuid;
  v_existing uuid;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
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
    return new;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Care Pass (E2). "Everything the free tier gives, plus protocol-based
-- chronic tracking... for a single payment covering the term. No card on
-- file. No auto-renewal." One product replacing three gated rungs, so it
-- carries the full union of what Prevent+Essential+Complete granted between
-- them rather than picking a rung to match.
--
-- term_months is new: subscriptions.interval only has two values
-- (monthly/yearly), which is exactly the constraint 6-month Care Pass can't
-- fit; interval stays a cosmetic display hint (yearly-ish vs monthly-ish),
-- term_months is what private.activate_care_pass_purchase actually reads
-- for period-end math, so a term shorter than a year needs no schema fight
-- with the existing recurring-subscription rows that DO mean their interval
-- literally.
-- ---------------------------------------------------------------------------
alter table public.subscription_plans
  add column if not exists term_months integer check (term_months is null or term_months > 0);

comment on column public.subscription_plans.term_months is
  'Non-renewing one-off plans only (Care Pass): the real coverage length in months. NULL for ordinary recurring plans, which use interval instead.';

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, term_months, features, is_active)
values
  ('care_pass_12mo', 'Care Pass (12 months)',
     'Everything the free tier gives, plus protocol-based chronic tracking, structured reminders, a clinician review of anything that drifts, and a written care plan — one payment covers twelve months. No card on file, no auto-renewal.',
     3600000, 'NGN', 'yearly', 12,
     array['tracking','reminders','education','chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','annual_review','lifestyle_coaching','ai_coach','health_education','async_doctor_visit','prevention_coordination','result_document_review'],
     true),
  ('care_pass_6mo', 'Care Pass (6 months)',
     'The same Care Pass cover, half the term — for a first purchase you are not ready to commit a full year to.',
     2100000, 'NGN', 'monthly', 6,
     array['tracking','reminders','education','chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','priority_escalation','annual_review','lifestyle_coaching','ai_coach','health_education','async_doctor_visit','prevention_coordination','result_document_review'],
     true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  term_months = excluded.term_months,
  features = excluded.features,
  is_active = excluded.is_active;

-- ---------------------------------------------------------------------------
-- Activation. Same "recognised by a payment_transactions AAFTER INSERT
-- trigger, never by the deployed webhook Edge Functions" idiom as
-- voucher_payment/sponsored_subscription (checkout-metadata.ts's own header
-- comment: "lets voucher instalments ship without redeploying either
-- webhook") — a genuine advantage for this one over Results Interpretation,
-- which DID need both Edge Functions redeployed. Self-purchase only (the
-- metadata carries no beneficiary/sponsor split): profile_id IS the
-- subscriber. cancel_at_period_end = true and amount_minor = 0 on the
-- resulting subscriptions row for the same reason redeem_subscription_voucher
-- sets them that way — the purchaser already paid in full, nothing recurs,
-- and the existing expire-cancelled-subscriptions-daily sweep settles it at
-- term end rather than trying to charge a card that was never stored.
-- ---------------------------------------------------------------------------
create or replace function private.activate_care_pass_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_patient uuid;
  v_plan record;
  v_org uuid;
  v_existing uuid;
  v_until timestamptz;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_meta := coalesce(
    new.raw_payload -> 'data' -> 'metadata',
    new.raw_payload -> 'data' -> 'object' -> 'metadata',
    new.raw_payload -> 'metadata',
    '{}'::jsonb
  );

  if coalesce(v_meta ->> 'kind', '') <> 'care_pass_purchase' then
    return new;
  end if;

  begin
    v_patient := nullif(v_meta ->> 'profile_id', '')::uuid;

    select id, code, currency, price_minor, interval, coalesce(term_months, 12) as term_months
      into v_plan
      from public.subscription_plans
     where code = v_meta ->> 'item_code'
       and code in ('care_pass_12mo', 'care_pass_6mo');

    if v_patient is null or v_plan.id is null then
      return new;
    end if;

    select organisation_id into v_org from public.profiles where id = v_patient;
    if v_org is null then return new; end if;

    select id into v_existing
      from public.subscriptions
     where subscriber_id = v_patient
       and status in ('active', 'trialing')
     limit 1;

    v_until := now() + make_interval(months => v_plan.term_months);

    if v_existing is not null then
      -- Never double-bill: stack the new term onto what's left of the
      -- current one, same rule redeem_subscription_voucher uses for a
      -- gifted year landing on an existing subscription.
      update public.subscriptions
         set plan_id = v_plan.id,
             status = 'active',
             currency = v_plan.currency,
             amount_minor = 0,
             interval = v_plan.interval,
             cancel_at_period_end = true,
             current_period_end = greatest(coalesce(current_period_end, now()), now())
               + make_interval(months => v_plan.term_months),
             updated_at = now()
       where id = v_existing;
    else
      insert into public.subscriptions
        (organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
         interval, started_at, current_period_end, cancel_at_period_end)
      values
        (v_org, v_patient, v_plan.id, 'active', v_plan.currency, 0,
         v_plan.interval, now(), v_until, true);
    end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    values
      (v_org, v_patient, 'in_app', 'care_pass_started',
       jsonb_build_object('plan_name', v_plan.code, 'covered_until', v_until),
       'non_clinical');

  exception when others then
    return new;
  end;

  return new;
end;
$$;

drop trigger if exists activate_care_pass_purchase on public.payment_transactions;
create trigger activate_care_pass_purchase
  after insert on public.payment_transactions
  for each row execute function private.activate_care_pass_purchase();

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from public.subscription_plans
   where code in ('prevent','prevent_yearly','prevent_usd','prevent_yearly_usd',
                  'essential','essential_yearly','essential_usd','essential_yearly_usd',
                  'complete','complete_yearly','complete_usd','complete_yearly_usd')
     and is_active;
  if v_n <> 0 then raise exception '% retired tier rows are still active', v_n; end if;

  select count(*) into v_n from public.subscription_plans
   where code in ('care_pass_12mo','care_pass_6mo') and is_active and term_months is not null;
  if v_n <> 2 then raise exception 'Care Pass rows missing or not active'; end if;

  if not exists (select 1 from pg_trigger where tgname = 'activate_care_pass_purchase') then
    raise exception 'activate_care_pass_purchase trigger missing';
  end if;

  -- Prove the sponsored-subscription bug fix: the function body must no
  -- longer contain the dead guard.
  if (select pg_get_functiondef(oid) from pg_proc
        where proname = 'activate_sponsored_subscription' and pronamespace = 'private'::regnamespace)
     ilike '%processed_at is null%' then
    raise exception 'activate_sponsored_subscription still has the dead processed_at guard';
  end if;
end $$;
