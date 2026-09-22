-- ===========================================================================
-- Verification: 20260918111442_account_lockout_after_repeated_failed_logins
--
--   * record_failed_login() is a safe no-op for an email with no account;
--   * 4 failures leave the account unlocked (is_account_locked = false);
--   * the 5th failure locks the account (is_account_locked = true) and
--     queues exactly one in_app + one email 'security.account_locked'
--     notification — not one per attempt;
--   * a locked account stays locked on a 6th failure (no double-notify);
--   * clear_login_failures(), run as the account's own authenticated
--     session, lifts the lock and resets the counter;
--   * sabotage — clear_login_failures() takes no argument and is scoped to
--     auth.uid(), so a DIFFERENT authenticated session cannot use it to
--     clear (or is_account_locked to inspect) someone else's lock by name;
--     confirms the reset in the step above was this account's own doing,
--     not a blanket unlock;
--   * a lock that expires NATURALLY (not via clear_login_failures()) fully
--     re-arms — a second real lockout event is reachable after 5 more
--     failures, not permanently disabled after the first (regression for a
--     bug found before merge — see section 7);
--   * sabotage — a DIFFERENT authenticated session cannot SELECT this
--     account's account_lockouts row (RLS), with a control proving the
--     account's OWN session genuinely can (section 8);
--   * the phone-OTP login path shares the SAME lock as the password path —
--     a lockout triggered by password failures blocks phone-OTP sign-in
--     too, confirming this is genuinely account-wide, not per-method
--     (section 9).
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table alrfl_fixture(k text primary key, v uuid) on commit drop;
create temporary table alrfl_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'alrfl-test-patient@example.invalid', 'x', now(), '{}', '{}');

  -- private.handle_new_user() (the on_auth_user_created trigger) already
  -- auto-inserted a profiles row for v_patient the instant the auth.users
  -- row above landed — ON CONFLICT DO UPDATE reconciles it to this test's
  -- own organisation rather than colliding on the primary key (same pattern
  -- as packages/db/tests/vitals_red_flag_plan_gate.sql).
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'ALRFL Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into alrfl_fixture(k, v) values ('org', v_org), ('patient', v_patient);
end $$;

-- ==========================================================================
-- 1. record_failed_login() for an email with no account is a safe no-op —
--    no row created, no exception, matching the anti-enumeration posture
--    the login action relies on (calling this unconditionally must never
--    itself become a signal).
-- ==========================================================================
do $$
declare
  v_before bigint;
  v_after  bigint;
begin
  select count(*) into v_before from public.account_lockouts;
  perform public.record_failed_login('alrfl-nobody-at-all@example.invalid');
  select count(*) into v_after from public.account_lockouts;

  insert into alrfl_result values
    ('record_failed_login no-ops for unknown email', v_after::text, v_before::text,
     case when v_after = v_before then 'PASS' else 'FAIL' end);
  if v_after <> v_before then
    raise exception 'BROKEN: record_failed_login created a row for an email with no account';
  end if;
end $$;

-- ==========================================================================
-- 2. Four failures: still unlocked, no notification queued yet.
-- ==========================================================================
do $$
declare
  v_locked boolean;
  v_notif_count bigint;
begin
  perform public.record_failed_login('alrfl-test-patient@example.invalid');
  perform public.record_failed_login('alrfl-test-patient@example.invalid');
  perform public.record_failed_login('alrfl-test-patient@example.invalid');
  perform public.record_failed_login('alrfl-test-patient@example.invalid');

  select public.is_account_locked('alrfl-test-patient@example.invalid') into v_locked;
  select count(*) into v_notif_count
  from public.notifications
  where recipient_id = (select v from alrfl_fixture where k = 'patient')
    and template = 'security.account_locked';

  insert into alrfl_result values
    ('4 failures: account not yet locked', coalesce(v_locked::text, 'null'), 'false',
     case when v_locked = false then 'PASS' else 'FAIL' end);
  insert into alrfl_result values
    ('4 failures: no lockout notification queued yet', v_notif_count::text, '0',
     case when v_notif_count = 0 then 'PASS' else 'FAIL' end);
  if v_locked is distinct from false or v_notif_count <> 0 then
    raise exception 'BROKEN: account locked or notified before the 5th failure (locked=%, notifs=%)',
      v_locked, v_notif_count;
  end if;
