-- S40 review follow-up: one phone, two accounts. Runs as simulated signed-in sessions (RLS applies), with controls and a sabotage step.
--   * A registers a token; B then registers the SAME token (shared phone) and the row follows B (it used to be refused by RLS and swallowed).
--   * A cannot switch off B's row (control), but can switch off their own.
--   * anon cannot execute either function.
--   * sabotage: a register that does not move the row is caught by the same check.
begin;

create temp table _r (check_name text, observed text, expected text);
grant all on _r to public;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_owner uuid; v_off timestamptz; v_n int; v_failed boolean;
begin
  select o.id into v_org from public.organisations o
   where (select count(*) from public.profiles p where p.organisation_id = o.id) >= 2 limit 1;
  select id into v_a from public.profiles where organisation_id = v_org order by id limit 1;
  select id into v_b from public.profiles where organisation_id = v_org and id <> v_a order by id limit 1;
  if v_org is null or v_a is null or v_b is null then raise exception 'VACUOUS TEST: need two profiles in one organisation'; end if;
  perform set_config('s40.a', v_a::text, true);
  perform set_config('s40.b', v_b::text, true);
end $$;

-- A registers on the phone
select set_config('request.jwt.claims', json_build_object('sub', current_setting('s40.a'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.register_native_push_token('ExponentPushToken[s40-shared]', 'ios', true, null);
reset role;
insert into _r select 'A registers: the row is A''s and active',
  (select (profile_id = current_setting('s40.a')::uuid)::text || ':' || (disabled_at is null)::text from public.push_subscriptions where expo_push_token = 'ExponentPushToken[s40-shared]'), 'true:true';

-- control: B cannot switch off A's row
select set_config('request.jwt.claims', json_build_object('sub', current_setting('s40.b'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.unregister_native_push_token('ExponentPushToken[s40-shared]');
reset role;
insert into _r select 'control: B cannot switch off A''s row',
  (select (disabled_at is null)::text from public.push_subscriptions where expo_push_token = 'ExponentPushToken[s40-shared]'), 'true';

-- B signs in on the same phone and registers the same token
select set_config('request.jwt.claims', json_build_object('sub', current_setting('s40.b'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.register_native_push_token('ExponentPushToken[s40-shared]', 'ios', true, null);
reset role;
insert into _r select 'B registers the same token: the row moves to B, active, page channel reset',
  (select (profile_id = current_setting('s40.b')::uuid)::text || ':' || (disabled_at is null)::text || ':' || page_channel_ready::text from public.push_subscriptions where expo_push_token = 'ExponentPushToken[s40-shared]'), 'true:true:false';
insert into _r select 'still one row for the token', (select count(*)::text from public.push_subscriptions where expo_push_token = 'ExponentPushToken[s40-shared]'), '1';

-- B signs out: their own row is switched off
select set_config('request.jwt.claims', json_build_object('sub', current_setting('s40.b'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.unregister_native_push_token('ExponentPushToken[s40-shared]');
reset role;
insert into _r select 'B signs out: B''s row is disabled',
  (select (disabled_at is not null)::text from public.push_subscriptions where expo_push_token = 'ExponentPushToken[s40-shared]'), 'true';

-- anon cannot execute either function
insert into _r select 'anon cannot execute register or unregister',
  (has_function_privilege('anon', 'public.register_native_push_token(text, text, boolean, boolean)', 'EXECUTE')
   or has_function_privilege('anon', 'public.unregister_native_push_token(text)', 'EXECUTE'))::text, 'false';

-- bad input is refused
do $$
declare v_bad boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('s40.a'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.register_native_push_token('', 'ios'); exception when others then v_bad := true; end;
  reset role;
  if not v_bad then raise exception 'HOLE OPEN: an empty token was accepted'; end if;
end $$;

-- SABOTAGE: a register that does not move the row (the old behaviour, owner-only update) must fail the takeover check.
create or replace function public.register_native_push_token(p_token text, p_platform text, p_urgent_channel_ready boolean default false, p_page_channel_ready boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token)
  select organisation_id, auth.uid(), p_platform, p_token from public.profiles where id = auth.uid()
  on conflict (expo_push_token) do nothing;
end; $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('s40.a'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.register_native_push_token('ExponentPushToken[s40-shared]', 'ios', true, null);
reset role;
-- With the old behaviour the row does NOT move to A, so the takeover assertion (row follows the signed-in account) would fail.
insert into _r select 'SABOTAGE: the non-moving register leaves the row with B, so the takeover check would fail',
  (select (profile_id = current_setting('s40.a')::uuid)::text from public.push_subscriptions where expo_push_token = 'ExponentPushToken[s40-shared]'), 'false';

select check_name, observed, expected, case when observed = expected then 'PASS' else 'FAIL' end as verdict from _r;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from _r where observed is distinct from expected and check_name not like 'SABOTAGE:%';
  if v_fail > 0 then raise exception 'push token register proof: % check(s) failed', v_fail; end if;
  -- the sabotaged variant did not move the row: proves the takeover check discriminates
  if (select observed from _r where check_name like 'SABOTAGE:%') is distinct from 'false' then
    raise exception 'VACUOUS TEST: the non-moving register still moved the row';
  end if;
end $$;
rollback;
