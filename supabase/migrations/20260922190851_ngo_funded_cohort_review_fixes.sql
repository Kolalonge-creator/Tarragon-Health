-- Four real findings from review, fixed together:
--
-- 1. TOCTOU on the invitation row: claim_funding_programme_invitation read
--    the invitation with a plain SELECT (no lock), so two concurrent claims
--    of the SAME token could both pass the "status = 'invited'" check before
--    either committed -- they only serialized on the funding_programmes
--    lock, and the cap check counts claimed invitation ROWS (still 1 either
--    way), so both could insert a care_voucher, exceeding funded_unit_cap
--    and orphaning one voucher's linkage. Fixed by taking `for update` on
--    the invitation row itself: a blocked, then-unblocked SELECT FOR UPDATE
--    re-reads the committed row, so the second transaction correctly sees
--    status = 'claimed' and refuses.
-- 2. No identity binding between the invited contact and the claiming
--    account, and invite_token is plainly readable by the owning org's own
--    ngo_admin via funding_programme_invitations_select's ordinary RLS grant
--    (needed so the token can actually be delivered to the beneficiary until
--    a real send mechanism exists) -- meaning that same ngo_admin, or anyone
--    else who obtains the token, could call this RPC as themselves and
--    become beneficiary_profile_id, diverting the funded place away from the
--    person it was meant for. Fixed by requiring the caller's own phone
--    (profiles.phone) or email (auth.users.email) to match whichever of the
--    invitation's own phone/email fields is set.
-- 3. revoke_funding_programme_invitation and set_funding_programme_status
--    never called private.assert_module_enabled('ngo_funded_cohort'), unlike
--    the other three RPCs in this module -- so a superadmin could still
--    activate/revoke through them even with the module switched off,
--    contradicting the module's own "every RPC refuses while dormant"
--    invariant. Both now gate on the module like their siblings.
-- 4. create_funding_programme never checked the funded service_product's
--    currency. care_vouchers has no currency column at all -- face_value_kobo
--    is implicitly NGN-only, which is exactly why purchase_service_voucher()
--    rejects a non-NGN product. Without this check, a programme could be
--    created against a USD-priced (diaspora) SKU, and claim_funding_
--    programme_invitation would silently store the raw USD number into
--    face_value_kobo as if it were kobo -- a ~1000x currency mislabelling.
--    Now rejected at programme-creation time, the same point
--    purchase_service_voucher checks it.

create or replace function public.create_funding_programme(
  p_organisation_id uuid,
  p_service_product_id uuid,
  p_name text,
  p_contract_reference text,
  p_funded_unit_cap integer,
  p_price_kobo bigint default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_product public.service_products%rowtype;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin can create a funding programme' using errcode = '42501';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  if not exists (
    select 1 from public.organisations where id = p_organisation_id and type = 'ngo'
  ) then
    raise exception 'organisation % is not an NGO-type organisation', p_organisation_id
      using errcode = '23514';
  end if;

  select * into v_product from public.service_products where id = p_service_product_id and is_active;
  if not found then
    raise exception 'service product % is not an active catalogue item', p_service_product_id
      using errcode = '23514';
  end if;
  if v_product.currency <> 'NGN' then
    raise exception 'funded programmes only support naira-priced services — care_vouchers has no currency column'
      using errcode = '23514';
  end if;

  insert into public.funding_programmes (
    organisation_id, service_product_id, name, contract_reference,
    funded_unit_cap, price_kobo, starts_at, ends_at, created_by
  ) values (
    p_organisation_id, p_service_product_id, trim(p_name), trim(p_contract_reference),
    p_funded_unit_cap, p_price_kobo, p_starts_at, p_ends_at, (select auth.uid())
  ) returning id into v_id;

  perform private.log_audit(
    'funding_programme.created', 'funding_programme', v_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'funded_unit_cap', p_funded_unit_cap)
  );

  return v_id;
end;
$$;