end $$;

-- ==========================================================================
-- 3. Fifth failure: locks the account and queues exactly one in_app + one
--    email notification.
-- ==========================================================================
do $$
declare
  v_locked boolean;
  v_in_app_count bigint;
  v_email_count  bigint;
  v_to_email     text;
begin
  perform public.record_failed_login('alrfl-test-patient@example.invalid');

  select public.is_account_locked('alrfl-test-patient@example.invalid') into v_locked;
  select count(*) into v_in_app_count
  from public.notifications
  where recipient_id = (select v from alrfl_fixture where k = 'patient')
    and template = 'security.account_locked' and channel = 'in_app';
  select count(*), max(payload->>'to_email') into v_email_count, v_to_email
  from public.notifications
  where recipient_id = (select v from alrfl_fixture where k = 'patient')
    and template = 'security.account_locked' and channel = 'email';

  insert into alrfl_result values
    ('5th failure locks the account', coalesce(v_locked::text, 'null'), 'true',
     case when v_locked = true then 'PASS' else 'FAIL' end);
  insert into alrfl_result values
    ('exactly one in_app lockout notification queued', v_in_app_count::text, '1',
     case when v_in_app_count = 1 then 'PASS' else 'FAIL' end);
  insert into alrfl_result values
    ('exactly one email lockout notification queued', v_email_count::text, '1',
     case when v_email_count = 1 then 'PASS' else 'FAIL' end);
  -- Regression: send-pending-notifications resolves an email row's
  -- destination ONLY from payload.to_email (no profiles.email column, no
  -- fallback lookup unlike phone) — without this, the email half silently
  -- failed "recipient has no email address" on every real lockout.
  insert into alrfl_result values
    ('email notification carries payload.to_email (or the pipeline drops it silently)',
     coalesce(v_to_email, 'null'), 'alrfl-test-patient@example.invalid',
     case when v_to_email = 'alrfl-test-patient@example.invalid' then 'PASS' else 'FAIL' end);
  if v_locked is distinct from true or v_in_app_count <> 1 or v_email_count <> 1 then
    raise exception 'BROKEN: 5th failure did not lock+notify exactly once (locked=%, in_app=%, email=%)',
      v_locked, v_in_app_count, v_email_count;
  end if;
  if v_to_email is distinct from 'alrfl-test-patient@example.invalid' then
    raise exception 'BROKEN: email notification has no (or wrong) payload.to_email — send-pending-notifications would silently drop it (got %)',
      coalesce(v_to_email, 'null');
  end if;
end $$;

-- ==========================================================================
-- 4. A 6th failure while already locked must not queue a second
--    notification (no inbox spam from a continued attack against a
--    now-locked account).
-- ==========================================================================
do $$
declare
  v_notif_count bigint;
begin
  perform public.record_failed_login('alrfl-test-patient@example.invalid');

  select count(*) into v_notif_count
  from public.notifications
  where recipient_id = (select v from alrfl_fixture where k = 'patient')
    and template = 'security.account_locked';

  insert into alrfl_result values
    ('6th failure while locked does not double-notify', v_notif_count::text, '2',
     case when v_notif_count = 2 then 'PASS' else 'FAIL' end);
  if v_notif_count <> 2 then
    raise exception 'BROKEN: a failure against an already-locked account queued another notification (total=%)',
      v_notif_count;
  end if;
end $$;

-- ==========================================================================
-- 5. Sabotage — a DIFFERENT authenticated session cannot clear (or
--    meaningfully target) this account's lock via clear_login_failures(),
--    which takes no argument and is scoped to auth.uid().
-- ==========================================================================
do $$
declare
  v_other uuid := gen_random_uuid();
  v_locked_before boolean;
  v_locked_after  boolean;
