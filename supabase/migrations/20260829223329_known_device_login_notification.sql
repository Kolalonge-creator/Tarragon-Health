-- Tarragon Health
-- New-device sign-in detection (spec 86.5/86.6 gap): "unusual login / new device" patient and
-- staff account protection. This project's existing auth rate limiting (lib/rate-limit.ts) only
-- throttles brute-force attempts; nothing previously recorded which devices/browsers a given
-- account normally signs in from, or notified the account owner when a genuinely new one
-- appeared. That's a real gap for account-takeover detection: a stolen password used from a
-- device the real user has never touched currently produces zero signal to anyone.
--
-- Deliberately scoped as a fingerprint on the User-Agent string alone, NOT combined with IP —
-- mobile-network IP churn is constant and would make this fire on almost every session for a
-- huge fraction of users, training everyone to ignore the notification. IP is still recorded
-- (informational, shown in the notification copy: "signed in from <ip> using <browser>"), just
-- not part of what decides "new". This means a genuinely new device with a spoofed/matching
-- User-Agent string would not be caught — a known, accepted limitation for a first pass, not a
-- claim of full device-fingerprinting robustness.
--
-- Writes go through this SECURITY DEFINER RPC only (same posture as alert_deliveries/case_briefs
-- elsewhere in this schema) — no direct client insert/update path.
--
-- Verified live 2026-08-29 in begin/rollback transactions (no trace left): calling this RPC
-- twice with the same fingerprint returns is_new=true then is_new=false, and increments
-- sign_in_count / updates last_ip on the second call as expected.

create table public.user_known_devices (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null references public.profiles (id) on delete cascade,
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  device_fingerprint text not null,
  user_agent         text,
  first_ip           text,
  last_ip            text,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  sign_in_count      integer not null default 1,
  unique (profile_id, device_fingerprint)
);

comment on table public.user_known_devices is
  'One row per (profile, device fingerprint) the account has signed in from. Written only by '
  'public.record_login_device() — see 20260829223329_known_device_login_notification.sql. Powers '
  'new-device sign-in detection; not a full session-management surface (no per-session revoke '
  'here, that is Supabase Auth''s own session store via signOut({scope}) on the client).';

create index user_known_devices_profile_idx on public.user_known_devices (profile_id);

alter table public.user_known_devices enable row level security;

create policy user_known_devices_select on public.user_known_devices
  for select to authenticated
  using (profile_id = auth.uid());

grant select on public.user_known_devices to authenticated;

create or replace function public.record_login_device(
  p_device_fingerprint text,
  p_user_agent text,
  p_ip text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := auth.uid();
  v_org_id     uuid;
  v_is_new     boolean;
begin
  if v_profile_id is null then
    raise exception 'record_login_device requires an authenticated session';
  end if;

  select organisation_id into v_org_id from public.profiles where id = v_profile_id;
  if v_org_id is null then
    -- No profile row (should not happen for a real session) — nothing to record.
    return false;
  end if;

  insert into public.user_known_devices
    (profile_id, organisation_id, device_fingerprint, user_agent, first_ip, last_ip)
  values
    (v_profile_id, v_org_id, p_device_fingerprint, p_user_agent, p_ip, p_ip)
  on conflict (profile_id, device_fingerprint) do update
    set last_seen_at  = now(),
        last_ip       = excluded.last_ip,
        sign_in_count = public.user_known_devices.sign_in_count + 1
  returning (xmax = 0) into v_is_new;

  if v_is_new then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
    values
      (v_org_id, v_profile_id, 'in_app', 'pending', 'security.new_device_signin',
       jsonb_build_object(
         'message', 'New sign-in to your Tarragon Health account from a device we haven''t seen before.',
         'ip', p_ip,
         'user_agent', p_user_agent,
         'occurred_at', now()
       ),
       'non_clinical', 'critical'),
      (v_org_id, v_profile_id, 'email', 'pending', 'security.new_device_signin',
       jsonb_build_object(
         'message', 'New sign-in to your Tarragon Health account from a device we haven''t seen before. If this wasn''t you, change your password right away.',
         'ip', p_ip,
         'user_agent', p_user_agent,
         'occurred_at', now()
       ),
       'non_clinical', 'critical');
  end if;

  return v_is_new;
end;
$$;

comment on function public.record_login_device(text, text, text) is
  'Upserts a (profile, device fingerprint) row and returns true iff this is the first time this '
  'fingerprint has been seen for this profile, queuing an in_app + email notification in that '
  'case. Called from apps/web/src/lib/auth/record-login-device.ts right after a successful '
  'password or OTP sign-in. See 20260829223329_known_device_login_notification.sql for design notes.';

revoke all on function public.record_login_device(text, text, text) from public;
grant execute on function public.record_login_device(text, text, text) to authenticated;
revoke execute on function public.record_login_device(text, text, text) from anon;

do $$
begin
  if has_function_privilege('anon', 'public.record_login_device(text, text, text)', 'EXECUTE') then
    raise exception 'record_login_device is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.record_login_device(text, text, text)', 'EXECUTE') then
    raise exception 'record_login_device is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
