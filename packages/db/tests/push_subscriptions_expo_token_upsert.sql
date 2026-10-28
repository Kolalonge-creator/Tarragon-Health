-- S40 gate finding: a native push registration is an upsert on expo_push_token. It must work
-- (insert, then update the same row on re-register), web rows (null token) must still coexist,
-- and a sabotage step proves the test fails when the index is partial again.
begin;

do $$
declare
  v_org uuid;
  v_profile uuid;
  v_n int;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_profile from public.profiles where organisation_id = v_org limit 1;
  if v_org is null or v_profile is null then
    raise exception 'VACUOUS TEST: no seed organisation/profile';
  end if;

  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token)
  values (v_org, v_profile, 'ios', 'ExponentPushToken[s40-proof]')
  on conflict (expo_push_token) do update set last_seen_at = now(), disabled_at = null;

  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token)
  values (v_org, v_profile, 'ios', 'ExponentPushToken[s40-proof]')
  on conflict (expo_push_token) do update set last_seen_at = now(), disabled_at = null;

  select count(*) into v_n from public.push_subscriptions where expo_push_token = 'ExponentPushToken[s40-proof]';
  if v_n <> 1 then raise exception 'HOLE OPEN: re-registering the same token made % rows', v_n; end if;

  -- two web rows (null token) still coexist
  insert into public.push_subscriptions (organisation_id, profile_id, platform, endpoint, p256dh_key, auth_key)
  values (v_org, v_profile, 'web', 'https://s40.example/a', 'k', 'a'),
         (v_org, v_profile, 'web', 'https://s40.example/b', 'k', 'a');

  -- sabotage: make the index partial again; the same upsert must then fail
  drop index public.push_subscriptions_expo_push_token_key;
  create unique index push_subscriptions_expo_push_token_key
    on public.push_subscriptions (expo_push_token) where expo_push_token is not null;
  begin
    insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token)
    values (v_org, v_profile, 'ios', 'ExponentPushToken[s40-proof]')
    on conflict (expo_push_token) do update set last_seen_at = now();
    raise exception 'VACUOUS TEST: the upsert worked against a partial index';
  exception when sqlstate '42P10' then
    null; -- expected: this is the bug the migration fixes
  end;
end $$;

select 'push_subscriptions expo token upsert' as check_name, 'PASS' as verdict;
rollback;
