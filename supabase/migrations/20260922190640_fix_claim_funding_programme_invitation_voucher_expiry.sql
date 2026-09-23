-- Fixes a real gap found by review: claim_funding_programme_invitation()
-- never set care_vouchers.expires_at, so an NGO-funded voucher was left
-- permanently non-expiring (expires_at nullable, redemption treats NULL as
-- "never expires") -- unlike every other prepaid_service voucher-creation
-- path on the platform (purchase_care_voucher, purchase_service_voucher),
-- all of which pull care_voucher_config.validity_months (24-month default)
-- and stamp now() + that interval. Same fix here, same pattern.
create or replace function public.claim_funding_programme_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.funding_programme_invitations%rowtype;
  v_programme public.funding_programmes%rowtype;
  v_product public.service_products%rowtype;
  v_beneficiary_org uuid;
  v_face_value_kobo bigint;
  v_claimed_count integer;
  v_voucher_id uuid;
  v_number text;
  v_months integer;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  select * into v_invite from public.funding_programme_invitations where invite_token = p_token;
  if not found then
    raise exception 'that invitation link is not valid' using errcode = '22023';
  end if;

  if v_invite.status <> 'invited' then
    raise exception 'that invitation has already been % — it cannot be claimed again', v_invite.status
      using errcode = '23514';
  end if;

  if v_invite.expires_at < now() then
    update public.funding_programme_invitations
       set status = 'expired', updated_at = now()
     where id = v_invite.id;
    raise exception 'that invitation has expired' using errcode = '23514';
  end if;

  select * into v_programme from public.funding_programmes where id = v_invite.funding_programme_id for update;
  if v_programme.status <> 'active' then
    raise exception 'this funded programme is not currently active' using errcode = '23514';
  end if;

  if v_programme.created_by is null then
    raise exception 'this funded programme has no attributable creator on record — contact support'
      using errcode = '23514';
  end if;

  select count(*) into v_claimed_count
    from public.funding_programme_invitations
   where funding_programme_id = v_programme.id and status = 'claimed';
  if v_claimed_count >= v_programme.funded_unit_cap then
    raise exception 'this funded programme has no remaining places' using errcode = '23514';
  end if;

  select organisation_id into v_beneficiary_org from public.profiles where id = v_caller;
  if v_beneficiary_org is null then
    raise exception 'your account has no organisation yet — finish signing up first' using errcode = '23514';
  end if;

  select * into v_product from public.service_products where id = v_programme.service_product_id;
  v_face_value_kobo := coalesce(v_programme.price_kobo, v_product.price_kobo);
  if v_face_value_kobo is null or v_face_value_kobo <= 0 then
    raise exception 'this funded programme has no valid price configured' using errcode = '23514';
  end if;

  select validity_months into v_months from public.care_voucher_config limit 1;

  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    service_product_id, sku_code, sku_name,
    face_value_kobo, amount_paid_kobo, status, activated_at, expires_at
  ) values (
    v_beneficiary_org, v_number, 'prepaid_service',
    v_caller, v_programme.created_by,
    v_product.id, v_product.code, v_product.name,
    v_face_value_kobo, v_face_value_kobo, 'active', now(),
    now() + make_interval(months => coalesce(v_months, 24))
  ) returning id into v_voucher_id;

  insert into public.care_voucher_events (organisation_id, voucher_id, event_type, actor_profile_id, note)
  select v_beneficiary_org, v_voucher_id, 'created', v_caller,
         'Funded by ' || org.name || ' (' || v_programme.name || ')'
  from public.organisations org where org.id = v_programme.organisation_id;

  update public.funding_programme_invitations
     set status = 'claimed',
         claimed_by_profile_id = v_caller,
         claimed_at = now(),
         care_voucher_id = v_voucher_id,
         updated_at = now()
   where id = v_invite.id;

  perform private.log_audit(
    'funding_programme_invitation.claimed', 'funding_programme_invitation', v_invite.id,
    jsonb_build_object('funding_programme_id', v_programme.id, 'voucher_id', v_voucher_id)
  );

  return jsonb_build_object(
    'ok', true,
    'voucher_id', v_voucher_id,
    'voucher_number', v_number,
    'sku_name', v_product.name,
    'face_value_kobo', v_face_value_kobo
  );
end;
$$;