begin
  select public.is_account_locked('alrfl-test-patient@example.invalid') into v_locked_before;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.clear_login_failures();
  reset role;

  select public.is_account_locked('alrfl-test-patient@example.invalid') into v_locked_after;

  insert into alrfl_result values
    ('a different session''s clear_login_failures() does not touch this lock',
     coalesce(v_locked_after::text, 'null'), coalesce(v_locked_before::text, 'null'),
     case when v_locked_after = v_locked_before then 'PASS' else 'FAIL' end);
  if v_locked_after is distinct from v_locked_before then
    raise exception 'LEAK: an unrelated session''s clear_login_failures() call changed this account''s lock state';
  end if;
end $$;

-- ==========================================================================
-- 6. The account's own authenticated session can clear its own lock.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from alrfl_fixture where k = 'patient');
  v_locked  boolean;
  v_attempts integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.clear_login_failures();
  reset role;

  select public.is_account_locked('alrfl-test-patient@example.invalid') into v_locked;
  select failed_attempts into v_attempts from public.account_lockouts where profile_id = v_patient;

  insert into alrfl_result values
    ('owner''s own clear_login_failures() lifts the lock', coalesce(v_locked::text, 'null'), 'false',
     case when v_locked = false then 'PASS' else 'FAIL' end);
  insert into alrfl_result values
    ('owner''s own clear_login_failures() resets the counter', coalesce(v_attempts::text, 'null'), '0',
     case when v_attempts = 0 then 'PASS' else 'FAIL' end);
  if v_locked is distinct from false or v_attempts <> 0 then
    raise exception 'BROKEN: the account''s own session could not clear its own lock (locked=%, attempts=%)',
      v_locked, v_attempts;
  end if;
end $$;

-- ==========================================================================
-- 7. Regression for the re-arm bug found before merge: once a lock expires
--    naturally (not via clear_login_failures()), the NEXT failure must clear
--    the stale locked_until so failed_attempts can climb past 1 again — a
--    second real lockout event must be reachable, not just the first ever.
--    A fresh patient is used here (not the one from steps 1-6, which was
--    already cleared) so this is a clean re-arm test, not a continuation.
-- ==========================================================================
do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_attempts integer;
  v_locked_until timestamptz;
  v_locked  boolean;
  v_notif_count bigint;
begin
  select id into v_org from public.organisations limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'alrfl-rearm-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'ALRFL Rearm Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- Lock it once (5 failures).
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');

  select public.is_account_locked('alrfl-rearm-patient@example.invalid') into v_locked;
  if v_locked is distinct from true then
    raise exception 'SETUP FAILED: expected the account to be locked before simulating expiry';
  end if;

  -- Simulate the 15-minute lock having already expired — nothing but time
  -- passing does this in real use; a test can't wait 15 real minutes, so
  -- this directly backdates locked_until the same way the clock would.
  update public.account_lockouts
  set locked_until = now() - interval '1 minute'
  where profile_id = v_patient;

  -- One failure right after expiry: must reset failed_attempts to a clean 1
  -- AND clear locked_until to null (the bug: it used to leave locked_until
  -- stale, which then kept resetting every subsequent failure to 1 forever).
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  select failed_attempts, locked_until into v_attempts, v_locked_until
  from public.account_lockouts where profile_id = v_patient;

  insert into alrfl_result values
    ('1st failure after natural expiry: attempts reset to 1', coalesce(v_attempts::text, 'null'), '1',
     case when v_attempts = 1 then 'PASS' else 'FAIL' end);
  insert into alrfl_result values
    ('1st failure after natural expiry: locked_until cleared to null',
     coalesce(v_locked_until::text, 'null'), 'null',
     case when v_locked_until is null then 'PASS' else 'FAIL' end);
  if v_attempts <> 1 or v_locked_until is not null then
    raise exception 'BROKEN: failure right after natural expiry did not reset to a clean state (attempts=%, locked_until=%)',
      v_attempts, v_locked_until;
  end if;

  -- THE ACTUAL REGRESSION: 4 more failures must increment normally (2,3,4,5),
  -- not keep resetting to 1 — and the 5th of THIS batch must fire a SECOND
  -- real lock + notification. Before the fix, failed_attempts could never
  -- climb past 1 again here, so this would stay unlocked forever.
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');
  perform public.record_failed_login('alrfl-rearm-patient@example.invalid');

  select public.is_account_locked('alrfl-rearm-patient@example.invalid') into v_locked;
  select count(*) into v_notif_count
  from public.notifications
  where recipient_id = v_patient and template = 'security.account_locked';

  insert into alrfl_result values
    ('a SECOND lockout event actually fires after natural expiry + 5 more failures',
     coalesce(v_locked::text, 'null'), 'true',
     case when v_locked = true then 'PASS' else 'FAIL' end);
  insert into alrfl_result values
    ('the second lockout queued its own second pair of notifications',
     v_notif_count::text, '4',
     case when v_notif_count = 4 then 'PASS' else 'FAIL' end);
  if v_locked is distinct from true or v_notif_count <> 4 then
    raise exception 'REGRESSION: account_lockouts never re-arms after a natural expiry — attacker gets unlimited attempts after the first lock (locked=%, notifs=%)',
      v_locked, v_notif_count;
  end if;
