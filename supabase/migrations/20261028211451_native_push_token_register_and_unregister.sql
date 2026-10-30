-- S40 gate review follow-up to 20261028192001. With the token upsert now able to work, two things the old failure
-- hid become reachable on a phone that more than one account uses:
--   * a signed-out account's token row stayed active, so its pushes kept arriving on a phone it no longer held;
--   * the next account's upsert onto the same token was refused by the owner-only update policy (the app swallows
--     registration errors), so that account never got pushes either.
-- The token belongs to the PHONE, and a phone has one signed-in account. register_native_push_token therefore moves the
-- row to whoever is signed in now (profile and organisation included, page-channel readiness reset), and
-- unregister_native_push_token lets the leaving account switch its own row off before it signs out.
create or replace function public.register_native_push_token(
  p_token text,
  p_platform text,
  p_urgent_channel_ready boolean default false,
  p_page_channel_ready boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if p_token is null or length(btrim(p_token)) = 0 or length(p_token) > 512 then
    raise exception 'invalid push token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'invalid platform' using errcode = '22023';
  end if;

  select organisation_id into v_org from public.profiles where id = v_user;
  if v_org is null then
    raise exception 'no organisation on file' using errcode = '22023';
  end if;

  insert into public.push_subscriptions
    (organisation_id, profile_id, platform, expo_push_token, last_seen_at, disabled_at, urgent_channel_ready, page_channel_ready)
  values
    (v_org, v_user, p_platform, p_token, now(), null, coalesce(p_urgent_channel_ready, false), coalesce(p_page_channel_ready, false))
  on conflict (expo_push_token) do update
    set organisation_id = excluded.organisation_id,
        profile_id = excluded.profile_id,
        platform = excluded.platform,
        last_seen_at = excluded.last_seen_at,
        disabled_at = null,
        urgent_channel_ready = excluded.urgent_channel_ready,
        page_channel_ready = excluded.page_channel_ready;
end;
$$;

create or replace function public.unregister_native_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  -- only the caller's own row: a token another account now holds is not theirs to switch off
  update public.push_subscriptions
     set disabled_at = now()
   where expo_push_token = p_token
     and profile_id = auth.uid()
     and disabled_at is null;
end;
$$;

-- anon inherits EXECUTE through PUBLIC, so revoke from public (not from anon), then grant the signed-in role only.
revoke all on function public.register_native_push_token(text, text, boolean, boolean) from public;
revoke all on function public.unregister_native_push_token(text) from public;
grant execute on function public.register_native_push_token(text, text, boolean, boolean) to authenticated;
grant execute on function public.unregister_native_push_token(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.register_native_push_token(text, text, boolean, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.unregister_native_push_token(text)', 'EXECUTE') then
    raise exception 'anon must not execute the native push token functions';
  end if;
  if not has_function_privilege('authenticated', 'public.register_native_push_token(text, text, boolean, boolean)', 'EXECUTE') then
    raise exception 'authenticated must execute register_native_push_token';
  end if;
end $$;
