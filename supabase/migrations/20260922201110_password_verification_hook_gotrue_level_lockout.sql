-- Tarragon Health
-- GoTrue-level enforcement of account lockout (follow-up to
-- 20260918111442_account_lockout_after_repeated_failed_logins.sql).
--
-- The gap: that migration's lockout is real, but every enforcement point
-- (is_account_locked/record_failed_login, called from
-- apps/web/src/app/login/actions.ts) lives entirely in the Next.js web app's
-- server actions. Supabase Auth (GoTrue) itself never consults
-- account_lockouts — it only rejects a sign-in when the password itself is
-- wrong. That means:
--   - The mobile app (apps/mobile, its own @supabase/supabase-js client
--     talking to GoTrue directly) completely bypasses the lockout: a locked
--     account's CORRECT password still succeeds via mobile, with zero
--     counter/notification.
--   - Anyone calling POST /auth/v1/token?grant_type=password directly
--     against the PostgREST/GoTrue endpoint with the (non-secret, ships in
--     every browser bundle and every mobile build) anon key bypasses
--     login/actions.ts entirely, and with it every check that lives there.
--
-- The fix: Supabase's Password Verification Attempt Auth Hook
-- (https://supabase.com/docs/guides/auth/auth-hooks/password-verification-hook)
-- fires inside GoTrue itself on every password sign-in, from every client,
-- after GoTrue has already checked the password (event carries `valid`).
-- Returning `{"decision": "reject", ...}` here refuses the sign-in
-- regardless of whether the password was correct — this is what closes the
-- mobile/direct-API gap, because it runs the same way no matter which
-- client asked. The existing web-only is_account_locked() pre-check in
-- login/actions.ts is now a fast-path UX improvement (an immediate, specific
-- "this account is locked" message before ever calling
-- signInWithPassword), not the only enforcement — this hook is the real,
-- client-independent gate.
--
-- Critical constraint that shapes every line of hook_password_verification_
-- attempt below: an ERROR raised inside a Postgres Auth Hook is NOT treated
-- as "let the request through" — GoTrue propagates it as a 500 and BLOCKS
-- THE SIGN-IN, and per Supabase's own docs this applies platform-wide: a
-- hook that errors (a missing table, a permission problem, a bad cast) fails
-- every sign-in attempt, for every user, until it's fixed. That is a
-- categorically worse outcome than the lockout bug this migration closes —
-- a bug in 40-ish lines of hook logic must never be able to take down login
-- for the entire platform. The hook body is therefore wrapped in a single
-- top-level `exception when others` that always degrades to `{"decision":
-- "continue"}` (defer to GoTrue's own password check, exactly as if this
-- hook didn't exist) rather than ever letting an unexpected error propagate
-- out of the function. This is the same fail-open posture this codebase
-- already uses for lib/rate-limit.ts and idle-timeout.ts's stampActivity —
-- infrastructure that protects the platform must never become a new way to
-- take the platform down. The one thing that is NOT fail-open is the actual
-- lockout decision itself: if private.is_profile_locked() returns true, the
-- hook rejects — that check is a single indexed primary-key lookup with no
-- external calls, effectively unable to itself throw.
--
-- Also closes a smaller, real correctness gap found while building this:
-- clear_login_failures() could only ever be called from an already-
-- authenticated client (it reads auth.uid()), so a successful MOBILE-only
-- sign-in never cleared a failure count a patient had run up on web (or vice
-- versa) — harmless (it only delays how soon the counter naturally resets),
-- but easy to close for free now that the hook already resolves the
-- profile's id from the event with no session required. Factored the reset
-- logic into private.clear_login_failures_for_profile(uuid), reused by both
-- the pre-existing public.clear_login_failures() (auth.uid()-scoped) and the
-- new hook (event-user_id-scoped) — same shared-core pattern this file's
-- prior migration already used for is_profile_locked/record_failed_login_attempt.

-- ---------------------------------------------------------------------------
-- private.clear_login_failures_for_profile(profile_id) — the reset half of
-- the shared core, split out of public.clear_login_failures() so the new
-- hook can call it directly with an event-resolved profile id, without
-- needing auth.uid() (there is no session yet at hook time).
-- ---------------------------------------------------------------------------
create or replace function private.clear_login_failures_for_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_lockouts
  set failed_attempts = 0,
      locked_until = null
  where profile_id = p_profile_id;
end;
$$;

comment on function private.clear_login_failures_for_profile(uuid) is
  'Core failed-login-counter reset, shared by public.clear_login_failures() (auth.uid()-scoped, '
  'called post-session from apps/web/src/app/login/actions.ts) and '
  'public.hook_password_verification_attempt (event-resolved user_id, no session required) — see '
  '20260922201110_password_verification_hook_gotrue_level_lockout.sql for why both need it. '
  'Deliberately EXECUTE-revoked from authenticated (see is_profile_locked''s own comment in the '
  'prior migration) — takes a raw profile_id with no ownership check, so it must never be callable '
  'except from within a SECURITY DEFINER wrapper.';

revoke all on function private.clear_login_failures_for_profile(uuid) from public, anon, authenticated;

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

  perform private.clear_login_failures_for_profile(auth.uid());
end;
$$;

comment on function public.clear_login_failures() is
  'Resets the caller''s own failed-login counter and any active lock after a successful '
  'sign-in. Scoped to auth.uid() — no argument, cannot be pointed at another account. Delegates to '
  'private.clear_login_failures_for_profile, shared with the GoTrue password-verification hook.';

-- Grants unchanged from the prior migration (authenticated only) — CREATE OR
-- REPLACE preserves existing grants, this restates them for anyone reading
-- this file in isolation.
revoke all on function public.clear_login_failures() from public, anon;
grant execute on function public.clear_login_failures() to authenticated;

-- ---------------------------------------------------------------------------
-- public.hook_password_verification_attempt(event jsonb) — the GoTrue Auth
-- Hook itself. Named and shaped to match Supabase's own documented example
-- (public schema, hook_<name> prefix) rather than this codebase's usual
-- private.* convention: supabase_auth_admin (the role GoTrue calls hooks
-- as) is never granted access to the private schema by this project's
-- default-privilege setup, and there is no reason to carve out an exception
-- for one function GoTrue itself must be able to reach directly.
--
-- SECURITY DEFINER (owned by the migration-applying role, matching every
-- other SECURITY DEFINER function in this file) rather than the plain
-- invoker-rights style Supabase's own doc examples use, because this
-- function calls into private.is_profile_locked / private.
-- record_failed_login_attempt / private.clear_login_failures_for_profile,
-- all three of which are deliberately EXECUTE-revoked from every role except
-- an owning SECURITY DEFINER caller (see their own comments). Running this
-- hook as SECURITY DEFINER is what lets it reach them without punching a new
-- hole in that revoke for supabase_auth_admin specifically.
-- ---------------------------------------------------------------------------
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_valid   boolean;
  v_org_id  uuid;
  v_has_profile boolean;
begin
  v_user_id := (event->>'user_id')::uuid;

  if v_user_id is null then
    return jsonb_build_object('decision', 'continue');
  end if;

  -- Reject regardless of whether THIS attempt's password was valid — an
  -- already-locked account must not be let in on a correct password either.
  -- This one check is what actually closes the mobile/direct-API gap; the
  -- rest of this function is bookkeeping to keep the counter accurate for
  -- clients that never touch login/actions.ts at all.
  if private.is_profile_locked(v_user_id) then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'This account is temporarily locked after several failed sign-in attempts. Please try again later or reset your password.'
    );
  end if;

  v_valid := (event->>'valid')::boolean;

  if v_valid is false then
    select organisation_id, true into v_org_id, v_has_profile
    from public.profiles where id = v_user_id;
    if coalesce(v_has_profile, false) then
      perform private.record_failed_login_attempt(v_user_id, v_org_id);
    end if;
  elsif v_valid is true then
    perform private.clear_login_failures_for_profile(v_user_id);
  end if;

  return jsonb_build_object('decision', 'continue');
exception
  when others then
    -- See this file's header comment: an error here must never block a real
    -- sign-in platform-wide. Degrade to GoTrue's own default behaviour
    -- (continue) rather than propagate — the web app's is_account_locked
    -- pre-check remains a second, independent layer for the web client even
    -- if this hook is ever silently degrading.
    --
    -- RAISE WARNING (not EXCEPTION) — logs to Supabase's function/Postgres
    -- logs without aborting the function or propagating to GoTrue, so this
    -- stays genuinely fail-open while NOT being invisible: a fail-open path
    -- with no signal anywhere is exactly the trap this codebase's own
    -- "silent disable looks like an empty result" lesson describes (a
    -- degraded feature that looks identical to a healthy one, so nobody
    -- ever notices it broke). If this hook ever starts degrading for every
    -- sign-in because of, say, an unrelated future migration breaking
    -- account_lockouts, this is what would let it actually be found via
    -- query_logs/Postgres logs instead of silently disabling lockout
    -- platform-wide forever.
    raise warning 'hook_password_verification_attempt degraded to continue: %', sqlerrm;
    return jsonb_build_object('decision', 'continue');
end;
$$;

comment on function public.hook_password_verification_attempt(jsonb) is
  'Supabase Password Verification Attempt Auth Hook — GoTrue calls this on every password '
  'sign-in, from every client (web, mobile, or a direct API caller), after checking the '
  'password itself. Enforces account_lockouts at the one point common to all of them, unlike '
  'the web-only pre-check in apps/web/src/app/login/actions.ts. Registered via '
  'supabase/config.toml''s [auth.hook.password_verification_attempt]. Fails OPEN (returns '
  '"continue") on any internal error — see this file''s header comment for why.';

revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Self-check, same discipline as the prior migration's own (grant comments
-- can lie — verify live).
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'private.clear_login_failures_for_profile(uuid)', 'EXECUTE') then
    raise exception 'private.clear_login_failures_for_profile is EXECUTE-able by authenticated — should be reachable only via a SECURITY DEFINER wrapper';
  end if;
  if has_function_privilege('anon', 'private.clear_login_failures_for_profile(uuid)', 'EXECUTE') then
    raise exception 'private.clear_login_failures_for_profile is EXECUTE-able by anon';
  end if;

  if has_function_privilege('anon', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE') then
    raise exception 'hook_password_verification_attempt is EXECUTE-able by anon — must be reachable only by supabase_auth_admin (the role GoTrue calls hooks as)';
  end if;
  if has_function_privilege('authenticated', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE') then
    raise exception 'hook_password_verification_attempt is EXECUTE-able by authenticated — same reasoning as anon above';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE') then
    raise exception 'hook_password_verification_attempt is NOT EXECUTE-able by supabase_auth_admin — GoTrue itself would be unable to call its own hook, which fails every password sign-in on the platform (see this file''s header comment)';
  end if;
end $$;