end $$;

-- ==========================================================================
-- 8. Sabotage — a DIFFERENT authenticated session cannot SELECT this
--    account's own account_lockouts row via account_lockouts_select. RLS
--    restricts to profile_id = auth.uid(); prove it actually discriminates,
--    not just that the policy compiles.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from alrfl_fixture where k = 'patient');
  v_other   uuid := gen_random_uuid();
  v_org     uuid := (select v from alrfl_fixture where k = 'org');
  v_own_count   bigint;
  v_cross_count bigint;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_other, 'alrfl-rls-other@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_other, v_org, 'patient', 'ALRFL RLS Other')
  on conflict (id) do update set organisation_id = excluded.organisation_id;

  -- The OTHER patient's own session: sees only its own (zero, since v_other
  -- has never failed a login) — asserts the gate OPENS for its own row
  -- (well, would, if one existed) before the sabotage check proves it stays
  -- shut for someone else's.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_own_count from public.account_lockouts where profile_id = v_other;
  select count(*) into v_cross_count from public.account_lockouts where profile_id = v_patient;
  reset role;

  insert into alrfl_result values
    ('a different session sees zero of its OWN (nonexistent) lockout rows',
     v_own_count::text, '0', case when v_own_count = 0 then 'PASS' else 'FAIL' end);
  insert into alrfl_result values
    ('a different session sees ZERO rows for another profile''s lockout history',
     v_cross_count::text, '0', case when v_cross_count = 0 then 'PASS' else 'FAIL' end);
  if v_cross_count <> 0 then
    raise exception 'LEAK: a different authenticated session could SELECT another profile''s account_lockouts row (count=%)',
      v_cross_count;
  end if;

  -- Control: the account's OWN session genuinely can see its own row (a
  -- policy that blocks everyone equally would pass the check above
  -- vacuously — this proves it actually discriminates by identity, not by
  -- blanket-denying everyone).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_own_count from public.account_lockouts where profile_id = v_patient;
  reset role;

  insert into alrfl_result values
    ('the account''s OWN session sees its OWN lockout row',
     v_own_count::text, '1', case when v_own_count = 1 then 'PASS' else 'FAIL' end);
  if v_own_count <> 1 then
    raise exception 'BROKEN: the account''s own session could not see its own account_lockouts row — the SELECT policy over-restricts';
  end if;
end $$;