create or replace function public.set_funding_programme_status(
  p_programme_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.funding_programmes%rowtype;
  v_new_status public.funding_programme_status;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin can change a funding programme''s status' using errcode = '42501';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  select * into v_programme from public.funding_programmes where id = p_programme_id for update;
  if not found then
    raise exception 'no such funding programme' using errcode = '22023';
  end if;

  v_new_status := p_status::public.funding_programme_status;

  if v_programme.status = 'draft' and v_new_status <> 'active' then
    raise exception 'a draft programme can only move to active' using errcode = '23514';
  elsif v_programme.status = 'active' and v_new_status not in ('expired', 'cancelled') then
    raise exception 'an active programme can only move to expired or cancelled' using errcode = '23514';
  elsif v_programme.status in ('expired', 'cancelled') then
    raise exception 'a % programme cannot change status', v_programme.status using errcode = '23514';
  end if;

  update public.funding_programmes
     set status = v_new_status, updated_at = now()
   where id = p_programme_id;

  perform private.log_audit(
    'funding_programme.status_changed', 'funding_programme', p_programme_id,
    jsonb_build_object('from', v_programme.status, 'to', v_new_status, 'note', p_note)
  );
end;
$$;

create or replace function public.revoke_funding_programme_invitation(
  p_invitation_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_invite public.funding_programme_invitations%rowtype;
  v_programme public.funding_programmes%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  select * into v_invite from public.funding_programme_invitations where id = p_invitation_id;
  if not found then
    raise exception 'no such invitation' using errcode = '22023';
  end if;

  select * into v_programme from public.funding_programmes where id = v_invite.funding_programme_id;

  if not (
    private.is_admin()
    or exists (
      select 1 from public.profiles
      where id = v_caller and role = 'ngo_admin' and organisation_id = v_programme.organisation_id
    )
  ) then
    raise exception 'you are not authorised to revoke this invitation' using errcode = '42501';
  end if;

  if v_invite.status <> 'invited' then
    raise exception 'only a pending invitation can be revoked' using errcode = '23514';
  end if;

  update public.funding_programme_invitations
     set status = 'revoked', revoked_at = now(), revoked_reason = p_reason, updated_at = now()
   where id = p_invitation_id;

  perform private.log_audit(
    'funding_programme_invitation.revoked', 'funding_programme_invitation', p_invitation_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

create or replace function public.claim_funding_programme_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_phone text;
  v_caller_email text;
  v_invite public.funding_programme_invitations%rowtype;
  v_programme public.funding_programmes%rowtype;
  v_product public.service_products%rowtype;
  v_beneficiary_org uuid;
  v_face_value_kobo bigint;
  v_claimed_count integer;
  v_voucher_id uuid;
  v_number text;
  v_months integer;
  v_identity_matches boolean;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  perform private.assert_module_enabled('ngo_funded_cohort');

  -- `for update` here (not just on funding_programmes below) is what closes
  -- the double-claim race: a second concurrent call blocks on this exact
  -- row, and once unblocked by the first call's commit, re-reads the now-
  -- 'claimed' row rather than a stale pre-commit snapshot.
  select * into v_invite from public.funding_programme_invitations where invite_token = p_token for update;
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

  -- The invitation names a specific person by phone and/or email. Anyone who
  -- can read invite_token (including the inviting ngo_admin — see this
  -- migration's header) must not be able to claim it as themselves; the
  -- claiming account must match at least one of the invitation's own
  -- contact fields.
  select phone into v_caller_phone from public.profiles where id = v_caller;
  select email into v_caller_email from auth.users where id = v_caller;

  v_identity_matches := (
    (v_invite.phone is not null and v_invite.phone = v_caller_phone)
    or (v_invite.email is not null and lower(trim(v_invite.email)) = lower(trim(coalesce(v_caller_email, ''))))
  );
  if not v_identity_matches then
    raise exception 'this invitation was sent to a different phone number or email — sign in with the account that matches it'
      using errcode = '42501';
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
