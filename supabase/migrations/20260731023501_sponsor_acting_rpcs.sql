-- Two things a sponsor holding 'manage' can now do for the person they support.
--
-- Both replace work that would otherwise need a human doing legwork. The
-- founder confirmed on 2026-07-31 that there will be no dedicated per-patient
-- staff, so the coordinator jobs that software can genuinely do are done by
-- software, and the ones it cannot are not pretended at.

-- Book a self-bookable check for someone you manage, and settle it if the
-- wallet already covers it.
create or replace function public.sponsor_book_care(
  p_beneficiary uuid,
  p_bundle_code text,
  p_facility_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller   uuid := auth.uid();
  v_org      uuid;
  v_bundle   uuid;
  v_price    bigint;
  v_provider uuid;
  v_order    uuid;
  v_balance  bigint;
  v_paid     boolean := false;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to book care for this person'
      using errcode = '42501';
  end if;

  -- Only ever the self-bookable catalogue. This is the same narrow door the
  -- patient's own booking card uses, not a general ordering power: an ad hoc
  -- single test still requires a due screening or a clinician, and a sponsor
  -- must not become a way around that guardrail.
  select pb.id, pb.price_kobo into v_bundle, v_price
    from public.panel_bundles pb
   where pb.code = p_bundle_code and pb.self_bookable;
  if v_bundle is null then
    raise exception 'that check is not available to book directly' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation on file'; end if;

  if p_facility_id is not null then
    select f.lab_provider_id into v_provider
      from public.facilities f
     where f.id = p_facility_id and f.is_active;
  end if;

  -- The origin and region triggers still apply. A dark state raises here, which
  -- is correct: the order genuinely could not be fulfilled there.
  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin,
     panel_bundle_id, facility_id, provider_id)
  values
    (v_org, p_beneficiary, 'pending_payment', v_price, 'patient_initiated',
     v_bundle, p_facility_id, v_provider)
  returning id into v_order;

  select balance_kobo into v_balance
    from public.health_wallets where profile_id = p_beneficiary;

  -- Pay straight away when the money is already there, so "book it for her"
  -- really is one action. Short balance leaves a real pending order rather than
  -- failing, which the sponsor can then top up and settle.
  if coalesce(v_balance, 0) >= v_price then
    perform public.sponsor_pay_booking_order(p_beneficiary, 'lab', v_order);
    v_paid := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order,
    'paid', v_paid,
    'price_kobo', v_price,
    'shortfall_kobo', greatest(0, v_price - coalesce(v_balance, 0))
  );
end;
$$;

revoke all on function public.sponsor_book_care(uuid, text, uuid) from public;
revoke all on function public.sponsor_book_care(uuid, text, uuid) from anon;
grant execute on function public.sponsor_book_care(uuid, text, uuid) to authenticated;


-- Fill in the non-clinical basics for someone you manage, from your own device.
--
-- This is the answer to an elderly parent facing a multi-step wizard alone that
-- does NOT involve simplifying the product for everyone else and does NOT
-- involve putting a person on the phone: the adult child completes the boring
-- half from their own phone, on the parent's real account, and the parent is
-- left with only the part that has to be theirs.
--
-- Strictly bounded. Date of birth, sex and location only, all of which the
-- profiles_update RLS policy already lets the record owner change themselves.
-- It does NOT touch consent, which must remain the parent's own act, and it
-- does NOT touch onboarding_completed_at: private.enforce_onboarding_prereqs
-- still blocks that transition until consents exist. So this makes the parent's
-- remaining step shorter without making it skippable.
create or replace function public.sponsor_set_dependent_basics(
  p_beneficiary uuid,
  p_date_of_birth date default null,
  p_sex text default null,
  p_state text default null,
  p_city text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to update this person''s details'
      using errcode = '42501';
  end if;

  if p_sex is not null and p_sex not in ('male', 'female') then
    raise exception 'sex must be male or female';
  end if;

  -- coalesce throughout: a blank field means "leave it alone", never "erase it".
  update public.profiles
     set date_of_birth = coalesce(p_date_of_birth, date_of_birth),
         sex           = coalesce(p_sex::public.sex, sex),
         state         = coalesce(nullif(trim(p_state), ''), state),
         city          = coalesce(nullif(trim(p_city), ''), city)
   where id = p_beneficiary;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.sponsor_set_dependent_basics(uuid, date, text, text, text) from public;
revoke all on function public.sponsor_set_dependent_basics(uuid, date, text, text, text) from anon;
grant execute on function public.sponsor_set_dependent_basics(uuid, date, text, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sponsor_book_care(uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sponsor_set_dependent_basics(uuid,date,text,text,text)', 'EXECUTE') then
    raise exception 'anon must not be able to act on anyone''s behalf';
  end if;
end $$;
