-- ===========================================================================
-- Proof: 20261016185844_s03b_auth_sms_hold.sql (answers OQ-S03B-06; the Auth Send SMS hook asks this).
--
-- Proves: an account whose number moved inside the window is held; one whose number is old, or never moved, is not; a normal
-- code login (a phone_confirmed_at re-stamp) is not a move; a recovery-contact release in the last two hours lifts the hold and
-- an older release does not; the window ends; a null user is held (fail closed); only the service role can call it (not anon,
-- not authenticated, not PUBLIC). Agrees with public.my_phone_recovery_hold for the same account.
-- Missing recovery rules refuse (never "not held").
-- SABOTAGE x4, each flips: the hold never holds, the release is always honoured, a missing window reads as not held, PUBLIC is granted EXECUTE.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create function pg_temp.svc(p_sql text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  execute 'set local role service_role';
  execute p_sql into j;
  execute 'reset role';
  return j;
exception when others then
  execute 'reset role';
  raise;
end $$;

create function pg_temp.refused(p_role text, p_sql text) returns boolean language plpgsql as $$
begin
  execute format('set local role %s', p_role);
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return true;
  end;
  execute 'reset role';
  return false;
end $$;

do $$
declare
  v_org uuid;
  moved uuid := gen_random_uuid();    -- number moved a moment ago (by update, so the trigger records it)
  old_n uuid := gen_random_uuid();    -- number untouched for 30 days
  restamp uuid := gen_random_uuid();  -- normal code login: phone_confirmed_at re-stamped, number unchanged
  freed uuid := gen_random_uuid();    -- moved, then released by the recovery contact a minute ago
  stale uuid := gen_random_uuid();    -- moved, released three hours ago
  gone uuid := gen_random_uuid();     -- moved 4 days ago
  r jsonb;
  req_state text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, phone, phone_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (moved,   'hold-moved@example.invalid',   'x', now(), '2348044441001', now() - interval '30 days', now() - interval '30 days', '{}', '{}'),
    (old_n,   'hold-old@example.invalid',     'x', now(), '2348044441002', now() - interval '30 days', now() - interval '30 days', '{}', '{}'),
    (restamp, 'hold-restamp@example.invalid', 'x', now(), '2348044441003', now() - interval '30 days', now() - interval '30 days', '{}', '{}'),
    (freed,   'hold-freed@example.invalid',   'x', now(), '2348044441004', now() - interval '30 days', now() - interval '30 days', '{}', '{}'),
    (stale,   'hold-stale@example.invalid',   'x', now(), '2348044441005', now() - interval '30 days', now() - interval '30 days', '{}', '{}'),
    (gone,    'hold-gone@example.invalid',    'x', now(), '2348044441006', now() - interval '30 days', now() - interval '30 days', '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (moved, v_org, 'patient', 'Hold Moved', null), (old_n, v_org, 'patient', 'Hold Old', null), (restamp, v_org, 'patient', 'Hold Restamp', null),
    (freed, v_org, 'patient', 'Hold Freed', null), (stale, v_org, 'patient', 'Hold Stale', null), (gone, v_org, 'patient', 'Hold Gone', null)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- the number actually moves for four of them (the trigger on auth.users records WHEN)
  update auth.users set phone = '2348044449001' where id = moved;
  update auth.users set phone = '2348044449004' where id = freed;
  update auth.users set phone = '2348044449005' where id = stale;
  update auth.users set phone = '2348044449006' where id = gone;
  update public.account_phone_changes set changed_at = now() - interval '4 days' where user_id = gone;
  update auth.users set phone_confirmed_at = now() where id = restamp;

  -- a released recovery-contact request needs a contact; use a throwaway supporter row set
  -- (state/released_at only; the table's CHECKs need confirmed_at and release_at)
  declare c uuid := gen_random_uuid(); m1 uuid; m2 uuid; rc1 uuid; rc2 uuid;
  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
    values (c, 'hold-contact@example.invalid', 'x', now(), now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name) values (c, v_org, 'patient', 'Hold Contact')
    on conflict (id) do update set organisation_id = excluded.organisation_id;
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
    values (v_org, freed, c, 'Sister', array['adherence_summary'], now() + interval '300 days') returning id into m1;
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
    values (v_org, stale, c, 'Sister', array['adherence_summary'], now() + interval '300 days') returning id into m2;
    insert into public.account_recovery_contacts (organisation_id, patient_id, contact_id, member_id, state, responded_at)
    values (v_org, freed, c, m1, 'accepted', now()) returning id into rc1;
    insert into public.account_recovery_contacts (organisation_id, patient_id, contact_id, member_id, state, responded_at)
    values (v_org, stale, c, m2, 'accepted', now()) returning id into rc2;
    insert into public.account_recovery_contact_requests (organisation_id, patient_id, contact_id, contact_row_id, state, confirmed_at, release_at, released_at, expires_at)
    values (v_org, freed, c, rc1, 'released', now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 minute', now() + interval '40 hours');
    insert into public.account_recovery_contact_requests (organisation_id, patient_id, contact_id, contact_row_id, state, confirmed_at, release_at, released_at, expires_at)
    values (v_org, stale, c, rc2, 'released', now() - interval '6 hours', now() - interval '5 hours', now() - interval '3 hours', now() + interval '40 hours');
  end;

  -- 1. held / not held
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', moved));
  if not (r ->> 'held')::boolean then raise exception 'FAIL 1: a number moved a moment ago is not held %', r; end if;
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', old_n));
  if (r ->> 'held')::boolean then raise exception 'FAIL 1(control): an account whose number never moved is held %', r; end if;
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', restamp));
  if (r ->> 'held')::boolean then raise exception 'FAIL 1: a normal code login (a re-stamp) started a pause %', r; end if;
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', gone));
  if (r ->> 'held')::boolean then raise exception 'FAIL 1: the pause did not end after 72 hours %', r; end if;
  r := pg_temp.svc('select public.auth_sms_hold(null)');
  if not (r ->> 'held')::boolean then raise exception 'FAIL 1: a null user was not held (must fail closed) %', r; end if;
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', gen_random_uuid()));
  if (r ->> 'held')::boolean then raise exception 'FAIL 1: an unknown user is held, which would tell a caller the account exists %', r; end if;

  -- 2. recovery-contact release
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', freed));
  if (r ->> 'held')::boolean then raise exception 'FAIL 2: a release a minute ago did not lift the pause %', r; end if;
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', stale));
  if not (r ->> 'held')::boolean then raise exception 'FAIL 2: a release three hours ago still lifts the pause %', r; end if;

  -- 3. agrees with the function the apps use, for the same account (as that account)
  perform set_config('request.jwt.claims', json_build_object('sub', moved, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.my_phone_recovery_hold();
  reset role;
  if not (r ->> 'held')::boolean then raise exception 'FAIL 3: the app function and the hook function disagree for a moved number'; end if;

  -- 4. who may call it
  if not pg_temp.refused('anon', format('select public.auth_sms_hold(%L)', moved)) then raise exception 'FAIL 4: anon can ask who is paused'; end if;
  if not pg_temp.refused('authenticated', format('select public.auth_sms_hold(%L)', moved)) then raise exception 'FAIL 4: a signed-in user can ask who is paused'; end if;
  -- 5. no active rules: the window is unknown, so it must REFUSE (the hook answers 503), never report "not held"
  update public.account_recovery_config set is_active = false where is_active;
  if not pg_temp.refused('service_role', format('select public.auth_sms_hold(%L)', moved)) then
    raise exception 'FAIL 5: with no active recovery rules the hold answered instead of refusing'; end if;
  update public.account_recovery_config set is_active = true where version = (select max(version) from public.account_recovery_config);
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', moved));
  if not (r ->> 'held')::boolean then raise exception 'FAIL 5(control): the rules did not come back %', r; end if;
  raise notice 'PASS 1-5';

  -- 6. SABOTAGE. Each block reverts one guard and proves the matching check above could fail.
  -- S1: a hold that never holds
  create or replace function public.auth_sms_hold(p_user uuid) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select jsonb_build_object('held', false) $f$;
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', moved));
  if (r ->> 'held')::boolean then raise exception 'VACUOUS TEST: the sabotaged hold still holds'; end if;

  -- S2: a release that is honoured forever (ignores released_at age)
  create or replace function public.auth_sms_hold(p_user uuid) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select jsonb_build_object('held', not exists (select 1 from public.account_recovery_contact_requests where patient_id = p_user and state = 'released')
                                              and private.number_changed_recently(p_user, 72)) $f$;
  r := pg_temp.svc(format('select public.auth_sms_hold(%L)', stale));
  if (r ->> 'held')::boolean then raise exception 'VACUOUS TEST: the sabotaged release rule still holds the stale account'; end if;

  -- S4: a hold that treats a missing window as "not held" (the fail-open the review found)
  create or replace function public.auth_sms_hold(p_user uuid) returns jsonb language sql stable security definer set search_path = ''
    as $f$ select jsonb_build_object('held', coalesce(private.number_changed_recently(p_user, (private.recovery_rules() ->> 'number_change_hold_hours')::integer), false)) $f$;
  update public.account_recovery_config set is_active = false where is_active;
  if pg_temp.refused('service_role', format('select public.auth_sms_hold(%L)', moved)) then
    raise exception 'VACUOUS TEST: the sabotaged hold still refuses with no rules'; end if;

  -- S3: PUBLIC EXECUTE reaches anon (the public-revoke gotcha)
  execute 'grant execute on function public.auth_sms_hold(uuid) to public';
  if not has_function_privilege('anon', 'public.auth_sms_hold(uuid)', 'EXECUTE') then
    raise exception 'VACUOUS TEST: granting to PUBLIC did not reach anon, so the anon check proves nothing'; end if;
end $$;

select 'PASS: s03b_auth_sms_hold' as result;

rollback;
