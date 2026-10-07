-- Patient-side audit, 2026-09-17: record_service_purchase_intent always
-- inserted a brand-new service_purchases row on every call, with nothing
-- anywhere reusing or expiring the previous one (an explicitly documented
-- gap in payment-failure-banner.tsx's own comment and retry-payment-button's
-- comment: "record_service_purchase_intent always inserts a fresh row").
-- Confirmed live: clicking the overview "Retry payment" banner on an
-- already-abandoned purchase created a second pending_payment row for the
-- exact same product/patient rather than resuming the first, so a patient
-- who retries more than once (or hits a transient failure, e.g. the
-- Paystack email-validation error) accumulates duplicate open-ended
-- financial intents. The 24h stale-purchase sweep
-- (service-purchase-expiry.ts) already cancels a no-reference pending row,
-- so this was self-healing rather than an unbounded leak, but it is not
-- what a patient — or a finance reconciliation report — should see inside
-- that window, and it does the extra, pointless work of re-running
-- redeem_promo_code/checkout-intent logic against a duplicate row instead
-- of the one already open.
--
-- Fix: before opening a new paid intent, look for one already open for the
-- exact same (patient, product, scoped entity) and reuse it. Free products
-- (activated immediately, never left pending) are untouched — there is
-- nothing to reuse there, and no observed duplication risk for them.
create or replace function public.record_service_purchase_intent(
  p_patient_id uuid,
  p_service_product_code text,
  p_scoped_entity_type text default null,
  p_scoped_entity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_product public.service_products%rowtype;
  v_org uuid;
  v_id uuid;
  v_status public.service_purchase_status;
  v_purchased_at timestamptz;
  v_expires_at timestamptz;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient not found';
  end if;

  if v_caller <> p_patient_id and not private.is_org_staff(v_org) then
    raise exception 'not authorised to purchase on this patient''s behalf' using errcode = '42501';
  end if;

  select * into v_product from public.service_products where code = p_service_product_code;
  if not found or not v_product.is_active then
    raise exception 'service product % is not available', p_service_product_code;
  end if;

  if coalesce(v_product.price_kobo, 0) > 0 then
    select id into v_id
    from public.service_purchases
    where patient_id = p_patient_id
      and service_product_id = v_product.id
      and status = 'pending_payment'
      and scoped_entity_type is not distinct from p_scoped_entity_type
      and scoped_entity_id is not distinct from p_scoped_entity_id
    order by created_at desc
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  if coalesce(v_product.price_kobo, 0) <= 0 then
    v_status := 'active';
    v_purchased_at := now();
    v_expires_at := case when v_product.access_duration_days is null then null
                         else now() + (v_product.access_duration_days || ' days')::interval end;
  else
    v_status := 'pending_payment';
    v_purchased_at := null;
    v_expires_at := null;
  end if;

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
  values
    (v_org, p_patient_id, v_caller, v_product.id, v_status,
     v_product.price_kobo, v_product.currency, p_scoped_entity_type, p_scoped_entity_id,
     v_purchased_at, v_expires_at)
  returning id into v_id;

  return v_id;
end;
$function$;

-- Prove it: two back-to-back calls for the same product/patient must return
-- the SAME pending row, not two. Reuses a real, existing patient fixture
-- (profiles.id has a hard FK to auth.users — a fabricated gen_random_uuid()
-- profile row would violate it) and a scoped_entity_type/id combination
-- unique to this self-check, so it can never collide with that patient's
-- own real pending purchases and the cleanup at the end only ever removes
-- rows this block itself created.
do $$
declare
  v_patient uuid;
  v_product_code text;
  v_scope_type text := 'dedupe_self_check_20260917';
  v_scope_id uuid := gen_random_uuid();
  v_id1 uuid;
  v_id2 uuid;
  v_count int;
begin
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'skipping self-check: no patient profile in this environment';
    return;
  end if;

  select code into v_product_code
  from public.service_products
  where is_active and coalesce(price_kobo, 0) > 0
  order by code
  limit 1;
  if v_product_code is null then
    raise notice 'skipping self-check: no active paid service product in this environment';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select public.record_service_purchase_intent(v_patient, v_product_code, v_scope_type, v_scope_id) into v_id1;
  select public.record_service_purchase_intent(v_patient, v_product_code, v_scope_type, v_scope_id) into v_id2;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_id1 is distinct from v_id2 then
    raise exception 'dedupe self-check FAILED: two calls returned different purchase ids (% vs %)', v_id1, v_id2;
  end if;

  select count(*) into v_count
  from public.service_purchases
  where patient_id = v_patient
    and scoped_entity_type = v_scope_type
    and scoped_entity_id = v_scope_id
    and status = 'pending_payment';
  if v_count <> 1 then
    raise exception 'dedupe self-check FAILED: expected exactly 1 pending_payment row, found %', v_count;
  end if;

  delete from public.service_purchases
  where patient_id = v_patient
    and scoped_entity_type = v_scope_type
    and scoped_entity_id = v_scope_id;

  raise notice 'dedupe self-check passed: repeated intent calls reuse the same pending row';
end $$;
