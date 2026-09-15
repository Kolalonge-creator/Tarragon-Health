-- Tarragon Health — Pay-per-service, Phase 6: async "ask a doctor" as a real
-- pay-per-use item, not just a Complete-tier subscription perk.
--
-- Genuine gap closed here, not just a new feature: async_consults'
-- RLS insert policy (20260723010040) never actually checked the
-- 'async_doctor_visit' feature at all — the only gate was the
-- RequiresEntitlement UI wrapper around AskADoctor in
-- (sections)/care/page.tsx, which a direct client insert bypasses entirely.
-- This BEFORE INSERT trigger is the first real server-side enforcement:
-- either the patient's plan already includes 'async_doctor_visit', or they
-- spend one pre-purchased async_consult_credit (seeded below, cheaper than
-- a video visit per the founder's own framing — "cheaper than a full video
-- call, still real clinician judgment"). new.id is assigned here (not left
-- to the column default) so the same id can be passed as the redemption's
-- entity_id in the same statement.

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, is_active)
values (
  'async_consult_credit',
  'Ask a Doctor (Written)',
  'One written question answered by a doctor on your care team, usually within 72 hours.',
  250000, -- PLACEHOLDER (₦2,500) — deliberately priced below video_visit_credit, not founder-confirmed
  'NGN', 90, true
)
on conflict (code) do nothing;

create or replace function private.enforce_async_consult_entitlement_or_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := coalesce(new.id, gen_random_uuid());

  if private.patient_has_feature_access(new.patient_id, 'async_doctor_visit') then
    return new;
  end if;

  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, 'async_consult_credit', 'async_consult', new.id
    );
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Buy an "Ask a doctor" credit, or upgrade your plan, to send a question.'
        using errcode = 'P0001', detail = 'ASYNC_CONSULT_CREDIT_REQUIRED';
    end if;
    raise;
  end;

  return new;
end;
$$;

drop trigger if exists async_consults_enforce_entitlement_or_credit on public.async_consults;
create trigger async_consults_enforce_entitlement_or_credit
  before insert on public.async_consults
  for each row execute function private.enforce_async_consult_entitlement_or_credit();

do $$
declare
  v_org uuid;
  v_patient_with_plan uuid;
  v_patient_no_plan uuid;
  v_product_id uuid;
  v_purchase_id uuid;
  v_consult_id uuid;
begin
  if not exists (select 1 from public.service_products where code = 'async_consult_credit' and is_active) then
    raise exception 'FAIL: async_consult_credit not seeded/active';
  end if;

  select id, organisation_id into v_patient_with_plan, v_org
  from public.profiles p
  where p.role = 'patient' and private.patient_has_feature_access(p.id, 'async_doctor_visit')
  limit 1;

  if v_patient_with_plan is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient_with_plan, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.async_consults (organisation_id, patient_id, category, question)
    values (v_org, v_patient_with_plan, 'general', 'repoint-proof: plan-covered')
    returning id into v_consult_id;
    reset role;
    delete from public.async_consults where id = v_consult_id;
  else
    raise notice 'SKIPPED plan-covered proof: no patient with async_doctor_visit feature access to test against';
  end if;

  select id, organisation_id into v_patient_no_plan, v_org
  from public.profiles where role = 'patient'
  order by (case when private.patient_has_feature_access(id, 'async_doctor_visit') then 1 else 0 end)
  limit 1;

  if v_patient_no_plan is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  if private.patient_has_feature_access(v_patient_no_plan, 'async_doctor_visit') then
    raise notice 'SKIPPED no-plan-blocked/credit proof: every patient fixture already has async_doctor_visit access';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_no_plan, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.async_consults (organisation_id, patient_id, category, question)
    values (v_org, v_patient_no_plan, 'general', 'repoint-proof: should be blocked');
    reset role;
    raise exception 'FAIL: async_consults insert succeeded for a patient with no plan access and no credit';
  exception when others then
    reset role;
    if sqlerrm not like '%Buy an "Ask a doctor" credit%' then
      raise;
    end if;
  end;

  select id into v_product_id from public.service_products where code = 'async_consult_credit';
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient_no_plan, v_patient_no_plan, v_product_id, 'active', 250000, 'NGN', now(), now() + interval '90 days')
  returning id into v_purchase_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_no_plan, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.async_consults (organisation_id, patient_id, category, question)
  values (v_org, v_patient_no_plan, 'general', 'repoint-proof: paid via credit')
  returning id into v_consult_id;
  reset role;

  if not exists (select 1 from public.service_purchases where id = v_purchase_id and redeemed_at is not null and redeemed_entity_id = v_consult_id) then
    raise exception 'FAIL: async consult credit was not redeemed against the new consult row';
  end if;

  delete from public.async_consults where id = v_consult_id;
  delete from public.service_purchases where id = v_purchase_id;

  raise notice 'PASS: async_consults now enforces plan access OR a redeemed credit server-side';
end $$;
