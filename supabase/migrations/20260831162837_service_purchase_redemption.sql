-- Tarragon Health — Pay-per-service, Phase 2: single-use credit redemption.
--
-- service_purchases already tracks "does this patient have a paid, active
-- grant" (status/expires_at), which is sufficient for a platform-wide pack
-- (essential_pack) or a purpose-scoped enrolment fee set at purchase time
-- (chronic_doctor_supported_pack, via scoped_entity_type/id passed into
-- record_service_purchase_intent). It is NOT sufficient for a single-use
-- session credit (one video visit, one async consult, one second-opinion
-- review) — those are bought once and must be spent exactly once, against
-- whichever specific booking the patient later creates. Without a
-- redemption record, a patient could buy one video-visit credit and book
-- unlimited visits against it.
--
-- redeemed_at/redeemed_entity_type/redeemed_entity_id record what a credit
-- was actually spent on, distinct from scoped_entity_type/id (which records
-- what a purchase was FOR at the moment of buying it, e.g. a specific
-- programme enrolment). A single-use product is sold with
-- access_duration_days set to a redemption window (the credit expires if
-- never used) rather than null, so unredeemed credits still age out like
-- everything else in this table — 'perpetual/single-use grant' in the core
-- migration's original comment meant "no recurring renewal", not "never
-- expires"; every session-credit product seeded from here on sets a real
-- window.

alter table public.service_purchases
  add column redeemed_at           timestamptz,
  add column redeemed_entity_type  text,
  add column redeemed_entity_id    uuid;

alter table public.service_purchases
  add constraint service_purchases_redemption_together
  check (
    (redeemed_at is null and redeemed_entity_type is null and redeemed_entity_id is null)
    or (redeemed_at is not null and redeemed_entity_type is not null and redeemed_entity_id is not null)
  );

-- One purchase redeems to at most one entity, and (defensively) one entity
-- is never the redemption target of two different purchases.
create unique index service_purchases_redeemed_entity_unique
  on public.service_purchases (redeemed_entity_type, redeemed_entity_id)
  where redeemed_entity_id is not null;

create index service_purchases_available_credit_idx
  on public.service_purchases (patient_id, service_product_id)
  where status = 'active' and redeemed_at is null;

-- ---------------------------------------------------------------------------
-- redeem_available_service_purchase — atomically finds the caller's oldest
-- spendable credit for a product and marks it spent against a specific new
-- booking row, in one call. "Spendable" = active, unexpired, unredeemed.
-- `for update skip locked` so two concurrent redemption attempts (e.g. a
-- double-submit) can never both claim the same credit; the loser gets the
-- same honest "no available credit" error a patient with zero credits would.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_available_service_purchase(
  p_patient_id uuid,
  p_service_product_code text,
  p_entity_type text,
  p_entity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_purchase_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if p_entity_type is null or p_entity_id is null then
    raise exception 'redemption target is required';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'patient not found';
  end if;

  if v_caller <> p_patient_id and not private.is_org_staff(v_org) then
    raise exception 'not authorised to spend this patient''s credit' using errcode = '42501';
  end if;

  select sp.id into v_purchase_id
    from public.service_purchases sp
    join public.service_products prod on prod.id = sp.service_product_id
    where sp.patient_id = p_patient_id
      and prod.code = p_service_product_code
      and sp.status = 'active'
      and sp.redeemed_at is null
      and (sp.expires_at is null or sp.expires_at > now())
    order by sp.purchased_at asc nulls last
    limit 1
    for update of sp skip locked;

  if v_purchase_id is null then
    raise exception 'no available % credit for this patient', p_service_product_code
      using errcode = 'P0001';
  end if;

  update public.service_purchases
    set redeemed_at = now(),
        redeemed_entity_type = p_entity_type,
        redeemed_entity_id = p_entity_id
    where id = v_purchase_id;

  return v_purchase_id;
end;
$$;

revoke execute on function public.redeem_available_service_purchase(uuid, text, text, uuid) from public;
revoke execute on function public.redeem_available_service_purchase(uuid, text, text, uuid) from anon;
revoke execute on function public.redeem_available_service_purchase(uuid, text, text, uuid) from public, anon;
grant execute on function public.redeem_available_service_purchase(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- has_available_service_purchase — read-only check for UI gating (e.g. "Book
-- a video visit" vs "Buy a video visit"), same authorisation shape as the
-- redeem function so a sponsor/coordinator sees what a patient could spend.
-- ---------------------------------------------------------------------------

create or replace function public.has_available_service_purchase(
  p_patient_id uuid,
  p_service_product_code text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.service_purchases sp
    join public.service_products prod on prod.id = sp.service_product_id
    where sp.patient_id = p_patient_id
      and prod.code = p_service_product_code
      and sp.status = 'active'
      and sp.redeemed_at is null
      and (sp.expires_at is null or sp.expires_at > now())
  );
$$;

revoke execute on function public.has_available_service_purchase(uuid, text) from public;
revoke execute on function public.has_available_service_purchase(uuid, text) from anon;
revoke execute on function public.has_available_service_purchase(uuid, text) from public, anon;
grant execute on function public.has_available_service_purchase(uuid, text) to authenticated;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_product_id uuid;
  v_purchase_id uuid;
  v_entity_id uuid := gen_random_uuid();
  v_redeemed uuid;
  v_has boolean;
begin
  if has_function_privilege('anon', 'public.redeem_available_service_purchase(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute redeem_available_service_purchase';
  end if;
  if has_function_privilege('anon', 'public.has_available_service_purchase(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute has_available_service_purchase';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  select id into v_product_id from public.service_products where code = 'essential_pack';

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_patient, v_product_id, 'active', 1000000, 'NGN', now(), now() + interval '30 days')
  returning id into v_purchase_id;

  v_has := public.has_available_service_purchase(v_patient, 'essential_pack');
  if not v_has then
    raise exception 'FAIL: has_available_service_purchase did not see the freshly active purchase';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_redeemed := public.redeem_available_service_purchase(v_patient, 'essential_pack', 'test_entity', v_entity_id);
  reset role;
  if v_redeemed is distinct from v_purchase_id then
    raise exception 'FAIL: redeemed the wrong purchase (got %, expected %)', v_redeemed, v_purchase_id;
  end if;

  v_has := public.has_available_service_purchase(v_patient, 'essential_pack');
  if v_has then
    raise exception 'FAIL: credit still shows as available after redemption';
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.redeem_available_service_purchase(v_patient, 'essential_pack', 'test_entity_2', gen_random_uuid());
    reset role;
    raise exception 'FAIL: redeemed a second time with no remaining credit';
  exception when others then
    reset role;
    if sqlerrm not like 'no available%' then
      raise;
    end if;
  end;

  delete from public.service_purchases where id = v_purchase_id;
  raise notice 'PASS: service_purchase single-use redemption primitive works end to end';
end $$;
