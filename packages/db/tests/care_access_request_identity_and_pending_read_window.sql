-- ===========================================================================
-- Verification: 20260905010446 — the two residuals a second adversarial pass
-- found in 20260905000206's care_access_requests hardening.
--
--   HOLE 1  care_access_requests_update_cancel pinned only initiated_by and
--           status = 'cancelled'. A direct PostgREST PATCH could therefore
--           re-point profile_id / counterparty_user_id / permission_level /
--           relationship at cancel time: not a disclosure, but it fires the
--           responded notification at a stranger and corrupts the audit
--           record of who asked whom for what.
--   HOLE 2  profiles_select_pending_care_access keyed only on
--           status = 'pending' — and the requester is the party who decides
--           whether a row ever stops being pending, so one phone-number
--           lookup bought a PERMANENT whole-row read of the other person's
--           profile.
--
-- What is checked here, and why each case earns its place:
--   1. The legitimate flow still works end to end: request by phone, the
--      named acceptor can read the initiator's profile while the request is
--      live, and accepting still produces a real profile_access grant.
--   2. Re-pointing a request at cancel time is refused, both for profile_id
--      (which the tightened policy also catches) and for the counterparty
--      (which it cannot: the caller is still a named party, so only a trigger
--      comparing against OLD can see the change).
--   3. Sabotage for case 2: with the guard trigger disabled, the counterparty
--      rewrite succeeds again. If this ever reports STILL REFUSED, case 2's
--      second half is vacuous.
--   4. A request older than the 14-day window no longer unlocks the profile
--      read, while a fresh one still does (case 1 is the control).
--   5. Sabotage for case 4: with the time bound removed from the policy, the
--      stale request unlocks the read again.
--   6. A request whose own expires_at has passed unlocks nothing.
--   7. The creation cap refuses a sixth request in a rolling 24 hours, and
--      the five before it all succeed (a cap that refused everything would
--      pass case 7 while breaking the product).
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table cairw_fixture(k text primary key, v uuid) on commit drop;
create temporary table cairw_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;
grant insert, select on cairw_result to authenticated;

do $$
declare
  v_org   uuid;
  v_owner uuid := gen_random_uuid();
  v_kin   uuid := gen_random_uuid();
  v_third uuid := gen_random_uuid();
  v_stale uuid := gen_random_uuid();
  v_exp   uuid := gen_random_uuid();
  v_id    uuid;
  i       integer;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type) values ('CAIRW Test Org', 'clinic')
    returning id into v_org;
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_owner, 'cairw-owner@example.invalid', 'x', now(), '{}', '{}'),
    (v_kin,   'cairw-kin@example.invalid',   'x', now(), '{}', '{}'),
    (v_third, 'cairw-third@example.invalid', 'x', now(), '{}', '{}'),
    (v_stale, 'cairw-stale@example.invalid', 'x', now(), '{}', '{}'),
    (v_exp,   'cairw-exp@example.invalid',   'x', now(), '{}', '{}');

  -- `on conflict do update`: a trigger on auth.users already provisions the
  -- profiles row. The owner carries the columns the disclosure exposed, so a
  -- regression shows up as real personal data rather than an empty row.
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_pregnant)
  values (v_owner, v_org, 'patient', 'CAIRW Owner', '+2348039100101', '1990-01-01', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth, is_pregnant = excluded.is_pregnant;

  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values
    (v_kin,   v_org, 'patient', 'CAIRW Kin',   '+2348039100102'),
    (v_third, v_org, 'patient', 'CAIRW Third', '+2348039100103'),
    (v_stale, v_org, 'patient', 'CAIRW Stale', '+2348039100104'),
    (v_exp,   v_org, 'patient', 'CAIRW Expired', '+2348039100105')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, phone = excluded.phone;

  -- Four more patients, purely to give case 7 distinct people to ask for.
  for i in 1..4 loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_id, 'cairw-cap' || i || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone)
    values (v_id, v_org, 'patient', 'CAIRW Cap ' || i, '+23480391002' || lpad(i::text, 2, '0'))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
      full_name = excluded.full_name, phone = excluded.phone;
    insert into cairw_fixture values ('cap' || i, v_id);
  end loop;

  insert into cairw_fixture(k, v)
  values ('org', v_org), ('owner', v_owner), ('kin', v_kin),
         ('third', v_third), ('stale', v_stale), ('expired', v_exp);
end $$;

