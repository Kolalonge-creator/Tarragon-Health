-- S03b-b (v5 1.6, answers OQ-43): accounts that survive a lost number.
-- Design: docs/design/S03b.md. Founder decisions 2026-10-13: backup codes, a Care Circle recovery contact, a self-serve
-- change-number flow with extra friction after a recent change. NOT built (founder said no): voice-call OTP, a delivery-status
-- table, a per-profile PIN, a restricted new-device state. SMS stays code-only (INV-08): nothing here sends an SMS, and every
-- notice goes in-app and by email only. Nothing here is needed for core access: the email link route is untouched.
--
-- Counted live 2026-10-13: 12 auth users, 0 with a phone number, 7 patient profiles, 0 care circle recovery rows (the table is new).
-- Nothing to convert.
--
-- WHAT THIS ADDS
--   1. account_recovery_config (versioned, PROPOSED, mirrored as auth.recovery_rules in packages/shared/src/proposed-config).
--   2. Backup codes: ten single-use codes, made in the database, returned ONCE, stored only as an HMAC under a Vault secret.
--      Regenerating deletes the old set. Redeeming is service-role only (the web server action and the mobile API route), is
--      throttled per account, and answers the same way for every failure.
--   3. A recovery contact: ONE confirmed Care Circle member (care_circle_members, reused, no parallel contact list) who agrees to
--      help. Recovery needs the contact to confirm in their own signed-in session, then a wait, and then a one-time link goes to
--      the PATIENT's own verified email (or a code to their verified phone), never to the contact.
--   4. A change-number gate: the sign-in number cannot be changed (not even by a direct call to Auth) until the owner has proved
--      control of the OLD number or a VERIFIED email in the last 15 minutes. A BEFORE UPDATE trigger on auth.users enforces it,
--      because a check that lives only in a Next.js action is bypassed by anyone holding an access token.
--   5. Friction after a recent number change (OQ-43): recovery by a code to the phone is paused for 72 hours after the number
--      moved, unless the recovery contact route has released the account. The pause is enforced by OUR apps (web and phone), not by
--      Auth: someone who calls Auth directly with a code is not stopped by it, and signing in by code is not paused (OQ-S03B-06).
--   5b. A password step-up before backup codes can be made or a recovery contact named, so a borrowed session cannot plant a way
--      back in that outlives it.
--   6. The owner is told (in-app and email, never SMS) about every one of these steps.

-- ---------------------------------------------------------------------------
-- 1. Config
-- ---------------------------------------------------------------------------
create table public.account_recovery_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index account_recovery_config_one_active on public.account_recovery_config (is_active) where is_active;

create function private.account_recovery_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  -- every key must be a positive whole number; a missing or odd one would make a comparison null and quietly lift a limit
  foreach k in array array['backup_code_count', 'backup_code_regenerations_per_day', 'backup_code_attempts_per_hour',
                           'contact_delay_hours', 'contact_request_hours', 'contact_release_hours', 'contact_requests_per_week',
                           'number_change_hold_hours', 'number_change_confirm_minutes', 'step_up_minutes'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,4}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'backup_code_count')::integer between 5 and 20
     and (r ->> 'contact_delay_hours')::integer >= 1
     and (r ->> 'number_change_confirm_minutes')::integer <= 60
     and (r ->> 'step_up_minutes')::integer <= 60;
exception when others then
  return false;
end;
$$;
revoke all on function private.account_recovery_rules_valid(jsonb) from public, anon, authenticated;
alter table public.account_recovery_config add constraint account_recovery_config_rules_valid check (private.account_recovery_rules_valid(rules));

-- account-recovery-rules-begin
insert into public.account_recovery_config (version, is_active, effective_from, rules) values (1, true, '2026-10-13', $json$
{
  "backup_code_count": 10,
  "backup_code_regenerations_per_day": 3,
  "backup_code_attempts_per_hour": 10,
  "contact_delay_hours": 24,
  "contact_request_hours": 48,
  "contact_release_hours": 48,
  "contact_requests_per_week": 2,
  "number_change_hold_hours": 72,
  "number_change_confirm_minutes": 15,
  "step_up_minutes": 10
}
$json$::jsonb);
-- account-recovery-rules-end

alter table public.account_recovery_config enable row level security;
revoke all on public.account_recovery_config from public, anon, authenticated;

create function private.recovery_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.account_recovery_config where is_active $$;
revoke all on function private.recovery_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers (not callable by any application role)
-- ---------------------------------------------------------------------------
-- The pepper lives in Supabase Vault (encrypted with a key held outside the database), created here, random per environment.
-- A backup code has about 50 bits of entropy; the HMAC under a secret that a table dump does not contain means a leaked table
-- cannot be ground offline.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'account_backup_code_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'account_backup_code_pepper',
                                'HMAC key for account backup code hashes (S03b). Rotating it makes every issued backup code unusable.');
  end if;
end $$;

create function private.backup_code_normalise(p text) returns text
language sql immutable set search_path = ''
as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;
revoke all on function private.backup_code_normalise(text) from public, anon, authenticated;

