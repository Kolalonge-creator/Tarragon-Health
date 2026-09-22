-- Tarragon Health
-- Fix: public.record_login_device()'s 'security.new_device_signin' email-channel
-- notification has never carried a `to_email`, so it has been silently failing
-- delivery ("recipient has no email address") since it shipped
-- (20260829223329_known_device_login_notification.sql).
--
-- send-pending-notifications resolves an email-channel row's destination ONLY
-- from payload.to_email (supabase/functions/send-pending-notifications/index.ts) —
-- profiles has no email column, and unlike phone (which falls back to a
-- recipient-profile lookup) there is no such fallback for email. Found while
-- wiring the sibling security.account_locked notification
-- (20260918111442_account_lockout_after_repeated_failed_logins.sql), which set
-- payload.to_email from the start and was checked against this exact bug class.
-- The established pattern this fix follows is
-- 20260720120004_prescription_lab_order_patient_emails.sql's own
-- `select email into ... from auth.users`.
--
-- Only the notification's payload construction changes — the fingerprint/
-- upsert logic, RLS, and grants are untouched. CREATE OR REPLACE is safe here
-- (same signature, same behaviour except the one new field).

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
  v_email      text;
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
    select email into v_email from auth.users where id = v_profile_id;

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
         'occurred_at', now(),
         'to_email', v_email
       ),
       'non_clinical', 'critical');
  end if;

  return v_is_new;
end;
$$;

comment on function public.record_login_device(text, text, text) is
  'Upserts a (profile, device fingerprint) row and returns true iff this is the first time this '
  'fingerprint has been seen for this profile, queuing an in_app + email notification in that '
  'case (the email row carries payload.to_email as of '
  '20260922191934_fix_new_device_signin_missing_to_email.sql — it silently failed to send '
  'before that). Called from apps/web/src/lib/auth/record-login-device.ts right after a '
  'successful password or OTP sign-in. See 20260829223329_known_device_login_notification.sql '
  'for design notes.';

-- Grants/RLS are untouched by this fix, but re-assert them anyway — cheap
-- insurance against CREATE OR REPLACE ever silently resetting an ACL.
do $$
begin
  if has_function_privilege('anon', 'public.record_login_device(text, text, text)', 'EXECUTE') then
    raise exception 'record_login_device is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.record_login_device(text, text, text)', 'EXECUTE') then
    raise exception 'record_login_device is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
