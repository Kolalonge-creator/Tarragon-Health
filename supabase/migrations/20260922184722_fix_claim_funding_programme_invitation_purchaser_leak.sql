-- Fixes a real leak found by packages/db/tests/ngo_funded_cohort.sql before
-- this module ever shipped: claim_funding_programme_invitation() set
-- care_vouchers.purchaser_profile_id to the inviting ngo_admin (needed only
-- to satisfy care_vouchers_kind_shape's NOT NULL requirement for a
-- prepaid_service voucher). care_vouchers_select's RLS then grants
-- "purchaser_profile_id = auth.uid()" — so the very NGO admin
-- private.is_org_staff() was correctly excluding could read the
-- beneficiary's voucher row (sku_name/sku_code: which service the
-- beneficiary is engaged in) through this OTHER clause of the same policy.
-- The is_org_staff exclusion was never broken; this was a second, unrelated
-- door into the same table that a same-value column choice opened.
--
-- Fix: attribute the voucher to the funding programme's own creator
-- (funding_programmes.created_by, always a superadmin — create_funding_
-- programme requires private.is_admin()) instead of the inviting ngo_admin.
-- This changes nothing observable: an admin already reads every care_voucher
-- via is_org_staff's own role = 'admin' clause, so naming an admin as
-- purchaser_profile_id grants that admin no access they didn't already have.
-- invited_by on funding_programme_invitations is untouched — it stays the
-- real inviting ngo_admin, which is fine: that column only ever surfaces
-- non-clinical roster/contact metadata to that same org's own ngo_admin,
-- never a care_vouchers row.
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

  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    service_product_id, sku_code, sku_name,
    face_value_kobo, amount_paid_kobo, status, activated_at
  ) values (
    v_beneficiary_org, v_number, 'prepaid_service',
    v_caller, v_programme.created_by,
    v_product.id, v_product.code, v_product.name,
    v_face_value_kobo, v_face_value_kobo, 'active', now()
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
