-- S19e: the Expo app can report page receipts, so a clinician reached only through the mobile app is no longer treated as
-- "a route that cannot speak".
--
-- 1. private.clinician_route_confirmed: a 'push' receipt now confirms the route when the clinician has a live WEB or NATIVE
--    (ios/android with an Expo token) push subscription. Before, only web push counted, so a mobile-only clinician always waited
--    the longer unconfirmed-route window (180 s) even after the app had reported receipts. The change only ever shortens the
--    early-advance wait for a clinician whose own phone has recently shown a page; it still only ADDS the next person.
--    Everything else in the function is byte for byte the S19c definition.
-- 2. push_subscriptions.page_channel_ready: a phone that has created the Android 'on_call_page' alarm channel says so at
--    registration. The sender names that channel for page notifications only for such a phone (a channel the phone has never
--    heard of means the push is accepted and never shown), so a phone on an older build keeps getting pages on 'urgent'.
--    Default false: nothing changes until an updated app registers.
--
-- Rows affected: none rewritten (a new boolean column with a default; a function replaced). No SMS or WhatsApp path is added.

alter table public.push_subscriptions add column page_channel_ready boolean not null default false;

create or replace function private.clinician_route_confirmed(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.page_delivered_acks a
                  where a.clinician_id = p_profile
                    and a.acked_at > now() - make_interval(days => private.paging_delivery_rule('readiness_test_page_days'))
                    and (a.channel in ('alarm', 'in_app')
                         or (a.channel = 'push' and exists (select 1 from public.push_subscriptions s
                                                             where s.profile_id = p_profile and s.disabled_at is null
                                                               and (s.platform = 'web'
                                                                    or (s.platform in ('ios', 'android') and s.expo_push_token is not null))))))
$$;
revoke all on function private.clinician_route_confirmed(uuid) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.clinician_route_confirmed(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.clinician_route_confirmed(uuid)', 'EXECUTE') then
    raise exception 'S19e: private.clinician_route_confirmed must not be executable by anon or authenticated';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_subscriptions' and column_name = 'page_channel_ready') then
    raise exception 'S19e: page_channel_ready missing';
  end if;
end $$;
