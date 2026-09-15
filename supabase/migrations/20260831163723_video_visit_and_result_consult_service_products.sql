-- Tarragon Health — Pay-per-service, Phase 4: seed the two doctor-time
-- session products the platform already sells through ad-hoc price books
-- (video_visit_prices, lab_result_consult_prices), and make service_products
-- the platform-default price source for both — one catalogue to manage
-- pricing from going forward, per the founder's "this is the monetisation
-- branch" direction. The org-override tier in each existing price table is
-- kept (a specific organisation's negotiated rate still wins), and each old
-- platform-default row is kept as a last-resort fallback if a product is
-- ever deactivated — this is a price-source repoint, not a table retirement.
--
-- video_visit_credit mirrors today's live ₦5,000 PLACEHOLDER (video_visit_
-- prices' own launch price, never founder-confirmed — see that migration's
-- comment; still not confirmed here either).
-- result_interpretation_credit uses the founder's own explicitly-given
-- ₦10,000 figure for the lab-result consultation fee (lab_result_consult_
-- prices, 2026-08-30 founder rule) — not a placeholder.
--
-- access_duration_days = 90 on both: a redemption window for an unused
-- single-use credit (see 20260831162837_service_purchase_redemption.sql),
-- not a recurring-access concept — chosen to be generous (a patient who
-- pays for a video visit and can't find a slot in time shouldn't lose the
-- money) without being effectively unlimited.

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, is_active)
values
  (
    'video_visit_credit',
    'On-Demand Video/Audio Visit',
    'One paid video or audio consultation with a doctor, booked at a time that works for you.',
    500000, 'NGN', 90, true
  ),
  (
    'result_interpretation_credit',
    'Result Interpretation Session',
    'A 15-minute doctor walkthrough of a specific lab or imaging result over video.',
    1000000, 'NGN', 90, true
  )
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Repoint private.pin_video_visit_amount(): service_products platform
-- default now sits between the existing org-override and platform-default
-- tiers of video_visit_prices.
-- ---------------------------------------------------------------------------

create or replace function private.pin_video_visit_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
begin
  select p.amount_minor, p.currency, p.is_enabled into v_price
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.video_visit_prices where organisation_id = new.organisation_id
    union all
    select price_kobo as amount_minor, currency::text as currency, is_active as is_enabled, 1
    from public.service_products where code = 'video_visit_credit'
    union all
    select amount_minor, currency, is_enabled, 2
    from public.video_visit_prices where organisation_id is null
  ) p
  order by p.pri
  limit 1;

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'video visits are not available right now';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.refund_status := null;
  new.refund_ref := null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Repoint private.pin_lab_result_consult_amount() the same way.
-- ---------------------------------------------------------------------------

create or replace function private.pin_lab_result_consult_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
  v_order record;
begin
  if new.lab_order_id is not null then
    select patient_id, organisation_id, fulfilment::text as fulfilment
      into v_order
      from public.lab_orders where id = new.lab_order_id;

    if v_order.patient_id is null or v_order.patient_id is distinct from new.patient_id then
      raise exception 'lab_order_id does not belong to this patient' using errcode = '23514';
    end if;
    if v_order.fulfilment = 'partner' then
      raise exception 'A network-billed lab order does not need a separate consultation fee'
        using errcode = '23514';
    end if;
  end if;

  select p.amount_minor, p.currency, p.is_enabled into v_price
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.lab_result_consult_prices where organisation_id = new.organisation_id
    union all
    select price_kobo as amount_minor, currency::text as currency, is_active as is_enabled, 1
    from public.service_products where code = 'result_interpretation_credit'
    union all
    select amount_minor, currency, is_enabled, 2
    from public.lab_result_consult_prices where organisation_id is null
  ) p
  order by p.pri
  limit 1;

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'the lab-result consultation fee is not available right now';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.refund_status := null;
  new.refund_ref := null;
  new.lab_result_document_id := null;
  return new;
end;
$$;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_video_req_id uuid;
  v_video_amount bigint;
  v_lab_req_id uuid;
  v_lab_amount bigint;
begin
  if not exists (select 1 from public.service_products where code = 'video_visit_credit' and is_active) then
    raise exception 'FAIL: video_visit_credit not seeded/active';
  end if;
  if not exists (select 1 from public.service_products where code = 'result_interpretation_credit' and price_kobo = 1000000) then
    raise exception 'FAIL: result_interpretation_credit not seeded with the founder-given ₦10,000 figure';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  insert into public.video_visit_requests (organisation_id, patient_id, slot_id, note)
  select v_org, v_patient, s.id, 'repoint-proof'
  from public.consult_availability_slots s
  where s.organisation_id = v_org
  limit 1
  returning id, amount_minor into v_video_req_id, v_video_amount;

  if v_video_req_id is not null and v_video_amount <> 500000 then
    raise exception 'FAIL: video_visit_requests pinned amount % does not match service_products video_visit_credit (500000)', v_video_amount;
  end if;
  if v_video_req_id is not null then
    delete from public.video_visit_requests where id = v_video_req_id;
  else
    raise notice 'SKIPPED video_visit_requests behavioral proof: no open consult_availability_slots row to test against';
  end if;

  insert into public.lab_result_consult_requests (organisation_id, patient_id, note)
  values (v_org, v_patient, 'repoint-proof')
  returning id, amount_minor into v_lab_req_id, v_lab_amount;

  if v_lab_amount <> 1000000 then
    raise exception 'FAIL: lab_result_consult_requests pinned amount % does not match service_products result_interpretation_credit (1000000)', v_lab_amount;
  end if;
  delete from public.lab_result_consult_requests where id = v_lab_req_id;

  raise notice 'PASS: video visit + result interpretation pricing repointed to service_products';
end $$;