create function private.backup_code_hash(p_code text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'account_backup_code_pepper';
  -- fail closed: without the secret there is no safe way to hash a code, so none is made or matched
  if k is null or k = '' then raise exception 'backup_codes_not_configured' using errcode = 'P0001'; end if;
  return encode(extensions.hmac(private.backup_code_normalise(p_code), k, 'sha256'), 'hex');
end;
$$;
revoke all on function private.backup_code_hash(text) from public, anon, authenticated;

-- A confirmed email or phone to an auth user id. Only a VERIFIED channel identifies an account for recovery.
create function private.recovery_find_user(p_kind text, p_identifier text) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v text; v_id uuid;
begin
  if p_kind = 'email' then
    v := private.circle_normalise_contact('email', p_identifier);
    if v is null then return null; end if;
    select u.id into v_id from auth.users u where lower(u.email) = v and u.email_confirmed_at is not null limit 1;
  elsif p_kind = 'phone' then
    v := private.circle_normalise_contact('phone', p_identifier);
    if v is null then return null; end if;
    select u.id into v_id from auth.users u where u.phone in (v, ltrim(v, '+')) and u.phone_confirmed_at is not null limit 1;
  end if;
  return v_id;
end;
$$;
revoke all on function private.recovery_find_user(text, text) from public, anon, authenticated;

create function private.recovery_audit(p_org uuid, p_actor uuid, p_action text, p_entity text, p_entity_id uuid, p_subject uuid,
                                       p_result text, p_event jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- audit_log is readable by every org staff account, so nothing secret, no code, no number and no address goes in the event.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id, ip)
  values (p_org, p_actor, p_action, p_entity, p_entity_id, coalesce(p_event, '{}'::jsonb), p_result, p_subject, private.request_ip());
end;
$$;
revoke all on function private.recovery_audit(uuid, uuid, text, text, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Neutral wording (INV-07). In-app always, email only to a VERIFIED address, never SMS (INV-08). Returns the channels queued so a
-- caller can record that no notice could be queued. p_email false makes it in-app only (for the contact's side).
-- priority is 'routine' ON PURPOSE: private.escalate_unconfirmed_critical_notifications() picks up every 'critical' row that is sent
-- and unopened and re-sends it on push, then email, then SMS. These notices must never be texted (INV-08), and a "number changed"
-- notice texted to the new number would reach exactly the person it warns about. (The older security.new_device_signin and
-- security.assisted_recovery_* notices are 'critical' and do escalate to SMS: OQ-S03B-02.) The email row is not held back by quiet
-- hours because it carries payload.to_email.
create function private.recovery_notice(p_user uuid, p_template text, p_message text, p_email boolean default true) returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_email text;
  v_channels text[] := '{}';
begin
  select organisation_id into v_org from public.profiles where id = p_user;
  if v_org is null then return v_channels; end if;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
  values (v_org, p_user, 'in_app', 'pending', p_template, jsonb_build_object('message', p_message, 'occurred_at', now()), 'non_clinical', 'routine');
  v_channels := array_append(v_channels, 'in_app'::text);
  if p_email then
    select u.email into v_email from auth.users u where u.id = p_user and u.email_confirmed_at is not null;
    if v_email is not null and btrim(v_email) <> '' then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
      -- the dispatcher sends an email row only when payload.to_email names the address; without it the row fails as "recipient has no email address"
      values (v_org, p_user, 'email', 'pending', p_template, jsonb_build_object('message', p_message, 'occurred_at', now(), 'to_email', v_email), 'non_clinical', 'routine');
      v_channels := array_append(v_channels, 'email'::text);
    end if;
  end if;
  return v_channels;
end;
$$;
revoke all on function private.recovery_notice(uuid, text, text, boolean) from public, anon, authenticated;

-- When did the sign-in number actually move? Written by the trigger on auth.users below, whoever moved it (the owner, a direct call
-- to Auth, assisted recovery). NOT derived from auth.users.phone_confirmed_at: GoTrue re-stamps that on every successful SMS code
-- (a normal sign-in by code included), so as a "number changed" signal it is true for almost everyone right after they prove a code,
-- which is exactly when the pause is asked. (Assisted recovery's own SIM-swap flag still reads that column: OQ-S03B-02.)
create table public.account_phone_changes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  changed_at timestamptz not null default now()
);
create index account_phone_changes_user_idx on public.account_phone_changes (user_id, changed_at desc);
alter table public.account_phone_changes enable row level security;
revoke all on public.account_phone_changes from public, anon, authenticated;

-- Did the sign-in number move in the last N hours?
create function private.number_changed_recently(p_user uuid, p_hours integer) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.account_phone_changes c where c.user_id = p_user and c.changed_at > now() - make_interval(hours => p_hours))
$$;
revoke all on function private.number_changed_recently(uuid, integer) from public, anon, authenticated;

-- A short step-up before the two actions that create a way back into the account later (making backup codes, naming a recovery
-- contact). A session alone (a borrowed phone, a stolen access token, a SIM-swap code login) must not be able to plant a way back in
-- that outlives it. The server records a step-up only after it checked the account PASSWORD; the two functions below refuse without a
-- fresh one and spend it. Same shape as the change-number gate: earned in the server, enforced in the database.
create table public.account_step_ups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- bound to the SESSION that typed the password (the session_id claim of its access token): a second access token for the same
  -- account (a borrowed device, a stolen token) cannot spend it
  session_id  text not null check (char_length(session_id) between 8 and 64),
  purpose     text not null check (purpose in ('backup_codes', 'recovery_contact')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index account_step_ups_user_idx on public.account_step_ups (user_id, purpose, created_at desc);
alter table public.account_step_ups enable row level security;
revoke all on public.account_step_ups from public, anon, authenticated;

create function public.record_step_up(p_user uuid, p_purpose text, p_session text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_purpose not in ('backup_codes', 'recovery_contact') then raise exception 'unknown purpose' using errcode = '22023'; end if;
  if p_session is null or char_length(p_session) not between 8 and 64 then return false; end if;
  if not exists (select 1 from public.profiles where id = p_user and role = 'patient' and is_active) then return false; end if;
  -- spent and expired rows are not kept
  delete from public.account_step_ups where user_id = p_user and (consumed_at is not null or expires_at < now() - interval '1 day' or (purpose = p_purpose and session_id = p_session));
  insert into public.account_step_ups (user_id, session_id, purpose, expires_at)
  values (p_user, p_session, p_purpose, now() + make_interval(mins => (private.recovery_rules() ->> 'step_up_minutes')::integer));
  return true;
end;
$$;

-- Spends a fresh step-up for the caller or refuses.
create function private.consume_step_up(p_user uuid, p_purpose text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select id into v_id from public.account_step_ups
   where user_id = p_user and purpose = p_purpose and consumed_at is null and expires_at > now()
     and session_id = coalesce((select auth.jwt()) ->> 'session_id', '')
   order by created_at desc limit 1 for update;
  if v_id is null then raise exception 'step_up_required' using errcode = 'P0001'; end if;
  update public.account_step_ups set consumed_at = now() where id = v_id;
end;
$$;
revoke all on function private.consume_step_up(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backup codes
-- ---------------------------------------------------------------------------
create table public.account_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  batch_id   uuid not null,
  code_hash  text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  unique (user_id, code_hash)
);
create index account_backup_codes_user_idx on public.account_backup_codes (user_id) where used_at is null;
alter table public.account_backup_codes enable row level security;
-- No policy and no grant: the table is reachable only through the SECURITY DEFINER functions below.
revoke all on public.account_backup_codes from public, anon, authenticated;

create table public.account_backup_code_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index account_backup_code_attempts_idx on public.account_backup_code_attempts (user_id, at desc);
alter table public.account_backup_code_attempts enable row level security;
revoke all on public.account_backup_code_attempts from public, anon, authenticated;

-- Ten codes, shown once. Calling it again deletes the old set (invalidated at once) and returns a fresh one.
create function public.generate_backup_codes() returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_rules jsonb := private.recovery_rules();
  v_n     integer := (v_rules ->> 'backup_code_count')::integer;
  v_org   uuid;
  v_batch uuid := gen_random_uuid();
  v_codes text[] := '{}';
  v_code  text;
  v_bytes bytea;
  v_i     integer;
  v_try   integer := 0;
  v_ch    text[];
begin
  if v_uid is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient' and is_active;
  if v_org is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  -- the account password was checked by the server a moment ago (public.record_step_up); a session alone is not enough
  perform private.consume_step_up(v_uid, 'backup_codes');
  if (select count(*) from public.audit_log where actor_id = v_uid and action = 'account.backup_codes_generated'
                                              and created_at > now() - interval '24 hours')
       >= (v_rules ->> 'backup_code_regenerations_per_day')::integer then
    raise exception 'backup_codes_rate_limited' using errcode = 'P0001';
  end if;

  delete from public.account_backup_codes where user_id = v_uid;
  while cardinality(v_codes) < v_n loop
    v_try := v_try + 1;
    if v_try > 200 then raise exception 'backup_codes_generation_failed' using errcode = 'P0001'; end if;
    v_bytes := extensions.gen_random_bytes(10);
    v_code := '';
    -- 32 symbols, no 0 O 1 I; 256 is a multiple of 32 so the byte-to-symbol map is unbiased
    for v_i in 0..9 loop
      v_code := v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(v_bytes, v_i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.account_backup_codes (user_id, batch_id, code_hash) values (v_uid, v_batch, private.backup_code_hash(v_code));
      v_codes := array_append(v_codes, left(v_code, 5) || '-' || right(v_code, 5));
    exception when unique_violation then
      null;   -- a 1-in-10^15 collision: draw again
    end;
  end loop;

  v_ch := private.recovery_notice(v_uid, 'security.backup_codes_generated',
    'New backup codes were created for your Tarragon Health account, and any older ones stopped working. If this was not you, change your password now and tell your care team.');
  perform private.recovery_audit(v_org, v_uid, 'account.backup_codes_generated', 'account_backup_codes', null, v_uid, 'success',
    jsonb_build_object('count', v_n, 'notice_channels', to_jsonb(v_ch)));
  return v_codes;
end;
$$;

create function public.my_backup_code_status() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'remaining', count(*) filter (where used_at is null),
    'generated_at', max(created_at))
    from public.account_backup_codes where user_id = (select auth.uid())
$$;

-- Service role only (the web server action and the mobile API route call it; no signed-in session exists yet).
-- Every failure returns the same {ok:false}: an unknown identifier, a wrong code, a used code, an account that is not a patient
-- and a locked account cannot be told apart. Failed tries are counted per account so guessing one account is slow wherever the
-- guesses come from.
create function public.redeem_backup_code(p_kind text, p_identifier text, p_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user  uuid;
  v_org   uuid;
  v_hash  text;
  v_id    uuid;
  v_left  integer;
  v_limit integer := (private.recovery_rules() ->> 'backup_code_attempts_per_hour')::integer;
begin
  -- hashing first, always, so an unknown identifier costs the same as a known one
  v_hash := private.backup_code_hash(p_code);
  v_user := private.recovery_find_user(p_kind, p_identifier);
  if v_user is null then return jsonb_build_object('ok', false); end if;
  select organisation_id into v_org from public.profiles where id = v_user and role = 'patient' and is_active;
  if v_org is null then return jsonb_build_object('ok', false); end if;

  if (select count(*) from public.account_backup_code_attempts where user_id = v_user and at > now() - interval '1 hour') >= v_limit then
    return jsonb_build_object('ok', false);
  end if;

  update public.account_backup_codes set used_at = now()
   where user_id = v_user and code_hash = v_hash and used_at is null
   returning id into v_id;
  if v_id is null then
    delete from public.account_backup_code_attempts where user_id = v_user and at < now() - interval '1 day';
    insert into public.account_backup_code_attempts (user_id) values (v_user);
    perform private.recovery_audit(v_org, null, 'account.backup_code_failed', 'account_backup_codes', null, v_user, 'denied', '{}'::jsonb);
    return jsonb_build_object('ok', false);
  end if;
  select count(*) into v_left from public.account_backup_codes where user_id = v_user and used_at is null;
  return jsonb_build_object('ok', true, 'user_id', v_user, 'remaining', v_left);
end;
$$;

-- The password change failed after the code was spent: give the code back (only a code used in the last two minutes).
create function public.release_backup_code(p_user uuid, p_code text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.account_backup_codes set used_at = null
   where user_id = p_user and code_hash = private.backup_code_hash(p_code) and used_at > now() - interval '2 minutes';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- A backup code was accepted: end every session (a recovery that leaves old sessions alive protects nothing when the account was
-- taken over; an access token already issued works for at most the JWT lifetime, one hour) and tell the owner. The server calls this
-- BEFORE it sets the new password, so if it cannot run the password is not changed (and the code is given back): the step that makes
-- the recovery protect anything is never the one allowed to fail open.
create function public.complete_backup_code_recovery(p_user uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_sessions integer;
  v_left integer;
  v_ch text[];
begin
  select organisation_id into v_org from public.profiles where id = p_user and role = 'patient';
  if v_org is null then return jsonb_build_object('ok', false); end if;
  with gone as (delete from auth.sessions where user_id = p_user returning 1) select count(*) into v_sessions from gone;
  select count(*) into v_left from public.account_backup_codes where user_id = p_user and used_at is null;
  v_ch := private.recovery_notice(p_user, 'security.backup_code_used',
    'A backup code was used on your Tarragon Health account, and every device was signed out. If this was not you, contact your care team right away.');
  perform private.recovery_audit(v_org, p_user, 'account.backup_code_used', 'account_backup_codes', null, p_user, 'success',
    jsonb_build_object('sessions_revoked', v_sessions, 'codes_left', v_left, 'notice_channels', to_jsonb(v_ch)));
  return jsonb_build_object('ok', true, 'remaining', v_left);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Recovery contact (a confirmed Care Circle member who agrees to help)
-- ---------------------------------------------------------------------------
create table public.account_recovery_contacts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  contact_id      uuid not null references public.profiles (id) on delete cascade,
  member_id       uuid not null references public.care_circle_members (id) on delete cascade,
  state           text not null default 'proposed' check (state in ('proposed', 'accepted', 'declined', 'revoked')),
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles (id) on delete set null,
  check (patient_id <> contact_id),
  check (state <> 'accepted' or responded_at is not null),
  check (state <> 'revoked' or revoked_at is not null)
);
create unique index account_recovery_contacts_one_live on public.account_recovery_contacts (patient_id) where state in ('proposed', 'accepted');
create index account_recovery_contacts_contact_idx on public.account_recovery_contacts (contact_id) where state in ('proposed', 'accepted');

create table public.account_recovery_contact_requests (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  contact_id      uuid not null references public.profiles (id) on delete cascade,
  contact_row_id  uuid not null references public.account_recovery_contacts (id) on delete cascade,
  state           text not null default 'asked' check (state in ('asked', 'confirmed', 'declined', 'released', 'expired', 'cancelled')),
  asked_at        timestamptz not null default now(),
  expires_at      timestamptz not null,
  confirmed_at    timestamptz,
  release_at      timestamptz,
  released_at     timestamptz,
  closed_at       timestamptz,
  check (state not in ('confirmed', 'released') or (confirmed_at is not null and release_at is not null)),
  check (state <> 'released' or released_at is not null),
  -- the wait cannot be shortened by editing the row: release is never earlier than confirmation plus one hour
  check (release_at is null or release_at >= confirmed_at + interval '1 hour')
);
create unique index account_recovery_contact_requests_one_open on public.account_recovery_contact_requests (patient_id) where state in ('asked', 'confirmed');
create index account_recovery_contact_requests_contact_idx on public.account_recovery_contact_requests (contact_id) where state = 'asked';

alter table public.account_recovery_contacts enable row level security;
alter table public.account_recovery_contact_requests enable row level security;
revoke all on public.account_recovery_contacts from public, anon, authenticated;
revoke all on public.account_recovery_contact_requests from public, anon, authenticated;
grant select on public.account_recovery_contacts to authenticated;
grant select on public.account_recovery_contact_requests to authenticated;
-- A patient reads their own rows; the contact reads the rows that name them. Nobody writes directly.
create policy account_recovery_contacts_own on public.account_recovery_contacts for select to authenticated
  using (patient_id = (select auth.uid()) or contact_id = (select auth.uid()));
create policy account_recovery_contact_requests_own on public.account_recovery_contact_requests for select to authenticated
  using (patient_id = (select auth.uid()) or contact_id = (select auth.uid()));

-- S39d data registry: every patient-keyed table is classified. The contact arrangement is a consent-like record; a recovery request is
-- security process data (not exported, deleted at end of retention). marked reviewed only because S39f requires it of every row, with a note that no CMO or DPO review happened.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, reviewed_at, reviewed_note) values
  ('account_recovery_contacts', 'patient_id', 'consent', 'review', true, true, now(), 'S03b author classification 2026-10-13 (same class as profile_access); NOT a CMO or DPO review, confirm at the next registry review'),
  ('account_recovery_contact_requests', 'patient_id', 'operational', 'delete', false, true, now(), 'S03b author classification 2026-10-13 (security process data, like other request logs); NOT a CMO or DPO review, confirm at the next registry review')
on conflict (table_name) do nothing;

-- Is this circle membership still real right now?
create function private.circle_member_is_live(p_member uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.care_circle_members m join public.profiles s on s.id = m.supporter_id and s.is_active
                  where m.id = p_member and m.state = 'active' and m.expires_at > now())
$$;
revoke all on function private.circle_member_is_live(uuid) from public, anon, authenticated;

create function public.propose_recovery_contact(p_member uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  m public.care_circle_members%rowtype;
  v_id uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  select organisation_id, full_name into v_org, v_name from public.profiles where id = v_uid and role = 'patient' and is_active;
  if v_org is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  select * into m from public.care_circle_members where id = p_member and patient_id = v_uid;
  if m.id is null or not private.circle_member_is_live(m.id) then return jsonb_build_object('ok', false, 'error', 'not_a_circle_member'); end if;
  if exists (select 1 from public.account_recovery_contacts where patient_id = v_uid and state in ('proposed', 'accepted')) then
    return jsonb_build_object('ok', false, 'error', 'already_set');
  end if;
  perform private.consume_step_up(v_uid, 'recovery_contact');
  insert into public.account_recovery_contacts (organisation_id, patient_id, contact_id, member_id)
  values (v_org, v_uid, m.supporter_id, m.id) returning id into v_id;

  perform private.recovery_notice(m.supporter_id, 'security.recovery_contact_asked',
    coalesce(nullif(btrim(v_name), ''), 'Someone in your Care Circle') || ' asked if you would be their account recovery contact. Open your Care Circle to say yes or no. You will only ever be asked to confirm that it really is them.', false);
  perform private.recovery_notice(v_uid, 'security.recovery_contact_changed',
    'You named a recovery contact for your Tarragon Health account. They have to agree before it counts. If this was not you, change your password and tell your care team.');
  perform private.recovery_audit(v_org, v_uid, 'account.recovery_contact_proposed', 'account_recovery_contact', v_id, v_uid, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create function public.respond_recovery_contact(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.account_recovery_contacts%rowtype;
  v_name text;
begin
  if v_uid is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  select * into r from public.account_recovery_contacts where id = p_id and contact_id = v_uid and state = 'proposed' for update;
  if r.id is null or not private.circle_member_is_live(r.member_id) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.account_recovery_contacts
     set state = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = r.id;
  select full_name into v_name from public.profiles where id = v_uid;
  perform private.recovery_notice(r.patient_id, 'security.recovery_contact_changed',
    case when p_accept then 'Your recovery contact agreed to help if you are ever locked out of your Tarragon Health account.'
         else 'The person you named as a recovery contact said no, so you do not have one right now. You can choose someone else.' end);
  perform private.recovery_audit(r.organisation_id, v_uid, case when p_accept then 'account.recovery_contact_accepted' else 'account.recovery_contact_declined' end,
    'account_recovery_contact', r.id, r.patient_id, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'state', case when p_accept then 'accepted' else 'declined' end);
end;
$$;

-- Either side can end it. Ending it also cancels any open request.
create function public.revoke_recovery_contact(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.account_recovery_contacts%rowtype;
begin
  if v_uid is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  select * into r from public.account_recovery_contacts
   where id = p_id and (patient_id = v_uid or contact_id = v_uid) and state in ('proposed', 'accepted') for update;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.account_recovery_contacts set state = 'revoked', revoked_at = now(), revoked_by = v_uid where id = r.id;
  update public.account_recovery_contact_requests set state = 'cancelled', closed_at = now()
   where contact_row_id = r.id and state in ('asked', 'confirmed');
  perform private.recovery_notice(r.patient_id, 'security.recovery_contact_changed',
    case when v_uid = r.patient_id then 'You removed your recovery contact. Any recovery that was waiting on them was cancelled.'
         else 'Your recovery contact stepped down, so you do not have one right now. Any recovery that was waiting on them was cancelled.' end);
  perform private.recovery_audit(r.organisation_id, v_uid, 'account.recovery_contact_revoked', 'account_recovery_contact', r.id, r.patient_id, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create function public.my_recovery_contact() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select jsonb_build_object('id', c.id, 'state', c.state, 'contact_name', p.full_name,
                          'still_in_circle', private.circle_member_is_live(c.member_id), 'since', c.created_at)
                     from public.account_recovery_contacts c join public.profiles p on p.id = c.contact_id
                    where c.patient_id = (select auth.uid()) and c.state in ('proposed', 'accepted')), 'null'::jsonb)
$$;

-- What the people who named me have asked of me: proposals to answer, and open recovery requests to confirm.
create function public.my_recovery_contact_duties() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'proposals', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'patient_name', p.full_name, 'since', c.created_at) order by c.created_at)
                             from public.account_recovery_contacts c join public.profiles p on p.id = c.patient_id
                            where c.contact_id = (select auth.uid()) and c.state = 'proposed' and private.circle_member_is_live(c.member_id)), '[]'::jsonb),
    'standing', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'patient_name', p.full_name, 'since', c.responded_at) order by c.responded_at)
                            from public.account_recovery_contacts c join public.profiles p on p.id = c.patient_id
                           where c.contact_id = (select auth.uid()) and c.state = 'accepted' and private.circle_member_is_live(c.member_id)), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'patient_name', p.full_name, 'asked_at', q.asked_at, 'expires_at', q.expires_at) order by q.asked_at)
                            from public.account_recovery_contact_requests q join public.profiles p on p.id = q.patient_id
                           where q.contact_id = (select auth.uid()) and q.state = 'asked' and q.expires_at > now()), '[]'::jsonb))
