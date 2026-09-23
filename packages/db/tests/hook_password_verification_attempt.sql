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
--   * supabase_auth_admin (the role GoTrue itself calls hooks as) genuinely
--     has both grants Postgres requires to invoke the function at all —
--     EXECUTE on the function AND USAGE on its containing schema. NOT
--     verified via `SET ROLE supabase_auth_admin`: a real CI run showed that
--     fails with "permission denied to set role" even as postgres (not a
--     member of supabase_auth_admin in Supabase's role hierarchy), and
--     GoTrue never role-switches either — it connects to Postgres natively
--     AS supabase_auth_admin over its own separate connection. See section
--     6's own comment for the full reasoning.
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
--    Sabotage: patches the LIVE function definition (via pg_get_functiondef,
--    same pattern as packages/db/tests/critical_notification_dead_letter_
--    without_pathway.sql section 6) rather than hand-copying the function
--    body a second time — a hardcoded duplicate silently drifts from the
--    real migration the moment its logic changes; this reads the function
--    that's actually live at test time and surgically disables just the
--    exception handler's swallowing behaviour (re-raise after logging,
--    instead of returning continue), so the redefinition tracks whatever
--    the real function currently is. No manual "restore" step needed
--    either — this whole file is one transaction, closed by the ROLLBACK
--    at the bottom, which undoes the sabotage redefinition along with
--    everything else.
-- ==========================================================================
do $$
declare
  v_garbage_event jsonb := jsonb_build_object('user_id', 'not-a-real-uuid', 'valid', false);
  v_result jsonb;
  v_raised boolean := false;
  v_def    text;
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

  -- Sabotage: re-raise instead of swallowing, right after the same RAISE
  -- WARNING the real handler logs with — 'sqlerrm;' is the unique anchor
  -- (appears exactly once, in that one line).
  v_def := pg_get_functiondef('public.hook_password_verification_attempt(jsonb)'::regprocedure);
  if v_def not like '%sqlerrm;%' then
    raise exception 'SABOTAGE SETUP FAILED: the hook no longer contains the anchor this test patches (expected a RAISE WARNING ending in sqlerrm; inside the exception handler)';
  end if;
  execute replace(v_def, 'sqlerrm;', 'sqlerrm; raise;');

  begin
    perform public.hook_password_verification_attempt(v_garbage_event);
  exception
    when others then
      v_raised := true;
  end;

  insert into hpva_result values
    ('5b. sabotage — without the handler swallowing it, this SAME event genuinely raises',
     v_raised::text, 'true',
     case when v_raised then 'PASS' else 'FAIL' end);
  if not v_raised then
    raise exception 'SABOTAGE FAILED: the garbage event did not raise even with the handler patched to re-raise — check 5a is not actually proving anything (the fail-open path was never exercised)';
  end if;
end $$;

-- ==========================================================================
-- 6. Proves supabase_auth_admin (the role GoTrue itself calls hooks as) can
--    actually reach the hook — NOT via `SET ROLE supabase_auth_admin`, which
--    a real CI run showed fails with SQLSTATE 42501 ("permission denied to
--    set role") even as postgres: postgres is not a member of
--    supabase_auth_admin in Supabase's own role hierarchy (confirmed live,
--    not assumed — this project has no baseline to compare against, this is
--    the first hook this codebase has ever added), and GoTrue itself never
--    role-switches either — it connects to Postgres natively AS
--    supabase_auth_admin, with its own separate connection, never via SET
--    ROLE from postgres. So the only thing actually verifiable from a
--    postgres-connected script is that the underlying grants — the exact
--    two things that would block that separate GoTrue connection —
--    genuinely exist: EXECUTE on the function itself, and USAGE on its
--    containing schema (Postgres requires BOTH to invoke a function; see
--    this migration's own comment on the USAGE grant for why EXECUTE alone
--    isn't enough). This is the same pair of checks the migration's own
--    self-check DO block already asserts — restated here as its own
--    PASS/FAIL row for consistency with the rest of this file's result
--    table, not because the migration's check is untrusted.
-- ==========================================================================
do $$
declare
  v_has_exec  boolean;
  v_has_usage boolean;
begin
  select has_function_privilege('supabase_auth_admin', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE')
    into v_has_exec;
  select has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') into v_has_usage;

  insert into hpva_result values
    ('supabase_auth_admin has EXECUTE on hook_password_verification_attempt',
     coalesce(v_has_exec::text, 'null'), 'true',
     case when v_has_exec then 'PASS' else 'FAIL' end);
  insert into hpva_result values
    ('supabase_auth_admin has USAGE on schema public (required to invoke the function at all, EXECUTE alone is not sufficient)',
     coalesce(v_has_usage::text, 'null'), 'true',
     case when v_has_usage then 'PASS' else 'FAIL' end);
  if not (coalesce(v_has_exec, false) and coalesce(v_has_usage, false)) then
    raise exception 'BROKEN: supabase_auth_admin is missing a grant this hook needs to be callable at all (EXECUTE=%, schema USAGE=%) — GoTrue itself would be unable to call its own hook, which fails every password sign-in on the platform',
      v_has_exec, v_has_usage;
  end if;
end $$;

select check_name, observed, expected, verdict
from hpva_result
order by verdict desc, check_name;

rollback;