-- ==========================================================================
-- 1. The legitimate flow, unbroken. This is the control for everything else.
-- ==========================================================================
do $$
declare
  v_owner uuid := (select v from cairw_fixture where k = 'owner');
  v_kin   uuid := (select v from cairw_fixture where k = 'kin');
  v_req   public.care_access_requests;
  n       integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_req := public.request_care_access('+2348039100102', 'manage', 'offer_my_record', 'next of kin');
  reset role;

  insert into cairw_fixture values ('request', v_req.id);

  insert into cairw_result values (
    'the owner can still create a request by phone number',
    coalesce(v_req.id::text, 'none'), 'created',
    case when v_req.id is not null then 'PASS' else 'FAIL' end);
  if v_req.id is null then
    raise exception 'BROKEN: request_care_access no longer creates a request';
  end if;

  -- The named kin reads the initiator's profile while the request is live.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles where id = v_owner;
  reset role;

  insert into cairw_result values (
    'a FRESH pending request still lets the named party read the initiator',
    n::text || ' rows', '1 rows',
    case when n = 1 then 'PASS' else 'FAIL' end);
  if n <> 1 then
    raise exception 'BROKEN: the 14-day bound broke the legitimate pending read';
  end if;

  -- ...and accepting still grants real access.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.respond_to_care_access_request(v_req.id, true);
  reset role;

  select count(*) into n from public.profile_access
  where profile_id = v_owner and grantee_user_id = v_kin;

  insert into cairw_result values (
    'accepting still produces a profile_access grant',
    n::text || ' rows', '1 rows',
    case when n = 1 then 'PASS' else 'FAIL' end);
  if n <> 1 then
    raise exception 'BROKEN: the update guard blocks respond_to_care_access_request';
  end if;
end $$;

-- ==========================================================================
-- 2. Re-pointing a request at cancel time.
-- ==========================================================================
do $$
declare
  v_owner uuid := (select v from cairw_fixture where k = 'owner');
  v_kin   uuid := (select v from cairw_fixture where k = 'kin');
  v_third uuid := (select v from cairw_fixture where k = 'third');
  v_req   uuid;
  v_msg   text;
begin
  -- Clear any simulated session left behind by the previous block: a
  -- transaction-local set_config outlives the statement that set it, and a
  -- non-null auth.uid() would send this fixture insert through the phone-proof
  -- guard instead of past it.
  perform set_config('request.jwt.claims', '', true);
  -- A second, still-pending request to cancel. Inserted directly, with no
  -- simulated session, so the phone-proof guard stands aside: this is a
  -- fixture, not the thing under test.
  insert into public.care_access_requests
    (profile_id, counterparty_user_id, initiated_by, permission_level, relationship, status)
  values (v_owner, v_kin, v_owner, 'manage', 'next of kin', 'pending')
  returning id into v_req;
  insert into cairw_fixture values ('cancelme', v_req);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.care_access_requests
    set profile_id = v_third, status = 'cancelled'
    where id = v_req;
  exception when others then
    v_msg := sqlstate;
  end;
  reset role;

  insert into cairw_result values (
    'cancelling cannot re-point profile_id at a third party',
    coalesce('refused ' || v_msg, 'REWROTE THE ROW'), 'refused 42501',
    case when v_msg = '42501' then 'PASS' else 'FAIL' end);
  if v_msg is distinct from '42501' then
    raise exception 'HOLE OPEN: a user rewrote the identity of their own request at cancel time';
  end if;

  -- The harder half, and the reason the trigger exists at all: moving the
  -- COUNTERPARTY leaves the caller a named party on the row, so the policy's
  -- tightened WITH CHECK is satisfied and cannot see anything wrong. Only the
  -- trigger, which can compare against OLD, refuses this one. It is also the
  -- version that actually does damage: the responded notification fires at
  -- whoever the counterparty now is.
  v_msg := null;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.care_access_requests
    set counterparty_user_id = v_third, status = 'cancelled'
    where id = v_req;
  exception when others then
    v_msg := sqlstate;
  end;
  reset role;

  insert into cairw_result values (
    'cancelling cannot re-point the counterparty either (policy alone cannot catch this)',
    coalesce('refused ' || v_msg, 'REWROTE THE ROW'), 'refused 42501',
    case when v_msg = '42501' then 'PASS' else 'FAIL' end);
  if v_msg is distinct from '42501' then
    raise exception 'HOLE OPEN: a user re-pointed their request at a different counterparty';
  end if;

  -- ...and a plain, honest cancellation still works.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.care_access_requests set status = 'cancelled' where id = v_req;
  reset role;

  insert into cairw_result values (
    'a plain withdrawal still succeeds',
    (select status::text from public.care_access_requests where id = v_req), 'cancelled',
    case when (select status from public.care_access_requests where id = v_req) = 'cancelled'
      then 'PASS' else 'FAIL' end);
