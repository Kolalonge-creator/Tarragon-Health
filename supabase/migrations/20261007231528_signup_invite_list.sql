-- Pilot signup invite list (OQ-184: public_signup_enabled could not be enforced because no allow-list existed and real people were signing up).
--
-- HOW IT WORKS. A new sign-up is checked as the row is created in auth.users (a BEFORE INSERT trigger that fires only for GoTrue's own role,
-- never for migrations, owner scripts or proofs). It is allowed when ANY of these holds:
--   1. the platform switch `signup_invites_required` is OFF (it ships OFF: applying this migration changes nothing for anyone), or the
--      go-live guard `public_signup_enabled` is ON (open to everyone);
--   2. an admin created the account through the admin API with app_metadata.signup_exempt = true (app metadata cannot be set by a visitor;
--      user metadata can, so a self-declared flag in user metadata is ignored);
--   3. the phone number has a sponsor-paid reservation waiting (sponsored_service_reservations status 'invited'): someone paid for care for
--      this person, so closing sign-up must never lock them out;
--   4. an unexpired, unused pilot invite matches the phone number or the email address, or the visitor gives a valid invite code.
-- A code or identifier invite is consumed atomically in the same transaction as the sign-up (two people cannot both use a single-use invite;
-- a failed sign-up rolls the use back). Codes are stored only as a SHA-256 hash and shown once when created.
-- To close public sign-up on purpose: add the invites you want, then set the switch on (public.set_platform_switch). To open it again, switch it
-- off, or switch the guard public_signup_enabled on.
-- Counts at write time: 4 real patients, 0 invites, so nothing is converted.

insert into public.platform_switches (key, label, description, is_on, readable_by_anon) values
  ('signup_invites_required', 'Invite-only sign-up',
   'When on and the public sign-up guard is off, a new person can sign up only with a pilot invite (phone, email or code), a sponsor-paid phone number, or an admin-created account. Off means anyone can sign up as today.',
   false, true)
on conflict (key) do nothing;

create table public.signup_invites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  kind text not null check (kind in ('phone', 'email', 'code')),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  code_hash text check (code_hash is null or length(code_hash) = 64),
  label text not null check (length(btrim(label)) >= 3),
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (kind = 'phone' and phone is not null and email is null and code_hash is null)
    or (kind = 'email' and email is not null and phone is null and code_hash is null)
    or (kind = 'code' and code_hash is not null and phone is null and email is null)
  ),
  check (uses <= max_uses)
);
create unique index signup_invites_phone_live on public.signup_invites (phone) where kind = 'phone' and revoked_at is null;
create unique index signup_invites_email_live on public.signup_invites (lower(email)) where kind = 'email' and revoked_at is null;
create unique index signup_invites_code_hash on public.signup_invites (code_hash) where kind = 'code';
alter table public.signup_invites enable row level security;
revoke all on public.signup_invites from anon, authenticated;
comment on table public.signup_invites is 'Pilot sign-up invites. No direct access: admins use the functions below. A code is stored as a hash and never readable.';

create or replace function private.signup_norm_phone(p text) returns text
language sql immutable set search_path = '' as $$ select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;

create or replace function private.signup_code_hash(p text) returns text
language sql immutable set search_path = '' as $$ select encode(extensions.digest(upper(btrim(coalesce(p, ''))), 'sha256'), 'hex') $$;

