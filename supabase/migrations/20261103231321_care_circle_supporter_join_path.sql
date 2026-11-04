-- Care Circle supporter join path (family abroad, 2026-11-03).
--
-- Bodies below were restated from the LIVE definitions read on 2026-11-03 (pg_get_functiondef on koiplnmbgnqnbywhpjlf, SELECT only):
-- private.signup_permitted and private.signup_may_create_user matched 20261007233905 exactly.
--
-- 1. Invite-only sign-up let nobody in on the strength of a Care Circle invite, so a relative abroad who was invited by a patient
--    could not even create the account the invite needs. A contact (email, or the phone GoTrue itself holds) that has a valid pending
--    Care Circle invite may now sign up, ONLY as a supporter-only account (user metadata account_purpose = 'support'). The invite is
--    not consumed here: it is still accepted, by that contact, on the join page. Every other rule is unchanged.
-- 2. A sign-up that says account_purpose = 'support' is created supporter-only (receives_care = false) at the moment the profile row
--    is written, instead of waiting for the web's /auth/callback backfill (the phone app never ran that backfill, so a supporter who
--    signed up on the phone became a patient). This only ever narrows: becoming a patient later still needs every consent
--    (private.enforce_receives_care_switch is untouched).
-- 3. public.care_circle_invite_landing: the page a signed-out relative opens from the link. Service role only (the server calls it,
--    rate-limited per address, the same shape as payment_request_preview), it answers only for a valid, pending, unexpired invite and
--    says only the inviter's first name, what will be shared, and how the invite was sent (email or phone, with the masked hint the
--    patient already sees). Unknown, used, cancelled and expired tokens all get the same {ok: false}. It counts no attempt.
-- 4. public.care_circle_invite_status: for a SIGNED-IN person holding the link whose preview failed, one plain reason so the page can
--    say something kind and specific (sent to a different email or phone, expired, already in the circle). The token is 256 random
--    bits and the caller already holds it, so naming the state of that one invite tells nobody anything they could not see.
--    It counts no attempt and accepts nothing.
--
-- Not changed: private.is_org_staff, any RLS policy, private.circle_invite_for_caller, accept/preview/decline.