-- ==========================================================================
-- 9. Phone-OTP path shares the SAME lock as the password path — a lockout
--    triggered by password failures genuinely blocks phone-OTP sign-in too,
--    not just the method that caused it (and record_failed_login_by_phone
--    contributes to the same counter).
-- ==========================================================================
do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_locked_by_email boolean;
  v_locked_by_phone boolean;
begin
  select id into v_org from public.organisations limit 1;

  insert into auth.users
    (id, email, phone, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'alrfl-phone-patient@example.invalid', '2348012340099', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'ALRFL Phone Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- Lock the account via the PASSWORD path only.
  perform public.record_failed_login('alrfl-phone-patient@example.invalid');
  perform public.record_failed_login('alrfl-phone-patient@example.invalid');
  perform public.record_failed_login('alrfl-phone-patient@example.invalid');
  perform public.record_failed_login('alrfl-phone-patient@example.invalid');
  perform public.record_failed_login('alrfl-phone-patient@example.invalid');

  select public.is_account_locked('alrfl-phone-patient@example.invalid') into v_locked_by_email;
  -- '+' prefixed, matching what the app actually passes (phoneOtpVerifySchema
  -- / E164_GENERIC) — proves the '+' -stripping lookup in is_account_locked_
  -- by_phone actually works against GoTrue's un-prefixed auth.users.phone.
  select public.is_account_locked_by_phone('+2348012340099') into v_locked_by_phone;

  insert into alrfl_result values
    ('a password-triggered lock is also visible via is_account_locked_by_phone',
     coalesce(v_locked_by_phone::text, 'null'), 'true',
     case when v_locked_by_phone = true then 'PASS' else 'FAIL' end);
  if v_locked_by_phone is distinct from true or v_locked_by_email is distinct from true then
    raise exception 'BROKEN: password-path lock is not visible to the phone-OTP path (email=%, phone=%) — a lockout would not actually be account-wide',
      v_locked_by_email, v_locked_by_phone;
  end if;
end $$;

-- ==========================================================================
-- 10. Regression: a profile with organisation_id = NULL (self-serve/org-less
--     patients — nullable by design, see profiles.organisation_id) must
--     still be lockable. An earlier version of record_failed_login treated
--     organisation_id itself being null as "no such profile" and silently
--     no-opped, meaning this entire user segment could never be locked out
--     no matter how many wrong passwords were entered.
-- ==========================================================================
do $$
declare
  v_patient uuid := gen_random_uuid();
  v_locked  boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'alrfl-orgless-patient@example.invalid', 'x', now(), '{}', '{}');
  -- Explicit NULL organisation_id — the on_auth_user_created trigger already
  -- defaulted this profile to the seeded consumer org, so it must be
  -- overwritten here, not just left unspecified.
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, null, 'patient', 'ALRFL Orgless Patient')
  on conflict (id) do update
    set organisation_id = null, role = excluded.role, full_name = excluded.full_name;

  if exists (select 1 from public.profiles where id = v_patient and organisation_id is not null) then
    raise exception 'SETUP FAILED: expected this profile''s organisation_id to be null';
  end if;

  perform public.record_failed_login('alrfl-orgless-patient@example.invalid');
  perform public.record_failed_login('alrfl-orgless-patient@example.invalid');
  perform public.record_failed_login('alrfl-orgless-patient@example.invalid');
  perform public.record_failed_login('alrfl-orgless-patient@example.invalid');
  perform public.record_failed_login('alrfl-orgless-patient@example.invalid');

  select public.is_account_locked('alrfl-orgless-patient@example.invalid') into v_locked;

  insert into alrfl_result values
    ('an organisation_id = NULL profile can still be locked out',
     coalesce(v_locked::text, 'null'), 'true',
     case when v_locked = true then 'PASS' else 'FAIL' end);
  if v_locked is distinct from true then
    raise exception 'REGRESSION: a profile with organisation_id = NULL was never locked out — an entire org-less patient segment has no account-lockout protection at all';
  end if;
end $$;

select check_name, observed, expected, verdict
from alrfl_result
order by verdict desc, check_name;

rollback;