end $$;

-- ==========================================================================
-- 3. Sabotage for case 2 — without the trigger, the rewrite comes back.
-- ==========================================================================
do $$
declare
  v_owner uuid := (select v from cairw_fixture where k = 'owner');
  v_kin   uuid := (select v from cairw_fixture where k = 'kin');
  v_third uuid := (select v from cairw_fixture where k = 'third');
  v_req   uuid;
  v_msg   text;
  v_now   uuid;
begin
  -- Clear any simulated session left behind by the previous block: a
  -- transaction-local set_config outlives the statement that set it, and a
  -- non-null auth.uid() would send this fixture insert through the phone-proof
  -- guard instead of past it.
  perform set_config('request.jwt.claims', '', true);
  insert into public.care_access_requests
    (profile_id, counterparty_user_id, initiated_by, permission_level, status)
  values (v_owner, v_kin, v_owner, 'manage', 'pending')
  returning id into v_req;

  alter table public.care_access_requests disable trigger care_access_requests_guard_update;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    -- Deliberately the COUNTERPARTY rewrite: re-pointing profile_id is also
    -- refused by the tightened policy, so sabotaging the trigger alone would
    -- not show anything. This one the policy permits, which is exactly what
    -- makes it the proof that the trigger is load-bearing.
    update public.care_access_requests
    set counterparty_user_id = v_third, status = 'cancelled'
    where id = v_req;
  exception when others then
    v_msg := sqlstate;
  end;
  reset role;

  alter table public.care_access_requests enable trigger care_access_requests_guard_update;

  select counterparty_user_id into v_now from public.care_access_requests where id = v_req;

  insert into cairw_result values (
    'sabotage: with the guard trigger off, the rewrite succeeds again',
    case when v_now = v_third then 'rewrote the row' else coalesce('refused ' || v_msg, 'unchanged') end,
    'rewrote the row',
    case when v_now = v_third then 'PASS' else 'FAIL' end);
  if v_now is distinct from v_third then
    raise exception 'VACUOUS TEST: the rewrite was refused even with the guard disabled — case 2 proves nothing';
  end if;
end $$;

-- ==========================================================================
-- 4. A stale pending request no longer unlocks the profile read.
-- ==========================================================================
do $$
declare
  v_owner uuid := (select v from cairw_fixture where k = 'owner');
  v_stale uuid := (select v from cairw_fixture where k = 'stale');
  v_req   uuid;
  n       integer;
begin
  -- 15 days old, still pending: exactly the shape an attacker gets for free
  -- by simply never answering. created_at is set at INSERT time because the
  -- new update guard (correctly) refuses to let it be moved afterwards.
  -- Clear any simulated session left behind by the previous block: a
  -- transaction-local set_config outlives the statement that set it, and a
  -- non-null auth.uid() would send this fixture insert through the phone-proof
  -- guard instead of past it.
  perform set_config('request.jwt.claims', '', true);
  insert into public.care_access_requests
    (profile_id, counterparty_user_id, initiated_by, permission_level, status, created_at)
  values (v_owner, v_stale, v_stale, 'view', 'pending', now() - interval '15 days')
  returning id into v_req;
  insert into cairw_fixture values ('stalereq', v_req);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stale::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles where id = v_owner;
  reset role;

  insert into cairw_result values (
    'a 15-day-old pending request no longer unlocks the profiles row',
    n::text || ' rows', '0 rows',
    case when n = 0 then 'PASS' else 'FAIL' end);
  if n <> 0 then
    raise exception 'HOLE OPEN: an unanswered request still buys an indefinite read of the other profile';
  end if;
end $$;

-- ==========================================================================
-- 5. Sabotage for case 4 — remove the time bound, the read comes back.
-- ==========================================================================
do $$
declare
  v_owner uuid := (select v from cairw_fixture where k = 'owner');
  v_stale uuid := (select v from cairw_fixture where k = 'stale');
  n       integer;