-- ---------------------------------------------------------------------------
-- 1. Sign-up carve-out
-- ---------------------------------------------------------------------------
create or replace function private.signup_circle_invite_ok(p_phone text, p_email text, p_meta jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_email text; v_phone text;
begin
  -- only a supporter-only sign-up: the invite is to follow someone's care, never to be treated here
  if coalesce(p_meta ->> 'account_purpose', '') <> 'support' then return false; end if;
  v_email := private.circle_normalise_contact('email', p_email);
  v_phone := private.signup_norm_phone(p_phone);
  v_phone := case when v_phone is null then null else private.circle_normalise_contact('phone', '+' || v_phone) end;
  if v_email is null and v_phone is null then return false; end if;
  return exists (
    select 1 from public.care_circle_invites i
     where i.state = 'pending' and i.expires_at > now()
       -- a test patient's invite never opens real sign-up
       and not coalesce(i.is_test, false)
       and i.attempts < coalesce((private.circle_rules() ->> 'max_attempts')::integer, 0)
       and ((i.invitee_kind = 'email' and v_email is not null and i.invitee_hash = private.circle_contact_hash(v_email))
         or (i.invitee_kind = 'phone' and v_phone is not null and i.invitee_hash = private.circle_contact_hash(v_phone))));
exception when others then
  -- fail closed (for example the contact pepper is missing): no carve-out, the ordinary rules still decide
  return false;
end $$;

create or replace function private.signup_permitted(p_phone text, p_email text, p_meta jsonb, p_app_meta jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if not coalesce(public.platform_switch_is_on('signup_invites_required'), false) then return true; end if;
  if private.go_live_guard_on('public_signup_enabled') then return true; end if;
  if coalesce(p_app_meta ->> 'signup_exempt', '') = 'true' then return true; end if;
  if private.signup_reservation_phone_ok(v_phone) then return true; end if;
  if private.signup_circle_invite_ok(v_phone, p_email, p_meta) then return true; end if;
  return private.signup_invite_find(v_phone, p_email, p_meta ->> 'invite_code') is not null;
end $$;

create or replace function private.signup_may_create_user(p_phone text, p_email text, p_meta jsonb, p_app_meta jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_phone text := nullif(btrim(coalesce(p_phone, '')), ''); v_id uuid; v_claimed uuid;
begin
  if not coalesce(public.platform_switch_is_on('signup_invites_required'), false) then return true; end if;
  if private.go_live_guard_on('public_signup_enabled') then return true; end if;
  if coalesce(p_app_meta ->> 'signup_exempt', '') = 'true' then return true; end if;
  if private.signup_reservation_phone_ok(v_phone) then return true; end if;
  -- a Care Circle invite is not consumed here: it is accepted later, on the join page, by the same contact
  if private.signup_circle_invite_ok(v_phone, p_email, p_meta) then return true; end if;
  v_id := private.signup_invite_find(v_phone, p_email, p_meta ->> 'invite_code');
  if v_id is null then return false; end if;
  update public.signup_invites set uses = uses + 1, last_used_at = now()
   where id = v_id and revoked_at is null and expires_at > now() and uses < max_uses
   returning id into v_claimed;
  return v_claimed is not null;
end $$;

-- The app's kind pre-check for a supporter sign-up (service role only, consumes nothing). A new function rather than an overload of
-- signup_gate_status, so no existing call can become ambiguous.
create or replace function public.signup_gate_status_supporter(p_phone text, p_email text, p_invite_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.signup_permitted(p_phone, p_email, jsonb_build_object('invite_code', p_invite_code, 'account_purpose', 'support'), '{}'::jsonb)
$$;

revoke all on function private.signup_circle_invite_ok(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.signup_permitted(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.signup_may_create_user(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.signup_may_create_user(text, text, jsonb, jsonb) to supabase_auth_admin;
revoke all on function public.signup_gate_status_supporter(text, text, text) from public, anon, authenticated;
grant execute on function public.signup_gate_status_supporter(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. A supporter sign-up is supporter-only from the first row
-- ---------------------------------------------------------------------------
create or replace function private.profiles_supporter_signup_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users u where u.id = new.id and coalesce(u.raw_user_meta_data ->> 'account_purpose', '') = 'support') then
    new.receives_care := false;
  end if;
  return new;
end $$;
revoke all on function private.profiles_supporter_signup_default() from public, anon, authenticated;

drop trigger if exists profiles_00_supporter_signup_default on public.profiles;
create trigger profiles_00_supporter_signup_default before insert on public.profiles
  for each row execute function private.profiles_supporter_signup_default();

-- ---------------------------------------------------------------------------
-- 3. The signed-out landing page
-- ---------------------------------------------------------------------------
create or replace function public.care_circle_invite_landing(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.care_circle_invites%rowtype; v_name text;
begin
  if p_token is null or char_length(p_token) not between 20 and 128 then return jsonb_build_object('ok', false); end if;
  select * into i from public.care_circle_invites where token_hash = private.circle_hash(p_token);
  if not found or i.state <> 'pending' or i.expires_at <= now()
     or i.attempts >= coalesce((private.circle_rules() ->> 'max_attempts')::integer, 0) then
    return jsonb_build_object('ok', false);
  end if;
  select split_part(btrim(full_name), ' ', 1) into v_name from public.profiles where id = i.patient_id and is_active;
  if not found then return jsonb_build_object('ok', false); end if;
  -- what they will be able to SEE; paying is confirmed on the signed-in screen (a supporter in another organisation never gets it)
  return jsonb_build_object('ok', true,
                            'inviter_first_name', coalesce(nullif(v_name, ''), 'Someone'),
                            'permissions', to_jsonb(array_remove(i.permissions, 'pay_for_care')),
                            'contact_kind', i.invitee_kind,
                            'contact_hint', i.invitee_hint);
end $$;
revoke all on function public.care_circle_invite_landing(text) from public, anon, authenticated;
grant execute on function public.care_circle_invite_landing(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Why the signed-in preview failed, for the person holding the link
-- ---------------------------------------------------------------------------
create or replace function public.care_circle_invite_status(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  i public.care_circle_invites%rowtype;
  v_uid uuid := (select auth.uid());
  me public.profiles%rowtype;
begin
  if v_uid is null then return jsonb_build_object('reason', 'not_found'); end if;
  if p_token is null or char_length(p_token) not between 20 and 128 then return jsonb_build_object('reason', 'not_found'); end if;
  select * into i from public.care_circle_invites where token_hash = private.circle_hash(p_token);
  if not found then return jsonb_build_object('reason', 'not_found'); end if;
  select * into me from public.profiles where id = v_uid;
  if not found or me.is_test is distinct from i.is_test then return jsonb_build_object('reason', 'not_found'); end if;
  if i.state = 'accepted' and i.accepted_by = v_uid then
    return jsonb_build_object('reason', 'already_member', 'patient_id', i.patient_id);
  end if;
  if v_uid = i.patient_id then return jsonb_build_object('reason', 'own_invite'); end if;
  if i.state = 'expired' or (i.state = 'pending' and i.expires_at <= now()) then return jsonb_build_object('reason', 'expired'); end if;
  if i.state <> 'pending' or i.attempts >= coalesce((private.circle_rules() ->> 'max_attempts')::integer, 0) then
    return jsonb_build_object('reason', 'no_longer_valid');
  end if;
  if not private.circle_caller_owns_contact(i.invitee_kind, i.invitee_hash) then
    return jsonb_build_object('reason', 'wrong_contact', 'contact_kind', i.invitee_kind, 'contact_hint', i.invitee_hint);
  end if;
  if me.organisation_id is distinct from i.organisation_id and me.receives_care is not false then
    return jsonb_build_object('reason', 'needs_supporter_account');
  end if;
  return jsonb_build_object('reason', 'not_available');
end $$;
revoke all on function public.care_circle_invite_status(text) from public, anon;
grant execute on function public.care_circle_invite_status(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.care_circle_invite_landing(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.care_circle_invite_landing(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.care_circle_invite_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.signup_gate_status_supporter(text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.signup_gate_status_supporter(text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.signup_circle_invite_ok(text, text, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.signup_circle_invite_ok(text, text, jsonb)', 'EXECUTE') then
    raise exception 'a supporter join function is reachable by a role that must not reach it';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'private.signup_may_create_user(text, text, jsonb, jsonb)', 'EXECUTE') then
    raise exception 'GoTrue lost the privilege the sign-up trigger needs';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'profiles_00_supporter_signup_default') then
    raise exception 'the supporter sign-up default trigger is missing';
  end if;
end $$;