$$;

-- Service role only. Someone locked out names their verified email or phone. The answer to the caller never says whether an
-- account, a contact or a request exists. When all of it is true, the contact is asked and the patient is told on the channels
-- they can still read.
create function public.request_contact_recovery(p_kind text, p_identifier text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.recovery_find_user(p_kind, p_identifier);
  v_rules jsonb := private.recovery_rules();
  c public.account_recovery_contacts%rowtype;
  v_id uuid;
  v_pname text;
  v_cname text;
begin
  if v_user is null then return jsonb_build_object('ok', false); end if;
  select * into c from public.account_recovery_contacts where patient_id = v_user and state = 'accepted';
  if c.id is null or not private.circle_member_is_live(c.member_id) then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from public.profiles where id = v_user and role = 'patient' and is_active) then return jsonb_build_object('ok', false); end if;

  update public.account_recovery_contact_requests set state = 'expired', closed_at = now()
   where patient_id = v_user and state in ('asked', 'confirmed') and expires_at <= now();
  if exists (select 1 from public.account_recovery_contact_requests where patient_id = v_user and state in ('asked', 'confirmed')) then
    return jsonb_build_object('ok', false);
  end if;
  if (select count(*) from public.account_recovery_contact_requests where patient_id = v_user and asked_at > now() - interval '7 days')
       >= (v_rules ->> 'contact_requests_per_week')::integer then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.account_recovery_contact_requests (organisation_id, patient_id, contact_id, contact_row_id, expires_at)
  values (c.organisation_id, v_user, c.contact_id, c.id, now() + make_interval(hours => (v_rules ->> 'contact_request_hours')::integer))
  returning id into v_id;

  select full_name into v_pname from public.profiles where id = v_user;
  select full_name into v_cname from public.profiles where id = c.contact_id;
  perform private.recovery_notice(c.contact_id, 'security.recovery_contact_request',
    coalesce(nullif(btrim(v_pname), ''), 'Someone in your Care Circle') || ' says they are locked out of their Tarragon Health account and asked you to help. Open your Care Circle, and only confirm if you have spoken to them yourself and are sure it is them.', true);
  perform private.recovery_notice(v_user, 'security.recovery_contact_request_patient',
    'Someone asked ' || coalesce(nullif(btrim(v_cname), ''), 'your recovery contact') || ' to help recover your Tarragon Health account. If this was not you, sign in and remove your recovery contact, or tell your care team.');
  perform private.recovery_audit(c.organisation_id, null, 'account.recovery_contact_request', 'account_recovery_contact_request', v_id, v_user, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;

-- The contact says yes or no, in their own signed-in session. Yes starts the wait.
create function public.confirm_contact_recovery(p_request uuid, p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rules jsonb := private.recovery_rules();
  q public.account_recovery_contact_requests%rowtype;
  c public.account_recovery_contacts%rowtype;
  v_release timestamptz;
begin
  if v_uid is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  select * into q from public.account_recovery_contact_requests where id = p_request and contact_id = v_uid and state = 'asked' for update;
  if q.id is null or q.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into c from public.account_recovery_contacts where id = q.contact_row_id and state = 'accepted';
  if c.id is null or c.contact_id <> v_uid or not private.circle_member_is_live(c.member_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not p_confirm then
    update public.account_recovery_contact_requests set state = 'declined', closed_at = now() where id = q.id;
    perform private.recovery_notice(q.patient_id, 'security.recovery_contact_declined',
      'Your recovery contact did not confirm the recovery of your Tarragon Health account. If you were not trying to recover it, nothing more is needed.');
    perform private.recovery_audit(q.organisation_id, v_uid, 'account.recovery_contact_declined_request', 'account_recovery_contact_request', q.id, q.patient_id, 'success', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'state', 'declined');
  end if;

  v_release := now() + make_interval(hours => (v_rules ->> 'contact_delay_hours')::integer);
  update public.account_recovery_contact_requests
     set state = 'confirmed', confirmed_at = now(), release_at = v_release,
         expires_at = v_release + make_interval(hours => (v_rules ->> 'contact_release_hours')::integer)
   where id = q.id;
  perform private.recovery_notice(q.patient_id, 'security.recovery_contact_confirmed',
    'Your recovery contact confirmed it is you. For your safety there is a wait: from ' ||
    to_char(v_release at time zone 'Africa/Lagos', 'DD Mon YYYY "at" HH24:MI') ||
    ' (Lagos time) you can ask for a one-time link to your verified email, or a code to your verified phone. If this was not you, sign in and remove your recovery contact now, or tell your care team.');
  perform private.recovery_audit(q.organisation_id, v_uid, 'account.recovery_contact_confirmed', 'account_recovery_contact_request', q.id, q.patient_id, 'success',
    jsonb_build_object('release_at', v_release));
  return jsonb_build_object('ok', true, 'state', 'confirmed', 'release_at', v_release);
end;
$$;

-- The patient, signed in anywhere, can stop a request that was not theirs.
create function public.cancel_contact_recovery() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n integer;
begin
  if v_uid is null then raise exception 'recovery_not_authorised' using errcode = '42501'; end if;
  update public.account_recovery_contact_requests set state = 'cancelled', closed_at = now()
   where patient_id = v_uid and state in ('asked', 'confirmed');
  get diagnostics n = row_count;
  if n > 0 then
    perform private.recovery_audit((select organisation_id from public.profiles where id = v_uid), v_uid, 'account.recovery_contact_request_cancelled',
      'account_recovery_contact_request', null, v_uid, 'success', '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'cancelled', n > 0);
end;
$$;

-- Service role only. After the wait, the patient asks for the link. Single use: it flips the request to released. The caller
-- (the server action) then sends the link or code to the patient's OWN verified channel; nothing here returns an address.
create function public.claim_contact_recovery(p_kind text, p_identifier text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.recovery_find_user(p_kind, p_identifier);
  q public.account_recovery_contact_requests%rowtype;
begin
  if v_user is null then return jsonb_build_object('ok', false); end if;
  select * into q from public.account_recovery_contact_requests
   where patient_id = v_user and state = 'confirmed' and release_at <= now() and expires_at > now() for update;
  if q.id is null then return jsonb_build_object('ok', false); end if;
  -- the contact must still be in the circle and still agreed
  if not exists (select 1 from public.account_recovery_contacts c where c.id = q.contact_row_id and c.state = 'accepted' and private.circle_member_is_live(c.member_id)) then
    update public.account_recovery_contact_requests set state = 'cancelled', closed_at = now() where id = q.id;
    return jsonb_build_object('ok', false);
  end if;
  update public.account_recovery_contact_requests set state = 'released', released_at = now() where id = q.id;
  perform private.recovery_notice(v_user, 'security.recovery_contact_released',
    'A one-time recovery link or code was sent to your verified email or phone, because your recovery contact confirmed it is you. If this was not you, tell your care team right away.');
  perform private.recovery_audit(q.organisation_id, null, 'account.recovery_contact_released', 'account_recovery_contact_request', q.id, v_user, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'user_id', v_user, 'request_id', q.id);
end;
$$;

-- Sending the link failed after the request was spent: open it again (within the window it already had).
create function public.unrelease_contact_recovery(p_request uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.account_recovery_contact_requests set state = 'confirmed', released_at = null
   where id = p_request and state = 'released' and released_at > now() - interval '5 minutes' and expires_at > now();
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Change-number gate (closes the "confirm via the old number OR a verified email" half of OQ-43)
-- ---------------------------------------------------------------------------
create table public.phone_change_authorisations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  method      text not null check (method in ('old_phone', 'email')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index phone_change_authorisations_user_idx on public.phone_change_authorisations (user_id, created_at desc);
alter table public.phone_change_authorisations enable row level security;
revoke all on public.phone_change_authorisations from public, anon, authenticated;

-- Service role only. The server action calls it AFTER it has verified a code sent to the old number or the verified email.
create function public.authorise_phone_change(p_user uuid, p_method text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  u auth.users%rowtype;
  v_org uuid;
  v_ch text[];
begin
  if p_method not in ('old_phone', 'email') then raise exception 'unknown method' using errcode = '22023'; end if;
  select * into u from auth.users where id = p_user;
  -- any active role: the gate below applies to every account that has something to confirm with, staff included
  select organisation_id into v_org from public.profiles where id = p_user and is_active;
  if u.id is null or v_org is null then return jsonb_build_object('ok', false); end if;
  if p_method = 'old_phone' and (u.phone is null or u.phone_confirmed_at is null) then return jsonb_build_object('ok', false); end if;
  if p_method = 'email' and (u.email is null or u.email_confirmed_at is null) then return jsonb_build_object('ok', false); end if;

  delete from public.phone_change_authorisations where user_id = p_user and consumed_at is null;
  insert into public.phone_change_authorisations (user_id, method, expires_at)
  values (p_user, p_method, now() + make_interval(mins => (private.recovery_rules() ->> 'number_change_confirm_minutes')::integer));

  v_ch := private.recovery_notice(p_user, 'security.phone_change_started',
    'Someone is changing the phone number on your Tarragon Health account. If this is you, carry on. If it is not, change your password now and tell your care team. The number does not change until a code sent to the new number is entered.');
  perform private.recovery_audit(v_org, p_user, 'account.phone_change_authorised', 'auth_user', p_user, p_user, 'success',
    jsonb_build_object('method', p_method, 'notice_channels', to_jsonb(v_ch)));
  return jsonb_build_object('ok', true);
end;
$$;

-- Does the account hold a fresh, unspent authorisation? Lets the server say "confirm it is you first" BEFORE it asks Auth to move the
-- number, instead of guessing from the wording of a wrapped database error. Does not spend it.
create function public.has_fresh_phone_change_authorisation(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.phone_change_authorisations where user_id = p_user and consumed_at is null and expires_at > now())
$$;

-- The gate. GoTrue sets auth.users.phone_change when someone asks for a new number. If the account has anything to confirm with
-- (a confirmed phone or a confirmed email), a fresh authorisation must exist. Runs for every caller, including a direct call to
-- the Auth API with a stolen access token, which an application-level check would miss. A resend of the same code (phone_change
-- unchanged) and the clearing of phone_change on confirmation are not gated.
create function private.enforce_phone_change_authorisation() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not ((old.phone is not null and old.phone_confirmed_at is not null) or (old.email is not null and old.email_confirmed_at is not null)) then
    return new;
  end if;
  select id into v_id from public.phone_change_authorisations
   where user_id = new.id and consumed_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if v_id is null then
    raise exception 'phone_change_needs_confirmation' using errcode = 'P0001',
      hint = 'Confirm with a code sent to the current number or the verified email first.';
  end if;
  update public.phone_change_authorisations set consumed_at = now() where id = v_id;
  return new;
end;
$$;
revoke all on function private.enforce_phone_change_authorisation() from public, anon, authenticated;

create trigger auth_users_enforce_phone_change_authorisation
  before update of phone_change on auth.users
  for each row
  when (new.phone_change is distinct from old.phone_change and coalesce(new.phone_change, '') <> '')
  execute function private.enforce_phone_change_authorisation();

-- The sign-in number actually moved, whoever moved it (the owner's own change, a direct Auth call, assisted recovery): record WHEN
-- (the pause reads it) and tell the owner (in-app and email, not SMS; the old number is not texted, INV-08). Recording is plain; the
-- notice is wrapped so that a failure to queue it can never block a legitimate number change (it is reported as a warning).
create function private.record_phone_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.account_phone_changes (user_id) values (new.id);
  if old.phone is not null then
    begin
      perform private.recovery_notice(new.id, 'security.phone_changed',
        'The phone number on your Tarragon Health account was changed. For your safety, recovery by a text code is paused for a few days. If this was not you, change your password now and tell your care team.');
    exception when others then
      raise warning 'S03b: could not queue the number-changed notice (sqlstate %)', sqlstate;
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.record_phone_changed() from public, anon, authenticated;

create trigger auth_users_record_phone_changed
  after update of phone on auth.users
  for each row
  when (old.phone is distinct from new.phone)
  execute function private.record_phone_changed();

-- Is recovery by a text code paused for the signed-in caller? Called right after a recovery code was accepted, by the person who
-- just proved the code. Paused for number_change_hold_hours after the number moved, unless the recovery contact route has
-- released the account in the last two hours (a person and a delay are the second confirmation).
create function public.my_phone_recovery_hold() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hours integer := (private.recovery_rules() ->> 'number_change_hold_hours')::integer;
  v_since timestamptz;
begin
  if v_uid is null then return jsonb_build_object('held', false); end if;
  if not private.number_changed_recently(v_uid, v_hours) then return jsonb_build_object('held', false); end if;
  if exists (select 1 from public.account_recovery_contact_requests where patient_id = v_uid and state = 'released' and released_at > now() - interval '2 hours') then
    return jsonb_build_object('held', false, 'released_by_contact', true);
  end if;
  select max(c.changed_at) into v_since from public.account_phone_changes c where c.user_id = v_uid;
  return jsonb_build_object('held', true, 'until', v_since + make_interval(hours => v_hours));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Every function: no PUBLIC, no anon. Signed-in functions go to authenticated; the unauthenticated-flow functions to
-- service_role only.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.generate_backup_codes()', 'public.my_backup_code_status()',
    'public.propose_recovery_contact(uuid)', 'public.respond_recovery_contact(uuid,boolean)', 'public.revoke_recovery_contact(uuid)',
    'public.my_recovery_contact()', 'public.my_recovery_contact_duties()', 'public.confirm_contact_recovery(uuid,boolean)',
    'public.cancel_contact_recovery()', 'public.my_phone_recovery_hold()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S03b: anon can execute %', f; end if;
  end loop;
  foreach f in array array[
    'public.redeem_backup_code(text,text,text)', 'public.release_backup_code(uuid,text)', 'public.complete_backup_code_recovery(uuid)',
    'public.request_contact_recovery(text,text)', 'public.claim_contact_recovery(text,text)', 'public.unrelease_contact_recovery(uuid)',
    'public.authorise_phone_change(uuid,text)', 'public.record_step_up(uuid,text,text)', 'public.has_fresh_phone_change_authorisation(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'S03b: % is callable by a signed-in or anonymous role', f;
    end if;
  end loop;
  foreach f in array array[
    'private.backup_code_hash(text)', 'private.recovery_find_user(text,text)', 'private.recovery_audit(uuid,uuid,text,text,uuid,uuid,text,jsonb)',
    'private.recovery_notice(uuid,text,text,boolean)', 'private.number_changed_recently(uuid,integer)', 'private.circle_member_is_live(uuid)',
    'private.recovery_rules()', 'private.enforce_phone_change_authorisation()', 'private.record_phone_changed()',
    'private.consume_step_up(uuid,text)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'S03b: helper % is directly executable', f;
    end if;
  end loop;
  foreach f in array array['public.account_backup_codes', 'public.account_backup_code_attempts', 'public.phone_change_authorisations', 'public.account_recovery_config',
                           'public.account_step_ups', 'public.account_phone_changes'] loop
    if has_table_privilege('authenticated', f, 'SELECT') or has_table_privilege('anon', f, 'SELECT')
       or has_table_privilege('authenticated', f, 'INSERT') or has_table_privilege('authenticated', f, 'UPDATE') then
      raise exception 'S03b: % is directly reachable by an application role', f;
    end if;
  end loop;
  foreach f in array array['public.account_recovery_contacts', 'public.account_recovery_contact_requests'] loop
    if has_table_privilege('authenticated', f, 'INSERT') or has_table_privilege('authenticated', f, 'UPDATE')
       or has_table_privilege('authenticated', f, 'DELETE') or has_table_privilege('anon', f, 'SELECT') then
      raise exception 'S03b: % has a direct write or anon grant', f;
    end if;
  end loop;
end $$;
