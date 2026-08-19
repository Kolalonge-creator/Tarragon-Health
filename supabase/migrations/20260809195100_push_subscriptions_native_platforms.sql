-- Extends push_subscriptions (20260730153214) to cover native (iOS/Android)
-- devices via Expo push tokens, alongside the existing Web Push (VAPID) rows.
-- Same table, discriminated by `platform`, rather than a parallel table --
-- keeps the existing RLS policies (profile_id = auth.uid()) and the
-- disabled_at dead-subscription cleanup working unchanged for both shapes.
alter table public.push_subscriptions
  add column platform text not null default 'web'
    check (platform in ('web', 'ios', 'android')),
  add column expo_push_token text,
  alter column endpoint drop not null,
  alter column p256dh_key drop not null,
  alter column auth_key drop not null,
  add constraint push_subscriptions_shape_check check (
    (platform = 'web' and endpoint is not null and p256dh_key is not null and auth_key is not null)
    or (platform <> 'web' and expo_push_token is not null)
  );

-- Native devices re-subscribe by upserting on their own token, the same way
-- a web subscribe upserts on `endpoint` (unique already, from table creation).
create unique index push_subscriptions_expo_push_token_key
  on public.push_subscriptions (expo_push_token)
  where expo_push_token is not null;

-- Prove the constraint actually discriminates (accepts valid web/native
-- shapes, rejects malformed ones) rather than passing vacuously. The whole
-- DO block body shares one implicit savepoint attached to its own top-level
-- EXCEPTION clause, so the deliberate raise at the end unwinds every insert
-- below -- including the two that were supposed to succeed -- leaving no
-- rows behind in the live table. Runs with migration-runner privileges, so
-- RLS doesn't gate these test inserts either way.
do $$
declare
  v_org uuid;
  v_profile uuid;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_profile from public.profiles where organisation_id = v_org limit 1;

  if v_org is null or v_profile is null then
    raise notice 'push_subscriptions_shape_check: skipped self-test, no seed org/profile found';
    return;
  end if;

  -- Case 1: a valid web-shaped row must still insert.
  begin
    insert into public.push_subscriptions
      (organisation_id, profile_id, platform, endpoint, p256dh_key, auth_key)
    values
      (v_org, v_profile, 'web', 'https://example.test/push-selftest-web', 'p256dh', 'auth');
  exception
    when others then
      raise exception 'self-test failed: valid web row should have inserted: %', sqlerrm;
  end;

  -- Case 2: a valid native-shaped row must now insert.
  begin
    insert into public.push_subscriptions
      (organisation_id, profile_id, platform, expo_push_token)
    values
      (v_org, v_profile, 'ios', 'ExponentPushToken[self-test-ios]');
  exception
    when others then
      raise exception 'self-test failed: valid native row should have inserted: %', sqlerrm;
  end;

  -- Case 3: a web row missing p256dh/auth keys must be rejected.
  begin
    insert into public.push_subscriptions
      (organisation_id, profile_id, platform, endpoint)
    values
      (v_org, v_profile, 'web', 'https://example.test/push-selftest-malformed-web');
    raise exception 'self-test failed: malformed web row should have been rejected';
  exception
    when check_violation then null; -- expected
  end;

  -- Case 4: a native row missing its token must be rejected.
  begin
    insert into public.push_subscriptions
      (organisation_id, profile_id, platform)
    values
      (v_org, v_profile, 'android');
    raise exception 'self-test failed: native row missing token should have been rejected';
  exception
    when check_violation then null; -- expected
  end;

  raise notice 'push_subscriptions_shape_check: self-test passed';
  raise exception 'rollback push_subscriptions self-test rows (expected, not a failure)';
exception
  when others then
    if sqlerrm = 'rollback push_subscriptions self-test rows (expected, not a failure)' then
      null; -- clean rollback path, self-test passed
    else
      raise; -- a genuine failure -- abort the migration
    end if;
end $$;
