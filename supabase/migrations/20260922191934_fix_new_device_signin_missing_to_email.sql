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
-- Also fixed here, same pass: record_login_device treated a profile's
-- organisation_id being null as "no profile row, nothing to record" — but
-- profiles.organisation_id is nullable BY DESIGN (self-serve/org-less
-- patients — the same population 20260918111442_account_lockout_after_
-- repeated_failed_logins.sql found had the identical bug for the lockout
-- counter). Those patients got no user_known_devices row, no new-device
-- notification ever, and the "Devices" card on /account (added in that same
-- migration) permanently showed "No device history recorded yet" regardless
-- of real login activity. Fixed the same way: check profile EXISTENCE
-- separately from the org_id value, so a null org_id still records.
--
-- Only the notification payload / null-org handling change — the
-- fingerprint/upsert logic, RLS, and grants are untouched. CREATE OR REPLACE
-- is safe here (same signature, same behaviour except those two fixes).

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
  v_profile_id    uuid := auth.uid();
  v_org_id        uuid;
  v_has_profile   boolean;
  -- user_known_devices.organisation_id is NOT NULL (a pre-existing, already-
  -- shipped constraint this fix doesn't relax) — a null profile org_id falls
  -- back to the same seeded default-consumer-org sentinel
  -- private.handle_new_user() itself already defaults new profiles to (see
  -- 20260705211044_core_auth_multitenancy.sql /
  -- 20260706084837_seed_default_consumer_org_and_handle_new_user.sql), not a
  -- new convention invented here. notifications.organisation_id IS nullable,
  -- but the same resolved value is used there too for one consistent org
  -- across both rows this call writes.
  v_insert_org_id uuid;
  v_is_new        boolean;
  v_email         text;
begin
  if v_profile_id is null then
    raise exception 'record_login_device requires an authenticated session';
  end if;

  select organisation_id, true into v_org_id, v_has_profile
  from public.profiles where id = v_profile_id;
  if not coalesce(v_has_profile, false) then
    -- No profile row at all (should not happen for a real session) —
    -- nothing to record. A null organisation_id on an EXISTING profile row
    -- is a different, valid state and must still fall through below.
    return false;
  end if;
  v_insert_org_id := coalesce(v_org_id, '00000000-0000-0000-0000-000000000001');

  insert into public.user_known_devices
    (profile_id, organisation_id, device_fingerprint, user_agent, first_ip, last_ip)
  values
    (v_profile_id, v_insert_org_id, p_device_fingerprint, p_user_agent, p_ip, p_ip)
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
      (v_insert_org_id, v_profile_id, 'in_app', 'pending', 'security.new_device_signin',
       jsonb_build_object(
         'message', 'New sign-in to your Tarragon Health account from a device we haven''t seen before.',
         'ip', p_ip,
         'user_agent', p_user_agent,
         'occurred_at', now()
       ),
       'non_clinical', 'critical'),
      (v_insert_org_id, v_profile_id, 'email', 'pending', 'security.new_device_signin',
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