-- The one usable invite for this person, or null. Read-only: it never consumes.
create or replace function private.signup_invite_find(p_phone text, p_email text, p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select i.id from public.signup_invites i
  where i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses
    and (
      (i.kind = 'phone' and private.signup_norm_phone(p_phone) is not null and private.signup_norm_phone(i.phone) = private.signup_norm_phone(p_phone))
      or (i.kind = 'email' and nullif(btrim(coalesce(p_email, '')), '') is not null and lower(i.email) = lower(btrim(p_email)))
      or (i.kind = 'code' and nullif(btrim(coalesce(p_code, '')), '') is not null and i.code_hash = private.signup_code_hash(p_code))
    )
  order by case i.kind when 'phone' then 0 when 'email' then 1 else 2 end, i.expires_at
  limit 1
$$;

create or replace function private.signup_reservation_phone_ok(p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.signup_norm_phone(p_phone) is not null and exists (
    select 1 from public.sponsored_service_reservations r
    where r.status = 'invited' and private.signup_norm_phone(r.recipient_phone) = private.signup_norm_phone(p_phone))
$$;

-- Would this person be allowed to sign up right now? Read-only; used by the app to say so kindly before it asks GoTrue.
create or replace function private.signup_permitted(p_phone text, p_email text, p_meta jsonb, p_app_meta jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_phone text := coalesce(nullif(btrim(coalesce(p_phone, '')), ''), p_meta ->> 'phone');
begin
  if not coalesce(public.platform_switch_is_on('signup_invites_required'), false) then return true; end if;
  if private.go_live_guard_on('public_signup_enabled') then return true; end if;
  if coalesce(p_app_meta ->> 'signup_exempt', '') = 'true' then return true; end if;
  if private.signup_reservation_phone_ok(v_phone) then return true; end if;
  return private.signup_invite_find(v_phone, p_email, p_meta ->> 'invite_code') is not null;
end $$;

-- The same decision, but it consumes the invite it relied on (atomically). Only the trigger calls this.
create or replace function private.signup_may_create_user(p_phone text, p_email text, p_meta jsonb, p_app_meta jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_phone text := coalesce(nullif(btrim(coalesce(p_phone, '')), ''), p_meta ->> 'phone'); v_id uuid; v_claimed uuid;
begin
  if not coalesce(public.platform_switch_is_on('signup_invites_required'), false) then return true; end if;
  if private.go_live_guard_on('public_signup_enabled') then return true; end if;
  if coalesce(p_app_meta ->> 'signup_exempt', '') = 'true' then return true; end if;
  if private.signup_reservation_phone_ok(v_phone) then return true; end if;
  v_id := private.signup_invite_find(v_phone, p_email, p_meta ->> 'invite_code');
  if v_id is null then return false; end if;
  update public.signup_invites set uses = uses + 1, last_used_at = now()
   where id = v_id and revoked_at is null and expires_at > now() and uses < max_uses
   returning id into v_claimed;
  return v_claimed is not null;
end $$;

-- Whether the gate applies to this insert: GoTrue's own role, or a transaction-local test setting. The setting can only ever make the gate
-- STRICTER (it exists so a database proof, which cannot impersonate GoTrue's role, can exercise the real trigger); it can never loosen it.
create or replace function private.signup_gate_applies() returns boolean
language sql stable set search_path = '' as $$
  select current_user = 'supabase_auth_admin' or coalesce(current_setting('tarragon.signup_gate_test', true), '') = 'on'
$$;

create or replace function private.enforce_signup_invite() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- only GoTrue creating a user is checked: migrations, owner scripts, the SQL editor and database proofs are not a visitor signing up
  if not private.signup_gate_applies() then return new; end if;
  if not private.signup_may_create_user(new.phone, new.email, coalesce(new.raw_user_meta_data, '{}'::jsonb), coalesce(new.raw_app_meta_data, '{}'::jsonb)) then
    raise exception 'signup_invite_required' using errcode = 'P0001', hint = 'Sign-up is by invitation for now.';
  end if;
  return new;
end $$;

drop trigger if exists auth_users_enforce_signup_invite on auth.users;
create trigger auth_users_enforce_signup_invite before insert on auth.users
  for each row execute function private.enforce_signup_invite();

revoke all on function private.signup_norm_phone(text), private.signup_code_hash(text), private.signup_invite_find(text, text, text),
  private.signup_reservation_phone_ok(text), private.signup_permitted(text, text, jsonb, jsonb), private.signup_may_create_user(text, text, jsonb, jsonb),
  private.enforce_signup_invite(), private.signup_gate_applies() from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.signup_norm_phone(text), private.signup_code_hash(text), private.signup_may_create_user(text, text, jsonb, jsonb),
  private.signup_invite_find(text, text, text), private.signup_reservation_phone_ok(text), private.enforce_signup_invite(), private.signup_gate_applies() to supabase_auth_admin;
grant execute on function public.platform_switch_is_on(text) to supabase_auth_admin;
grant execute on function private.go_live_guard_on(text) to supabase_auth_admin;

-- Admin functions
create or replace function public.create_signup_invite(p_kind text, p_value text, p_label text, p_max_uses integer default 1, p_days integer default 30)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid()); v_org uuid; v_id uuid; v_code text; v_phone text; v_email text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_bytes bytea; v_i integer;
begin
  if not private.is_admin() then raise exception 'not authorised: only an admin manages sign-up invites' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_actor;
  if v_org is null then raise exception 'the acting profile has no organisation'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'an invite must last between 1 and 365 days'; end if;
  if p_kind = 'phone' then v_phone := btrim(p_value);
  elsif p_kind = 'email' then v_email := lower(btrim(p_value));
  elsif p_kind = 'code' then
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    for v_i in 0..9 loop v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_i) % 32) + 1, 1); end loop;
  else raise exception 'kind must be phone, email or code'; end if;
  insert into public.signup_invites (organisation_id, kind, phone, email, code_hash, label, max_uses, expires_at, created_by)
  values (v_org, p_kind, v_phone, v_email, case when p_kind = 'code' then private.signup_code_hash(v_code) end, btrim(p_label),
          case when p_kind = 'code' then greatest(coalesce(p_max_uses, 1), 1) else 1 end, now() + make_interval(days => p_days), v_actor)
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (v_actor, 'signup_invite.created', 'signup_invites', v_id, jsonb_build_object('kind', p_kind, 'label', btrim(p_label), 'days', p_days));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create or replace function public.revoke_signup_invite(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  update public.signup_invites set revoked_at = now() where id = p_id and revoked_at is null;
  if not found then raise exception 'invite not found or already revoked'; end if;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (v_actor, 'signup_invite.revoked', 'signup_invites', p_id, '{}'::jsonb);
end $$;

create or replace function public.signup_invites_list()
returns table (id uuid, kind text, identifier text, label text, uses integer, max_uses integer, expires_at timestamptz, revoked_at timestamptz, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  return query
  select i.id, i.kind, coalesce(i.phone, i.email, 'invite code'), i.label, i.uses, i.max_uses, i.expires_at, i.revoked_at,
         case when i.revoked_at is not null then 'revoked' when i.uses >= i.max_uses then 'used' when i.expires_at <= now() then 'expired' else 'open' end,
         i.created_at
  from public.signup_invites i order by i.created_at desc;
end $$;

-- The app's kind pre-check (called by the server with the service role). Answers only yes or no and consumes nothing.
create or replace function public.signup_gate_status(p_phone text, p_email text, p_invite_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.signup_permitted(p_phone, p_email, jsonb_build_object('invite_code', p_invite_code), '{}'::jsonb)
$$;

revoke execute on function public.create_signup_invite(text, text, text, integer, integer), public.revoke_signup_invite(uuid),
  public.signup_invites_list(), public.signup_gate_status(text, text, text) from public, anon;
grant execute on function public.create_signup_invite(text, text, text, integer, integer), public.revoke_signup_invite(uuid), public.signup_invites_list() to authenticated;
grant execute on function public.signup_gate_status(text, text, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.create_signup_invite(text, text, text, integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.signup_gate_status(text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.signup_gate_status(text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.signup_may_create_user(text, text, jsonb, jsonb)', 'EXECUTE') then
    raise exception 'the signup invite functions must not be reachable by anon (or the gate check by signed-in users)';
  end if;
  if public.platform_switch_is_on('signup_invites_required') then raise exception 'the invite-only switch must ship off'; end if;
end $$;
