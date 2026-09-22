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
--     not a blanket unlock.
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
begin
  perform public.record_failed_login('alrfl-test-patient@example.invalid');

  select public.is_account_locked('alrfl-test-patient@example.invalid') into v_locked;
  select count(*) into v_in_app_count
  from public.notifications
  where recipient_id = (select v from alrfl_fixture where k = 'patient')
    and template = 'security.account_locked' and channel = 'in_app';
  select count(*) into v_email_count
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
  if v_locked is distinct from true or v_in_app_count <> 1 or v_email_count <> 1 then
    raise exception 'BROKEN: 5th failure did not lock+notify exactly once (locked=%, in_app=%, email=%)',
      v_locked, v_in_app_count, v_email_count;
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

select check_name, observed, expected, verdict
from alrfl_result
order by verdict desc, check_name;

rollback;
