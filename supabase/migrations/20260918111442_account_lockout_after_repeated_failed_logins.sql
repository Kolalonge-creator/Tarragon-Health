-- Tarragon Health
-- Real account-level lockout after repeated failed password logins (security audit
-- 2026-09-18, comparing this platform's auth surface against enterprise-grade baselines
-- like Epic MyChart / One Medical).
--
-- What already existed before this migration: apps/web/src/lib/rate-limit.ts throttles
-- both by IP and by the submitted email (8 attempts / 15 min), which blunts a brute-force
-- burst. That is real protection, but it is a ROLLING WINDOW, not a lockout — it resets to
-- zero the moment the 15-minute window elapses, it keeps no record an account owner or
-- admin could see, and it never notifies anyone that an account was targeted. An attacker
-- with a weak-password guess list can simply wait out each window indefinitely (roughly
-- 768 guesses/day forever) with zero signal to the account owner. That is the gap this
-- migration closes: a real, persistent, escalating lock tied to the ACCOUNT (not the
-- request), plus a security notification through the same in_app+email pipeline the
-- new-device-login feature already uses (20260829223329_known_device_login_notification.sql).
--
-- Anti-enumeration: every RPC here returns identical shapes regardless of whether the
-- submitted email matches a real account (mirrors supabase.auth.resetPasswordForEmail's own
-- posture, and the existing rate-limit messaging, which already never distinguishes "no such
-- account" from any other failure). is_account_locked() returns false for an email with no
-- account, exactly as it would for a real, currently-unlocked account — no timing-free
-- guarantee is claimed (an auth.users lookup is not disclosed either way, same accepted
-- limitation as resetPasswordForEmail already has in this codebase), but no response the
-- client branches on ever differs.
--
-- Threshold: 5 failed attempts locks the account for 15 minutes and fires one notification
-- per lockout event (not per attempt, so a continued attack after lock doesn't spam the
-- inbox — see the `locked_until is null` guard in record_failed_login below). A successful
-- login clears the counter. These numbers are a first pass, not a claim of NIST/regulator
-- sign-off — same posture as every other numeric threshold in this codebase (see
-- escalation_slas for how a similar number was later made admin-tunable data; this one can
-- follow the same path if the founder wants it configurable later).

create table public.account_lockouts (
  profile_id       uuid primary key references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  failed_attempts  integer not null default 0,
  locked_until     timestamptz,
  last_failed_at   timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.account_lockouts is
  'One row per profile tracking consecutive failed login attempts (password or phone-OTP — '
  'both feed the same counter/lock) and any active lockout. Written only by '
  'public.record_failed_login()/public.record_failed_login_by_phone()/public.clear_login_failures() '
  '— no direct client insert/update path. See '
  '20260918111442_account_lockout_after_repeated_failed_logins.sql for design notes.';

create index account_lockouts_organisation_id_idx on public.account_lockouts (organisation_id);

alter table public.account_lockouts enable row level security;

-- A user may see their own lockout state (e.g. a future "your account is temporarily
-- locked" banner on /login could read this), but never anyone else's.
create policy account_lockouts_select on public.account_lockouts
  for select to authenticated
  using (profile_id = (select auth.uid()));

grant select on public.account_lockouts to authenticated;

create trigger account_lockouts_set_updated_at
  before update on public.account_lockouts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- private.is_profile_locked(profile_id) / private.record_failed_login_attempt
-- (profile_id, org_id) — the actual lockout logic, factored out of the
-- email-keyed functions below so the phone-OTP login path (verifyPhoneOtp in
-- apps/web/src/app/login/actions.ts) can share it too. Without this, a
-- lockout triggered by repeated wrong-password attempts read as "account
-- security" but only actually blocked the PASSWORD login method — an
-- attacker (or the legitimate owner) could still complete sign-in via phone
-- OTP during the lock window, and a wrong-OTP guess never counted toward the
-- same counter either. Every public wrapper below (is_account_locked,
-- is_account_locked_by_phone, record_failed_login, record_failed_login_by_
-- phone) is now a thin identifier-resolution shim over these two.
-- ---------------------------------------------------------------------------
create or replace function private.is_profile_locked(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select locked_until is not null and locked_until > now()
  from public.account_lockouts
  where profile_id = p_profile_id;
$$;

comment on function private.is_profile_locked(uuid) is
  'Core lockout check, shared by is_account_locked(email) and '
  'is_account_locked_by_phone(phone) — see 20260918111442_account_lockout_after_'
  'repeated_failed_logins.sql for why both login methods must consult the same lock.';

create or replace function private.record_failed_login_attempt(p_profile_id uuid, p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts    integer;
  v_locked_until timestamptz;
  v_should_notify boolean := false;
  v_email       text;
begin
  insert into public.account_lockouts (profile_id, organisation_id, failed_attempts, last_failed_at)
  values (p_profile_id, p_org_id, 1, now())
  on conflict (profile_id) do update
    set failed_attempts = case
          -- A lock that has already expired starts a fresh count rather than
          -- compounding forever off a stale streak from days ago.
          when public.account_lockouts.locked_until is not null
               and public.account_lockouts.locked_until <= now()
          then 1
          else public.account_lockouts.failed_attempts + 1
        end,
        -- Bug fixed before merge: this branch used to leave a naturally-
        -- expired locked_until at its stale past value instead of clearing
        -- it. That past timestamp still satisfies "locked_until <= now()"
        -- on every SUBSEQUENT failure too, so failed_attempts kept resetting
        -- to 1 forever instead of ever incrementing past 1 again — the
        -- account could be locked exactly once, then never again, no matter
        -- how many more genuine wrong-password attempts followed. Clearing
        -- locked_until to null here is what lets the next failure's ON
        -- CONFLICT branch take the "else" (increment) path instead of
        -- repeating the "reset to 1" path indefinitely. See
        -- packages/db/tests/account_lockout_after_repeated_failed_logins.sql
        -- section 7 for the regression proof (lock, let it expire, 5 more
        -- failures, confirm a SECOND lock actually fires).
        locked_until = case
          when public.account_lockouts.locked_until is not null
               and public.account_lockouts.locked_until <= now()
          then null
          else public.account_lockouts.locked_until
        end,
        last_failed_at = now()
  returning failed_attempts, locked_until into v_attempts, v_locked_until;

  if v_attempts >= 5 and (v_locked_until is null or v_locked_until <= now()) then
    update public.account_lockouts
    set locked_until = now() + interval '15 minutes',
        failed_attempts = 0
    where profile_id = p_profile_id;
    v_should_notify := true;
  end if;

  if v_should_notify then
    -- send-pending-notifications resolves an email-channel row's destination
    -- ONLY from payload.to_email (profiles has no email column, and unlike
    -- phone there is no recipient-profile fallback lookup for email) — found
    -- while wiring this up: the pre-existing security.new_device_signin
    -- notification has the same gap (no to_email either), which means its
    -- email half has been silently failing "recipient has no email address"
    -- since it shipped. See 20260918120000_fix_new_device_signin_missing_
    -- to_email.sql for that fix; this is the same pattern applied here from
    -- the start. Matches 20260720120004_prescription_lab_order_patient_
    -- emails.sql's own `select email into ... from auth.users` convention.
    select email into v_email from auth.users where id = p_profile_id;

    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
    values
      (p_org_id, p_profile_id, 'in_app', 'pending', 'security.account_locked',
       jsonb_build_object(
         'message', 'Your Tarragon Health account was temporarily locked after several failed sign-in attempts. If this wasn''t you, consider resetting your password.',
         'locked_minutes', 15,
         'occurred_at', now()
       ),
       'non_clinical', 'critical'),
      (p_org_id, p_profile_id, 'email', 'pending', 'security.account_locked',
       jsonb_build_object(
         'message', 'Your Tarragon Health account was temporarily locked for 15 minutes after several failed sign-in attempts. If this wasn''t you, please reset your password as soon as the lock lifts.',
         'locked_minutes', 15,
         'occurred_at', now(),
         'to_email', v_email
       ),
       'non_clinical', 'critical');
  end if;
end;
$$;

comment on function private.record_failed_login_attempt(uuid, uuid) is
  'Core failed-attempt bookkeeping, shared by record_failed_login(email) and '
  'record_failed_login_by_phone(phone). Locks the profile for 15 minutes once 5 '
  'consecutive failures are reached, firing an in_app+email security.account_locked '
  'notification the moment a lock is newly applied.';

-- ---------------------------------------------------------------------------
-- is_account_locked(email) — called from the login server action BEFORE
-- attempting signInWithPassword, so a locked account is refused without ever
-- touching GoTrue (and without moving the lockout window further into the
-- future on every subsequent guess). Anon-callable: the caller has no
-- session yet at this point in the login flow.
-- ---------------------------------------------------------------------------
create or replace function public.is_account_locked(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id from auth.users where lower(email) = lower(trim(p_email));
  if v_profile_id is null then
    return false;
  end if;
  return coalesce(private.is_profile_locked(v_profile_id), false);
end;
$$;

comment on function public.is_account_locked(text) is
  'True iff the account for this email is currently locked out from repeated failed '
  'logins. Returns false uniformly for an email with no account, or a real account with no '
  'active lock — the login action never branches on which case that is, so no enumeration '
  'signal reaches the client either way.';

revoke all on function public.is_account_locked(text) from public;
grant execute on function public.is_account_locked(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- is_account_locked_by_phone(phone) — the phone-OTP login path's equivalent
-- of is_account_locked(email) above. Consults the SAME account_lockouts row
-- (keyed by profile_id, not by which identifier was used to find it), so a
-- lock triggered by password failures genuinely blocks OTP sign-in too, not
-- just the method that caused it.
-- ---------------------------------------------------------------------------
create or replace function public.is_account_locked_by_phone(p_phone text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  -- GoTrue stores auth.users.phone WITHOUT the leading '+' (E.164 digits
  -- only — see 20260711222638_fix_handle_new_user_metadata_timing_and_phone.sql
  -- for the same convention on the write side), but every caller here passes
  -- a '+'-prefixed E.164 string (phoneOtpVerifySchema/E164_GENERIC) — strip it
  -- before comparing, or this would never match a real row.
  select id into v_profile_id from auth.users
  where phone = case when trim(p_phone) ~ '^\+' then substring(trim(p_phone) from 2) else trim(p_phone) end;
  if v_profile_id is null then
    return false;
  end if;
  return coalesce(private.is_profile_locked(v_profile_id), false);
end;
$$;

comment on function public.is_account_locked_by_phone(text) is
  'Phone-OTP counterpart to is_account_locked(email) — same account_lockouts row, same '
  'anti-enumeration posture (false for both an unknown number and a real, unlocked one).';

revoke all on function public.is_account_locked_by_phone(text) from public;
grant execute on function public.is_account_locked_by_phone(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_failed_login(email) / record_failed_login_by_phone(phone) — called
-- from the login server action right after signInWithPassword/verifyOtp
-- returns an error, via createServiceRoleClient() (lib/supabase/service-role.ts),
-- NEVER the ordinary anon-key client.
--
-- Deliberately service_role-only, unlike the is_account_locked* checks above.
-- The anon key that would let this be callable at all pre-auth is not a
-- secret — it ships in the browser bundle — so an EARLIER version of this
-- migration that granted anon EXECUTE here let anyone who knew (or guessed) a
-- victim's email call this directly against the public PostgREST endpoint,
-- with no real login attempt and no interaction with lib/rate-limit.ts's
-- throttling at all, to lock that account indefinitely (5 calls, repeated
-- every 15 minutes) — turning the anti-brute-force feature into an
-- account-denial weapon. Restricting EXECUTE to service_role closes that:
-- only this project's own trusted server code, using a secret never sent to
-- a browser, can record a failure. The is_account_locked* checks stay
-- anon-callable because they only read (no mutation, so no denial-of-service
-- vector) and the real login flow genuinely needs to check before any
-- session exists.
-- ---------------------------------------------------------------------------
create or replace function public.record_failed_login(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id  uuid;
  v_org_id      uuid;
begin
  select id into v_profile_id from auth.users where lower(email) = lower(trim(p_email));
  if v_profile_id is null then
    return;
  end if;

  select organisation_id into v_org_id from public.profiles where id = v_profile_id;
  if v_org_id is null then
    return;
  end if;

  perform private.record_failed_login_attempt(v_profile_id, v_org_id);
end;
$$;

comment on function public.record_failed_login(text) is
  'Increments the failed-login counter for the account matching this email (no-op if none '
  'exists) — see private.record_failed_login_attempt for the actual lock/notify logic. '
  'service_role-only — see the header comment right above this function for why anon/'
  'authenticated must never be able to call this directly. Called from '
  'apps/web/src/app/login/actions.ts, via createServiceRoleClient(), right after a failed '
  'signInWithPassword.';

revoke all on function public.record_failed_login(text) from public, anon, authenticated;
grant execute on function public.record_failed_login(text) to service_role;

create or replace function public.record_failed_login_by_phone(p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id  uuid;
  v_org_id      uuid;
begin
  -- GoTrue stores auth.users.phone WITHOUT the leading '+' (E.164 digits
  -- only — see 20260711222638_fix_handle_new_user_metadata_timing_and_phone.sql
  -- for the same convention on the write side), but every caller here passes
  -- a '+'-prefixed E.164 string (phoneOtpVerifySchema/E164_GENERIC) — strip it
  -- before comparing, or this would never match a real row.
  select id into v_profile_id from auth.users
  where phone = case when trim(p_phone) ~ '^\+' then substring(trim(p_phone) from 2) else trim(p_phone) end;
  if v_profile_id is null then
    return;
  end if;

  select organisation_id into v_org_id from public.profiles where id = v_profile_id;
  if v_org_id is null then
    return;
  end if;

  perform private.record_failed_login_attempt(v_profile_id, v_org_id);
end;
$$;

comment on function public.record_failed_login_by_phone(text) is
  'Phone-OTP counterpart to record_failed_login(email) — same underlying counter/lock '
  '(private.record_failed_login_attempt), keyed by the same profile_id. service_role-only, '
  'same reasoning as record_failed_login(email). Called from '
  'apps/web/src/app/login/actions.ts''s verifyPhoneOtp, via createServiceRoleClient(), right '
  'after a failed verifyOtp.';

revoke all on function public.record_failed_login_by_phone(text) from public, anon, authenticated;
grant execute on function public.record_failed_login_by_phone(text) to service_role;

-- ---------------------------------------------------------------------------
-- clear_login_failures() — called from the login server action right after a
-- SUCCESSFUL sign-in, using the now-authenticated session's own auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.clear_login_failures()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.account_lockouts
  set failed_attempts = 0,
      locked_until = null
  where profile_id = auth.uid();
end;
$$;

comment on function public.clear_login_failures() is
  'Resets the caller''s own failed-login counter and any active lock after a successful '
  'sign-in. Scoped to auth.uid() — no argument, cannot be pointed at another account.';

revoke all on function public.clear_login_failures() from public, anon;
grant execute on function public.clear_login_failures() to authenticated;
revoke execute on function public.clear_login_failures() from anon;

-- ---------------------------------------------------------------------------
-- Self-check: prove the ACLs landed as intended, the same discipline the
-- anon-EXECUTE gotcha in CLAUDE.md asks for (grant comments can lie — verify
-- live).
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_function_privilege('anon', 'public.is_account_locked(text)', 'EXECUTE') then
    raise exception 'is_account_locked must be EXECUTE-able by anon (pre-auth login check)';
  end if;
  if not has_function_privilege('anon', 'public.is_account_locked_by_phone(text)', 'EXECUTE') then
    raise exception 'is_account_locked_by_phone must be EXECUTE-able by anon (pre-auth login check)';
  end if;

  -- record_failed_login/record_failed_login_by_phone are the two functions
  -- here that WRITE on an anonymous caller's say-so — see their header
  -- comment for the account-denial exploit that follows if anon or
  -- authenticated can call either directly. service_role must be able to
  -- (the login action's only caller, via createServiceRoleClient()); nothing
  -- else may.
  if has_function_privilege('anon', 'public.record_failed_login(text)', 'EXECUTE') then
    raise exception 'record_failed_login is EXECUTE-able by anon — this is an account-lockout DoS vector, not a hardening gap';
  end if;
  if has_function_privilege('authenticated', 'public.record_failed_login(text)', 'EXECUTE') then
    raise exception 'record_failed_login is EXECUTE-able by authenticated — this is an account-lockout DoS vector, not a hardening gap';
  end if;
  if not has_function_privilege('service_role', 'public.record_failed_login(text)', 'EXECUTE') then
    raise exception 'record_failed_login is NOT EXECUTE-able by service_role — the login action''s only caller would be locked out itself';
  end if;

  if has_function_privilege('anon', 'public.record_failed_login_by_phone(text)', 'EXECUTE') then
    raise exception 'record_failed_login_by_phone is EXECUTE-able by anon — this is an account-lockout DoS vector, not a hardening gap';
  end if;
  if has_function_privilege('authenticated', 'public.record_failed_login_by_phone(text)', 'EXECUTE') then
    raise exception 'record_failed_login_by_phone is EXECUTE-able by authenticated — this is an account-lockout DoS vector, not a hardening gap';
  end if;
  if not has_function_privilege('service_role', 'public.record_failed_login_by_phone(text)', 'EXECUTE') then
    raise exception 'record_failed_login_by_phone is NOT EXECUTE-able by service_role — the login action''s only caller would be locked out itself';
  end if;

  if has_function_privilege('anon', 'public.clear_login_failures()', 'EXECUTE') then
    raise exception 'clear_login_failures is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.clear_login_failures()', 'EXECUTE') then
    raise exception 'clear_login_failures is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
