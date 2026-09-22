-- ===========================================================================
-- Verification: 20260922201110_password_verification_hook_gotrue_level_lockout
--
--   * the hook REJECTS a sign-in for an already-locked account even when
--     valid=true (GoTrue's own view is "correct password") — this is the one
--     property that actually closes the mobile/direct-API lockout bypass;
--   * the hook does NOT reject an unlocked account on valid=false — only
--     records the failure, proving the reject path is scoped to real lock
--     state, not a blanket deny;
--   * five valid=false events through the hook alone (no app-layer
--     record_failed_login() call at all) lock the account, matching
--     record_failed_login()'s own threshold — same shared counter, two entry
--     points;
--   * a valid=true event clears an accumulated (but not yet locked) failure
--     count — the mobile-success-doesn't-clear-web-failures gap this
--     migration also closes;
--   * sabotage/fail-open — a garbage event (invalid UUID text) that would
--     raise inside the function body returns {"decision":"continue"}
--     instead of propagating an exception. This is the single most
--     important property in the whole file: an uncaught exception here
--     blocks every password sign-in on the platform (see the migration's own
--     header comment) — first proven as fail-OPEN here, then the same event
--     is fed through WITHOUT the exception handler (by temporarily
--     redefining the function without it) to confirm the sabotage actually
--     discriminates, i.e. that this event genuinely WOULD raise if the
--     handler weren't there, rather than the test vacuously passing because
--     nothing in that path ever throws to begin with;
--   * the real invocation path — calling the hook explicitly as
--     supabase_auth_admin (the role GoTrue itself calls hooks as), not just
--     asserting the grant exists — actually returns a decision rather than
--     a permission error.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it. Function
-- redefinitions in section 5 happen inside this same transaction and are
-- rolled back with everything else.
-- ===========================================================================

begin;

create temporary table hpva_fixture(k text primary key, v uuid) on commit drop;
create temporary table hpva_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org      uuid;
  v_locked   uuid := gen_random_uuid();
  v_unlocked uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_locked,   'hpva-locked-patient@example.invalid',   'x', now(), '{}', '{}'),
    (v_unlocked, 'hpva-unlocked-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_locked,   v_org, 'patient', 'HPVA Locked Patient'),
    (v_unlocked, v_org, 'patient', 'HPVA Unlocked Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- Lock v_locked via the pre-existing app-layer path, independent of the
  -- hook this file is testing — 5 failures per its own established threshold.
  perform public.record_failed_login('hpva-locked-patient@example.invalid');
  perform public.record_failed_login('hpva-locked-patient@example.invalid');
  perform public.record_failed_login('hpva-locked-patient@example.invalid');
  perform public.record_failed_login('hpva-locked-patient@example.invalid');
  perform public.record_failed_login('hpva-locked-patient@example.invalid');
  if not (select public.is_account_locked('hpva-locked-patient@example.invalid')) then
    raise exception 'SETUP FAILED: expected hpva-locked-patient to be locked before testing the hook';
  end if;

  insert into hpva_fixture(k, v) values ('org', v_org), ('locked', v_locked), ('unlocked', v_unlocked);
end $$;

-- ==========================================================================
-- 1. THE core property: a locked account is REJECTED by the hook even when
--    GoTrue reports valid=true (a genuinely correct password). This is what
--    a mobile client or a direct GoTrue REST caller — neither of which ever
--    calls is_account_locked()/record_failed_login() — actually hits.
-- ==========================================================================
do $$
declare
  v_locked uuid := (select v from hpva_fixture where k = 'locked');
  v_event  jsonb;
  v_result jsonb;
begin
  v_event := jsonb_build_object('user_id', v_locked::text, 'valid', true);
  v_result := public.hook_password_verification_attempt(v_event);

  insert into hpva_result values
    ('locked account + valid=true is rejected by the hook',
     coalesce(v_result->>'decision', 'null'), 'reject',
     case when v_result->>'decision' = 'reject' then 'PASS' else 'FAIL' end);
  if v_result->>'decision' is distinct from 'reject' then
    raise exception 'BROKEN: hook_password_verification_attempt let a CORRECT password through for a locked account (result=%) — the mobile/direct-API lockout bypass this migration exists to close is still open',
      v_result;
  end if;
end $$;

-- ==========================================================================
-- 2. Control — an UNLOCKED account with valid=false is NOT rejected (only
--    recorded). Proves check 1 discriminates on real lock state rather than
--    the hook rejecting indiscriminately.
-- ==========================================================================
do $$
declare
  v_unlocked uuid := (select v from hpva_fixture where k = 'unlocked');
  v_event    jsonb;
  v_result   jsonb;
  v_attempts integer;
begin
  v_event := jsonb_build_object('user_id', v_unlocked::text, 'valid', false);
  v_result := public.hook_password_verification_attempt(v_event);

  select failed_attempts into v_attempts from public.account_lockouts where profile_id = v_unlocked;

  insert into hpva_result values
    ('unlocked account + valid=false: hook continues (does not reject)',
     coalesce(v_result->>'decision', 'null'), 'continue',
     case when v_result->>'decision' = 'continue' then 'PASS' else 'FAIL' end);
  insert into hpva_result values
    ('unlocked account + valid=false: hook recorded the failure',
     coalesce(v_attempts::text, 'null'), '1',
     case when v_attempts = 1 then 'PASS' else 'FAIL' end);
  if v_result->>'decision' is distinct from 'continue' or v_attempts <> 1 then
    raise exception 'BROKEN: hook mishandled an unlocked account''s failed attempt (result=%, attempts=%)',
      v_result, v_attempts;
  end if;
end $$;

-- ==========================================================================
-- 3. Five valid=false events through the hook ALONE (never calling
--    record_failed_login() directly) lock the account — proves the hook is
--    a genuine, independent entry point into the SAME counter, not a path
--    that only checks and never writes.
-- ==========================================================================
do $$
declare
  v_unlocked uuid := (select v from hpva_fixture where k = 'unlocked');
  v_event    jsonb;
  v_result   jsonb;
  v_locked   boolean;
begin
  v_event := jsonb_build_object('user_id', v_unlocked::text, 'valid', false);
  -- Already has 1 recorded failure from check 2 above; 4 more via the hook
  -- reaches the 5-failure threshold entirely through this entry point.
  perform public.hook_password_verification_attempt(v_event);
  perform public.hook_password_verification_attempt(v_event);
  perform public.hook_password_verification_attempt(v_event);
  v_result := public.hook_password_verification_attempt(v_event);

  select public.is_account_locked('hpva-unlocked-patient@example.invalid') into v_locked;

  insert into hpva_result values
    ('5 valid=false events through the hook alone lock the account',
     coalesce(v_locked::text, 'null'), 'true',
     case when v_locked = true then 'PASS' else 'FAIL' end);
  if v_locked is distinct from true then
    raise exception 'BROKEN: the hook does not actually drive the shared lockout counter to a real lock (locked=%)', v_locked;
  end if;

  -- And now that it IS locked, the very next attempt — even a fresh
  -- valid=true — must reject, mirroring check 1 but reached purely through
  -- repeated hook calls rather than the app-layer path.
  v_result := public.hook_password_verification_attempt(
    jsonb_build_object('user_id', v_unlocked::text, 'valid', true));
  insert into hpva_result values
    ('immediately after hook-driven lock, a valid=true event is still rejected',
     coalesce(v_result->>'decision', 'null'), 'reject',
     case when v_result->>'decision' = 'reject' then 'PASS' else 'FAIL' end);
  if v_result->>'decision' is distinct from 'reject' then
    raise exception 'BROKEN: a hook-driven lock did not actually block the immediate next sign-in (result=%)', v_result;
  end if;
end $$;

-- ==========================================================================
-- 4. valid=true clears an accumulated (but not yet locked) failure count —
--    a mobile-only success now resets a counter run up on web, and vice
--    versa, without needing a session (clear_login_failures() alone needs
--    auth.uid(), which does not exist yet at hook time).
-- ==========================================================================
do $$
declare
  v_org      uuid := (select v from hpva_fixture where k = 'org');
  v_patient  uuid := gen_random_uuid();
  v_attempts integer;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'hpva-clears-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'HPVA Clears Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  perform public.record_failed_login('hpva-clears-patient@example.invalid');
  perform public.record_failed_login('hpva-clears-patient@example.invalid');
  perform public.record_failed_login('hpva-clears-patient@example.invalid');

  select failed_attempts into v_attempts from public.account_lockouts where profile_id = v_patient;
  if v_attempts <> 3 then
    raise exception 'SETUP FAILED: expected 3 recorded failures before the clearing check (got %)', v_attempts;
  end if;

  perform public.hook_password_verification_attempt(
    jsonb_build_object('user_id', v_patient::text, 'valid', true));

  select failed_attempts into v_attempts from public.account_lockouts where profile_id = v_patient;

  insert into hpva_result values
    ('a valid=true hook event clears an accumulated failure count',
     coalesce(v_attempts::text, 'null'), '0',
     case when v_attempts = 0 then 'PASS' else 'FAIL' end);
  if v_attempts <> 0 then
    raise exception 'BROKEN: hook did not clear the failure counter on a successful sign-in (attempts=%)', v_attempts;
  end if;
end $$;

-- ==========================================================================
-- 5. THE most important property in this file — fail-OPEN on an internal
--    error. A garbage user_id (invalid UUID syntax) is fed through the real
--    hook and MUST return {"decision":"continue"}, never raise: an uncaught
--    exception here blocks every password sign-in on the platform (see the
--    migration's own header comment), which is categorically worse than the
--    lockout bug this migration closes.
--
--    Sabotage: the same garbage event is then fed through a temporary
--    redefinition of the function WITHOUT the exception handler, inside
--    this same transaction, to confirm this event genuinely WOULD raise if
--    the handler weren't there — proving check 5a isn't vacuously passing
--    because nothing on this path can throw to begin with. The real
--    function is restored immediately after (still inside the same
--    transaction, which is rolled back regardless).
-- ==========================================================================
do $$
declare
  v_garbage_event jsonb := jsonb_build_object('user_id', 'not-a-real-uuid', 'valid', false);
  v_result jsonb;
  v_raised boolean := false;
begin
  v_result := public.hook_password_verification_attempt(v_garbage_event);

  insert into hpva_result values
    ('5a. a garbage event fails OPEN (decision=continue), does not raise',
     coalesce(v_result->>'decision', 'null'), 'continue',
     case when v_result->>'decision' = 'continue' then 'PASS' else 'FAIL' end);
  if v_result->>'decision' is distinct from 'continue' then
    raise exception 'BROKEN: hook_password_verification_attempt did not fail open on a garbage event (result=%) — this event must never be able to raise, or every password sign-in on the platform breaks',
      v_result;
  end if;

  -- Sabotage: strip the exception handler and confirm THIS SAME event would
  -- have raised without it.
  create or replace function public.hook_password_verification_attempt(event jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $body$
  declare
    v_user_id uuid;
  begin
    v_user_id := (event->>'user_id')::uuid;
    return jsonb_build_object('decision', 'continue');
  end;
  $body$;

  begin
    perform public.hook_password_verification_attempt(v_garbage_event);
  exception
    when others then
      v_raised := true;
  end;

  insert into hpva_result values
    ('5b. sabotage — without the handler, this SAME event genuinely raises',
     v_raised::text, 'true',
     case when v_raised then 'PASS' else 'FAIL' end);
  if not v_raised then
    raise exception 'SABOTAGE FAILED: the garbage event did not raise even without an exception handler — check 5a is not actually proving anything (the fail-open path was never exercised)';
  end if;
end $$;

-- Restore the real function so checks below run against the actual
-- implementation, not the stripped sabotage version — the sabotage
-- redefinition above is visible to the rest of THIS open transaction until
-- it commits or rolls back, so waiting for the closing ROLLBACK isn't
-- enough on its own. Body kept identical to
-- 20260922201110_password_verification_hook_gotrue_level_lockout.sql —
-- if that migration's hook logic ever changes, this copy must change too,
-- or this file starts testing a function that no longer matches production.
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $body$
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
    return jsonb_build_object('decision', 'continue');
end;
$body$;

-- ==========================================================================
-- 6. The real invocation path: call the hook explicitly AS
--    supabase_auth_admin (the role GoTrue itself calls hooks as), not just
--    postgres/superuser — proves the grant this migration's own self-check
--    asserts is not merely present in pg_proc.proacl but actually usable,
--    i.e. GoTrue itself would not be blocked from calling its own hook.
-- ==========================================================================
do $$
declare
  v_unlocked uuid := (select v from hpva_fixture where k = 'unlocked');
  v_result   jsonb;
begin
  set local role supabase_auth_admin;
  -- v_unlocked is already locked from check 3 above — reuse it rather than
  -- creating a third fixture patient, this check only cares whether the
  -- CALL itself succeeds under this role, not the decision content.
  v_result := public.hook_password_verification_attempt(
    jsonb_build_object('user_id', v_unlocked::text, 'valid', true));
  reset role;

  insert into hpva_result values
    ('calling the hook AS supabase_auth_admin succeeds and returns a decision',
     coalesce(v_result->>'decision', 'null'), 'reject',
     case when v_result->>'decision' = 'reject' then 'PASS' else 'FAIL' end);
  if v_result->>'decision' is distinct from 'reject' then
    raise exception 'BROKEN: invoking the hook as supabase_auth_admin did not behave like the real GoTrue call path would (result=%) — check the EXECUTE grant and SECURITY DEFINER chain',
      v_result;
  end if;
exception
  when insufficient_privilege then
    reset role;
    raise exception 'BROKEN: supabase_auth_admin cannot EXECUTE public.hook_password_verification_attempt — GoTrue itself would be unable to call its own hook, which fails every password sign-in on the platform';
end $$;

select check_name, observed, expected, verdict
from hpva_result
order by verdict desc, check_name;

rollback;
