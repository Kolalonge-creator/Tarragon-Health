-- ===========================================================================
-- Verification: 20260922191934_fix_new_device_signin_missing_to_email
--
--   * record_login_device()'s email-channel 'security.new_device_signin'
--     notification now carries payload.to_email, matching auth.users.email —
--     without it, send-pending-notifications silently drops the row
--     ("recipient has no email address"), which is exactly what was
--     happening since this notification shipped.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data.
-- ===========================================================================

begin;

do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_is_new  boolean;
  v_to_email text;
  v_count   bigint;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'ndste-test-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'NDSTE Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.record_login_device('ndste-fingerprint-1', 'TestAgent/1.0', '203.0.113.9')
    into v_is_new;
  reset role;

  if v_is_new is distinct from true then
    raise exception 'SETUP FAILED: expected the first sign-in from a fingerprint to be reported as new';
  end if;

  select count(*), max(payload->>'to_email') into v_count, v_to_email
  from public.notifications
  where recipient_id = v_patient
    and template = 'security.new_device_signin' and channel = 'email';

  if v_count <> 1 then
    raise exception 'BROKEN: expected exactly one email notification, got %', v_count;
  end if;
  if v_to_email is distinct from 'ndste-test-patient@example.invalid' then
    raise exception 'REGRESSION: email notification has no (or wrong) payload.to_email — send-pending-notifications would silently drop it (got %)',
      coalesce(v_to_email, 'null');
  end if;

  raise notice 'PASS: security.new_device_signin email row carries payload.to_email = %', v_to_email;
end $$;

rollback;
