-- Two-tier decisions, 2026-10-12, item 4.
--
-- (a) PRESCRIPTION RENEWALS ARE DISCUSSED AT THE MONTHLY REVIEW (decision 2026-10-13, replacing the 2026-10-12 28 day request rule).
--     A renewal is not a separate request. The standalone request route is CLOSED for a Member: the trigger answers that the doctor
--     reviews renewals at the monthly call (detail RENEWAL_AT_MONTHLY_REVIEW); the Member can add a note to the next review instead
--     (20261013013400). A Free person is told that renewal is part of Membership. A credit someone already holds is still honoured for
--     a non-Member. Only the Member's own insert is refused; a doctor, staff or service-job insert for a Member passes (code review 2026-10-13). FINDING kept: the old check passed everyone, because 'medication_refills' is in the free feature list.
-- (b) SECOND OPINION = an extra 5,000 naira (500,000 kobo), Members only. second_opinion_credit is the live product code (read
--     2026-10-12: price 1,200,000 kobo, inactive, 0 live purchases of it). It is re-enabled at 500,000 kobo and is the ONE product
--     exempt from service_products_doctor_time_not_sellable; every other doctor-time product stays closed. It is purchasable only when
--     private.patient_is_member is true: enforced in record_service_purchase_intent (plain message) and by a BEFORE INSERT trigger
--     on service_purchases so no other route (sponsored reservation, voucher) can sell it to a Free, lapsed or ended person. Fail
--     closed: an error while working out membership refuses. The price is versioned data: the service_products row, mirrored as
--     commerce.second_opinion in the proposed-config registry with a drift test.
-- LIVE COUNTS BEFORE (read-only, 2026-10-12): prescription_renewal_requests 0 rows matter here (trigger only); second_opinion_credit
--   purchases 0; prescription_renewal_credit price 500,000 kobo, inactive (left closed).
-- ROLLBACK: restore the renewal trigger body from 20260831170433 and the public_price_list body from 20260902002938; update service_products set is_active = false where code =
--   'second_opinion_credit'; re-create the CHECK without the exemption; drop trigger service_purchases_second_opinion_members_only.

-- (a) renewals ---------------------------------------------------------------------------------------------------------
create or replace function private.enforce_prescription_renewal_entitlement_or_credit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.id := coalesce(new.id, gen_random_uuid());

  if not exists (
    select 1 from public.medications m
    where m.id = new.medication_id and m.patient_id = new.patient_id and m.is_active
  ) then
    raise exception 'that medication is not one of this patient''s active prescriptions';
  end if;

  if private.patient_is_member(new.patient_id) then
    -- Only the Member's OWN standalone request is closed. A row created by a doctor, staff member or a service job on the
    -- Member's behalf (auth.uid() is not the patient) is the monthly-review route itself and must be allowed.
    if (select auth.uid()) is not distinct from new.patient_id then
      raise exception 'Your doctor reviews renewals at your monthly call. You can add a note to your next review from the medicines screen.'
        using errcode = 'P0001', detail = 'RENEWAL_AT_MONTHLY_REVIEW';
    end if;
    return new;
  end if;

  -- not a Member: a credit already paid for is still honoured
  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, 'prescription_renewal_credit', 'prescription_renewal_request', new.id
    );
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Prescription renewals are part of Membership. Join to ask for one.'
        using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED';
    end if;
    raise;
  end;
  return new;
end $$;

-- (b) second opinion ----------------------------------------------------------------------------------------------------
alter table public.service_products drop constraint service_products_doctor_time_not_sellable;
alter table public.service_products add constraint service_products_doctor_time_not_sellable
  check (code !~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$|^ai_coach_daily_pass_30d$|^continuous_monitoring_)'
         or not is_active or code = 'second_opinion_credit');

-- second-opinion-price-begin (mirrored as commerce.second_opinion in packages/shared/src/proposed-config/registry.ts)
update public.service_products set price_kobo = 500000, is_active = true, updated_at = now() where code = 'second_opinion_credit';
-- second-opinion-price-end

-- The public price list (callable by anon, read by nothing on the marketing site any more) must never show the Members-only extra.
create or replace function public.public_price_list()
returns table (code text, currency public.currency, access_duration_days integer, price_minor bigint)
language sql stable security definer set search_path = '' as $$
  select p.code, p.currency, p.access_duration_days, p.price_kobo
  from public.service_products p
  where p.is_active and p.code <> 'second_opinion_credit';
$$;

create function private.second_opinion_members_only() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_code text; v_member boolean;
begin
  select p.code into v_code from public.service_products p where p.id = new.service_product_id;
  if v_code is distinct from 'second_opinion_credit' then return new; end if;
  begin
    v_member := coalesce(private.patient_is_member(new.patient_id), false);
  exception when others then
    v_member := false;   -- fail closed
  end;
  if not v_member then
    raise exception 'A second opinion is part of Membership. Join to add one.' using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED';
  end if;
  return new;
end $$;
revoke all on function private.second_opinion_members_only() from public, anon, authenticated;
create trigger service_purchases_second_opinion_members_only
  before insert on public.service_purchases
  for each row execute function private.second_opinion_members_only();

create or replace function public.record_service_purchase_intent(p_patient_id uuid, p_service_product_code text, p_scoped_entity_type text default null, p_scoped_entity_id uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
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

  -- the one doctor-time extra that is still sold is a Member's
  if v_product.code = 'second_opinion_credit' and not coalesce(private.patient_is_member(p_patient_id), false) then
    raise exception 'A second opinion is part of Membership. Join to add one.' using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED';
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
end $$;

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.service_products
   where is_active and code ~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$)'
     and code <> 'second_opinion_credit';
  if v_n <> 0 then raise exception 'two-tier: % other doctor-time products are for sale', v_n; end if;
  if (select price_kobo from public.service_products where code = 'second_opinion_credit') <> 500000
     or not (select is_active from public.service_products where code = 'second_opinion_credit') then
    raise exception 'two-tier: second opinion is not sold at 500,000 kobo';
  end if;
  begin
    update public.service_products set is_active = true where code = 'video_visit_credit';
    if found then raise exception 'two-tier: the constraint did not refuse re-enabling video_visit_credit'; end if;
  exception when check_violation then null;
  end;
end $$;