begin
  drop policy profiles_select_pending_care_access on public.profiles;
  create policy profiles_select_pending_care_access on public.profiles
    for select to authenticated
    using (
      exists (
        select 1 from public.care_access_requests car
        where car.status = 'pending'
          and (
            (car.profile_id = profiles.id and car.counterparty_user_id = (select auth.uid()))
            or (car.counterparty_user_id = profiles.id and car.profile_id = (select auth.uid()))
          )
      )
    );

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stale::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles where id = v_owner;
  reset role;

  insert into cairw_result values (
    'sabotage: without the time bound, the stale request reads the profile again',
    n::text || ' rows', '1 rows',
    case when n = 1 then 'PASS' else 'FAIL' end);
  if n <> 1 then
    raise exception 'VACUOUS TEST: the stale read was refused even without the time bound — case 4 proves nothing';
  end if;
end $$;

-- Restore the real policy before anything else runs against it.
drop policy profiles_select_pending_care_access on public.profiles;
create policy profiles_select_pending_care_access on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.care_access_requests car
      where car.status = 'pending'
        and car.created_at > (now() - interval '14 days')
        and (car.expires_at is null or car.expires_at > now())
        and (
          (car.profile_id = profiles.id and car.counterparty_user_id = (select auth.uid()))
          or
          (car.counterparty_user_id = profiles.id and car.profile_id = (select auth.uid()))
        )
    )
  );

-- ==========================================================================
-- 6. A request whose own expiry has passed unlocks nothing either.
-- ==========================================================================
do $$
declare
  v_owner uuid := (select v from cairw_fixture where k = 'owner');
  v_exp   uuid := (select v from cairw_fixture where k = 'expired');
  n       integer;
begin
  -- Clear any simulated session left behind by the previous block: a
  -- transaction-local set_config outlives the statement that set it, and a
  -- non-null auth.uid() would send this fixture insert through the phone-proof
  -- guard instead of past it.
  perform set_config('request.jwt.claims', '', true);
  -- created 10 days ago (comfortably inside the 14-day window, so the window
  -- is not what refuses this) with an expiry that has since passed. The row
  -- has to be backdated: care_access_requests_expires_after_created refuses an
  -- expires_at earlier than created_at, so a request cannot be born expired.
  insert into public.care_access_requests
    (profile_id, counterparty_user_id, initiated_by, permission_level, status, created_at, expires_at)
  values (v_owner, v_exp, v_exp, 'view', 'pending', now() - interval '10 days', now() - interval '1 day');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_exp::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.profiles where id = v_owner;
  reset role;

  insert into cairw_result values (
    'a request past its own expires_at unlocks nothing',
    n::text || ' rows', '0 rows',
    case when n = 0 then 'PASS' else 'FAIL' end);
  if n <> 0 then
    raise exception 'HOLE OPEN: an expired request still unlocks the profiles row';
  end if;
end $$;

-- ==========================================================================
-- 7. The creation cap: five succeed, the sixth is refused.
--    Run as a party with no prior requests of their own — the owner has
--    accumulated several by now (case 1's RPC plus the fixtures cases 2 and 3
--    inserted in their name), and a cap test whose baseline is unknown proves
--    nothing about where the cap actually falls.
-- ==========================================================================
do $$
declare
  v_third uuid := (select v from cairw_fixture where k = 'third');
  v_made  integer := 0;
  v_msg   text;
  i       integer;
  v_phone text;
begin
  for i in 0..4 loop
    v_phone := case when i = 0 then '+2348039100102'
                    else '+23480391002' || lpad(i::text, 2, '0') end;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_third::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.request_care_access(v_phone, 'view', 'offer_my_record', 'family');
    reset role;
    v_made := v_made + 1;
  end loop;

  insert into cairw_result values (
    'the cap does not block ordinary use (five in a day all succeed)',
    v_made::text || ' created', '5 created',
    case when v_made = 5 then 'PASS' else 'FAIL' end);

  -- The sixth, against someone this caller has not yet asked.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_third::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.request_care_access('+2348039100104', 'view', 'offer_my_record', 'family');
  exception when others then
    v_msg := sqlstate;
  end;
  reset role;

  insert into cairw_result values (
    'a sixth request in 24 hours is refused',
    coalesce('refused ' || v_msg, 'CREATED'), 'refused 42501',
    case when v_msg = '42501' then 'PASS' else 'FAIL' end);
  if v_msg is distinct from '42501' then
    raise exception 'HOLE OPEN: there is no cap on how fast one account can create care access requests';
  end if;
end $$;

select check_name, observed, expected, verdict
from cairw_result
order by verdict desc, check_name;

rollback;
