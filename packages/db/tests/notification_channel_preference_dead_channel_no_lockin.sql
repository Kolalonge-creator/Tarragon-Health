-- ===========================================================================
-- Regression: a dead-channel notification_channel_preference never locks a
-- patient in (originally 20260918073148, re-expressed 2026-09-30 when the
-- retired chat channel was removed and the push-first remap trigger was replaced
-- by private.patient_reminder_channel()).
--
-- THE BUG (history). A routine reminder used to be locked onto whatever dead
-- dead channel (chat or sms) the patient had explicitly picked, while a patient
-- with no preference at least got a push fallback. Choosing a channel that can
-- not deliver must never leave a patient worse off than choosing nothing.
--
-- THE MECHANISM NOW. private.patient_reminder_channel(recipient, allow_email)
-- returns email ONLY for an explicit email preference (and only when the caller
-- allows email), else push when an active push subscription exists, else
-- in_app. The stored preference is never returned blindly.
--
-- This script proves, against the real helper:
--   * an explicit 'sms' preference with no push subscription resolves to
--     in_app, never sms;
--   * an explicit 'sms' preference WITH a push subscription resolves to push,
--     same as no preference at all;
--   * a voice-style or null preference behaves identically to no preference;
--   * CONTROL: an explicit 'email' preference is honoured, but only when
--     allow_email is true (false falls through to push);
--     (every reminder producer calls this helper; the per-feature proofs cover
--     the producers, this file stays on the helper itself);
--   * SABOTAGE: replacing the helper with one that returns the stored
--     preference blindly makes the first check fail, proving it discriminates.
--
-- The old chat-preference case is deleted: the value no longer exists in the enum or the profiles CHECK, so
-- there is nothing left to lock in.
--
-- Wrapped in BEGIN/ROLLBACK -- mints its own patient and redefines the helper
-- once inside a sub-block for the sabotage step; the rollback undoes both.
-- ===========================================================================

begin;
create temporary table ncp_result(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table ncp_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists at all -- the core migrations did not run'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'ncp-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pat, v_org, 'patient', 'Notification Channel Preference Test Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  insert into ncp_fixture values ('org', v_org), ('pat', v_pat);
end $$;

-- ============ 1. sms preference + no push subscription -> in_app, NOT sms ==============
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_ch  public.notification_channel;
begin
  update public.profiles set notification_channel_preference = 'sms' where id = v_pat;
  if not found then raise exception 'VACUOUS: the sms preference was not applied'; end if;

  v_ch := private.patient_reminder_channel(v_pat);

  insert into ncp_result values
    ('explicit sms preference, no push subscription -> in_app, never locks to sms',
     v_ch::text, 'in_app', case when v_ch = 'in_app' then 'PASS' else 'FAIL' end);
  if v_ch = 'sms' then
    raise exception 'HOLE OPEN: an explicit sms preference still locked a reminder onto the dead sms channel';
  end if;
  if v_ch <> 'in_app' then
    raise exception 'FAIL: expected in_app with no push subscription, got %', v_ch;
  end if;
end $$;

-- ============ 2. sms preference + an active push subscription -> push ===================
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_org uuid := (select v from ncp_fixture where k = 'org');
  v_ch  public.notification_channel;
begin
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key)
  values (v_org, v_pat, 'https://push.example.invalid/ncp-test-endpoint', 'p256dh-test-key', 'auth-test-key');

  v_ch := private.patient_reminder_channel(v_pat);

  insert into ncp_result values
    ('explicit sms preference + an active push subscription -> push, same as no preference',
     v_ch::text, 'push', case when v_ch = 'push' then 'PASS' else 'FAIL' end);
  if v_ch <> 'push' then
    raise exception 'FAIL: an sms preference with a push subscription on file did not resolve to push (got %)', v_ch;
  end if;
end $$;

-- ============ 3. null preference behaves identically to a dead-channel preference =======
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_ch  public.notification_channel;
begin
  update public.profiles set notification_channel_preference = null where id = v_pat;

  v_ch := private.patient_reminder_channel(v_pat);

  insert into ncp_result values
    ('no preference + an active push subscription -> push (identical to the sms preference result)',
     v_ch::text, 'push', case when v_ch = 'push' then 'PASS' else 'FAIL' end);
  if v_ch <> 'push' then
    raise exception 'FAIL: a null preference resolved to % instead of push', v_ch;
  end if;
end $$;

-- ============ 4. CONTROL: email preference honoured only when email is allowed ==========
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_ch  public.notification_channel;
  v_ch_no_email public.notification_channel;
begin
  update public.profiles set notification_channel_preference = 'email' where id = v_pat;

  v_ch := private.patient_reminder_channel(v_pat);
  v_ch_no_email := private.patient_reminder_channel(v_pat, false);

  insert into ncp_result values
    ('CONTROL: an explicit email preference is honoured (allow_email default true)',
     v_ch::text, 'email', case when v_ch = 'email' then 'PASS' else 'FAIL' end),
    ('CONTROL: an email preference with allow_email = false falls through to push',
     v_ch_no_email::text, 'push', case when v_ch_no_email = 'push' then 'PASS' else 'FAIL' end);
  if v_ch <> 'email' then
    raise exception 'REGRESSION: an email preference is no longer honoured (got %)', v_ch;
  end if;
  if v_ch_no_email <> 'push' then
    raise exception 'FAIL: allow_email=false still returned % for an email preference', v_ch_no_email;
  end if;

  update public.profiles set notification_channel_preference = null where id = v_pat;
end $$;

-- ============ 5. SABOTAGE: a helper returning the stored preference blindly ============
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_ch  public.notification_channel;
begin
  begin
    create or replace function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true)
    returns public.notification_channel
    language sql
    stable
    as $f$
      -- SABOTAGE: return the stored preference as-is (the pre-fix lock-in).
      select coalesce((select notification_channel_preference::text from public.profiles where id = p_recipient), 'in_app')::public.notification_channel
    $f$;

    update public.profiles set notification_channel_preference = 'sms' where id = v_pat;
    v_ch := private.patient_reminder_channel(v_pat);
    raise exception 'sabotage_undo';
  exception when others then
    if sqlerrm <> 'sabotage_undo' then raise; end if;
  end;

  insert into ncp_result values
    ('SABOTAGE: a blind-preference helper reopens the hole (proves check 1 discriminates)',
     v_ch::text, 'sms', case when v_ch = 'sms' then 'PASS' else 'FAIL' end);
  if v_ch is distinct from 'sms' then
    raise exception 'VACUOUS TEST: sabotaging the helper did not reopen the hole -- check 1 proves nothing (got %)', v_ch;
  end if;
end $$;

select check_name, observed, expected, verdict from ncp_result order by check_name;
rollback;
